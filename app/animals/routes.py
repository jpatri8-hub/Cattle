from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required

from app import db
from app.decorators import owner_required
from app.forms import (
    AddToBreedingGroupForm, AnimalForm, BreedingGroupForm, BulkLocationForm,
    BulkVaccinationForm, CalfBirthForm, CalfOutcomeForm, CastrationForm,
    ConfirmBredForm, DepartureForm, FeedoutForm, HealthRecordForm, ImportCSVForm,
    LastSeenCheckForm, SemenTestForm, WeightRecordForm, BullEPDForm,
)
from app.lifecycle import (
    apply_candidate_sires, apply_weaning_transfer, auto_sync_breeding_exposure,
    generate_temp_id, inbreeding_warnings,
)
from app.models import (
    Animal, AnimalType, BreedingGroup, BullEPD, CALF_OUTCOME_ACTIVE, CalfRecord,
    ExposureRecord, FeedoutRecord, HealthRecord, LastSeenCheck,
    Location, SemenTest, SEX_FEMALE, SEX_MALE, WeightRecord,
)
from app.utils import save_upload

animals_bp = Blueprint("animals", __name__, url_prefix="/animals")


# ---------------------------------------------------------------- helpers --

def _type_choices(sex=None, active_only=True):
    q = AnimalType.query
    if active_only:
        q = q.filter_by(is_active=True)
    if sex:
        q = q.filter_by(sex=sex)
    return [(t.id, t.name) for t in q.order_by(AnimalType.name).all()]


def _location_choices(include_blank=True):
    locs = Location.query.filter_by(is_active=True).join(Location.property).order_by(Location.name).all()
    choices = [(l.id, l.display_name) for l in locs]
    return ([(0, "-- None --")] + choices) if include_blank else choices


def _animal_label(a):
    return f"{a.display_id} - {a.animal_type.name if a.animal_type else ''}"


def _bull_choices():
    return [(a.id, _animal_label(a)) for a in Animal.query.filter_by(is_active=True, sex=SEX_MALE).order_by(Animal.tag_id).all() if a.is_bull]


def _cow_choices():
    return [
        (a.id, _animal_label(a)) for a in Animal.query.filter_by(is_active=True, sex=SEX_FEMALE).order_by(Animal.tag_id).all()
    ]


# ---------------------------------------------------------------- list/detail --

@animals_bp.route("/")
@login_required
def list_animals():
    type_id = request.args.get("type_id", type=int)
    location_id = request.args.get("location_id", type=int)
    current_only = request.args.get("archived", "") != "1"
    has_calf = request.args.get("has_calf") == "1"
    flagged = request.args.get("flagged") == "1"
    q = (request.args.get("q") or "").strip()

    query = Animal.query
    if current_only:
        query = query.filter_by(is_active=True)
    else:
        query = query.filter_by(is_active=False)
    if type_id:
        query = query.filter_by(animal_type_id=type_id)
    if location_id:
        query = query.filter_by(location_id=location_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            db.or_(Animal.tag_id.ilike(like), Animal.temp_id.ilike(like), Animal.name.ilike(like))
        )

    animals = query.order_by(Animal.tag_id).all()

    if has_calf:
        animals = [a for a in animals if any(c.outcome == CALF_OUTCOME_ACTIVE for c in a.calf_records_as_dam)]
    if flagged:
        animals = [a for a in animals if a.not_seen_flagged]

    types = AnimalType.query.order_by(AnimalType.name).all()
    locations = Location.query.filter_by(is_active=True).order_by(Location.name).all()

    return render_template(
        "animals/list.html", animals=animals, types=types, locations=locations,
        type_id=type_id, location_id=location_id, current_only=current_only,
        has_calf=has_calf, flagged=flagged, q=q,
    )


@animals_bp.route("/<int:animal_id>")
@login_required
def view_animal(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    weight_form = WeightRecordForm(date_recorded=date.today())
    health_form = HealthRecordForm(date_recorded=date.today())
    last_seen_form = LastSeenCheckForm(date_recorded=date.today())
    last_seen_form.location_id.choices = _location_choices()
    last_seen_form.location_id.data = animal.location_id or 0

    calf_form = None
    if animal.sex == SEX_FEMALE:
        calf_form = CalfBirthForm(calving_date=date.today())
        calf_form.sire_id.choices = [(0, "-- Unknown --")] + _bull_choices()
        calf_form.breeding_group_id.choices = [(0, "-- None --")] + [
            (g.id, f"{g.location.name} ({g.start_date})") for g in BreedingGroup.query.order_by(BreedingGroup.start_date.desc()).all()
        ]
        calf_form.birth_location_id.choices = _location_choices()
        calf_form.birth_location_id.data = animal.location_id or 0
        calf_form.animal_type_id.choices = _type_choices()

    castration_form = None
    if animal.sex == SEX_MALE:
        castration_form = CastrationForm(castration_date=date.today())

    epd_form = None
    semen_form = None
    if animal.is_bull:
        epd_form = BullEPDForm(obj=animal.epd) if animal.epd else BullEPDForm()
        semen_form = SemenTestForm(test_date=date.today())

    feedout_form = FeedoutForm(start_date=date.today())

    return render_template(
        "animals/detail.html", animal=animal, weight_form=weight_form, health_form=health_form,
        last_seen_form=last_seen_form, calf_form=calf_form, castration_form=castration_form,
        epd_form=epd_form, semen_form=semen_form, feedout_form=feedout_form,
        departure_form=DepartureForm(departure_date=date.today()),
        inbreeding_check_url=url_for("animals.list_breeding_groups"),
    )


@animals_bp.route("/new", methods=["GET", "POST"])
@login_required
def new_animal():
    form = AnimalForm()
    form.animal_type_id.choices = _type_choices()
    form.location_id.choices = _location_choices()
    form.birth_location_id.choices = _location_choices()
    form.sire_id.choices = [(0, "-- None --")] + _bull_choices()
    form.dam_id.choices = [(0, "-- None --")] + _cow_choices()

    if form.validate_on_submit():
        tag = (form.tag_id.data or "").strip() or None
        if tag and Animal.query.filter_by(tag_id=tag).first():
            flash("An animal with that tag/ID already exists.", "danger")
        else:
            atype = AnimalType.query.get(form.animal_type_id.data)
            animal = Animal(
                tag_id=tag,
                temp_id=None if tag else generate_temp_id(),
                name=form.name.data,
                animal_type_id=atype.id,
                sex=atype.sex,
                breed=form.breed.data,
                birth_date=form.birth_date.data,
                birth_weight=form.birth_weight.data,
                color=form.color.data,
                location_id=form.location_id.data or None,
                birth_location_id=form.birth_location_id.data or None,
                sire_id=form.sire_id.data or None,
                dam_id=form.dam_id.data or None,
                registration_number=form.registration_number.data,
                notes=form.notes.data,
                created_by_id=current_user.id,
            )
            if current_user.is_owner:
                animal.purchase_date = form.purchase_date.data
                animal.purchase_price = form.purchase_price.data

            animal.photo_filename = save_upload(form.photo.data)
            animal.registration_file = save_upload(form.registration_file.data)

            db.session.add(animal)
            db.session.commit()
            apply_candidate_sires(animal)
            db.session.commit()
            flash(f"Animal {animal.display_id} added.", "success")
            return redirect(url_for("animals.view_animal", animal_id=animal.id))

    return render_template("animals/form.html", form=form, title="Add Animal")


@animals_bp.route("/<int:animal_id>/edit", methods=["GET", "POST"])
@login_required
def edit_animal(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = AnimalForm(obj=animal)
    form.animal_type_id.choices = _type_choices(active_only=False)
    form.location_id.choices = _location_choices()
    form.birth_location_id.choices = _location_choices()
    form.sire_id.choices = [(0, "-- None --")] + [c for c in _bull_choices() if c[0] != animal.id]
    form.dam_id.choices = [(0, "-- None --")] + [c for c in _cow_choices() if c[0] != animal.id]

    if request.method == "GET":
        form.sire_id.data = animal.sire_id or 0
        form.dam_id.data = animal.dam_id or 0
        form.location_id.data = animal.location_id or 0
        form.birth_location_id.data = animal.birth_location_id or 0

    if form.validate_on_submit():
        tag = (form.tag_id.data or "").strip() or None
        existing = Animal.query.filter_by(tag_id=tag).first() if tag else None
        if existing and existing.id != animal.id:
            flash("An animal with that tag/ID already exists.", "danger")
        else:
            atype = AnimalType.query.get(form.animal_type_id.data)
            animal.tag_id = tag
            animal.name = form.name.data
            animal.animal_type_id = atype.id
            animal.sex = atype.sex
            animal.breed = form.breed.data
            animal.birth_date = form.birth_date.data
            animal.birth_weight = form.birth_weight.data
            animal.color = form.color.data
            animal.location_id = form.location_id.data or None
            animal.birth_location_id = form.birth_location_id.data or None
            animal.sire_id = form.sire_id.data or None
            animal.dam_id = form.dam_id.data or None
            animal.registration_number = form.registration_number.data
            animal.notes = form.notes.data

            if current_user.is_owner:
                animal.purchase_date = form.purchase_date.data
                animal.purchase_price = form.purchase_price.data

            new_photo = save_upload(form.photo.data)
            if new_photo:
                animal.photo_filename = new_photo
            new_reg = save_upload(form.registration_file.data)
            if new_reg:
                animal.registration_file = new_reg

            db.session.commit()
            flash(f"Animal {animal.display_id} updated.", "success")
            return redirect(url_for("animals.view_animal", animal_id=animal.id))

    return render_template("animals/form.html", form=form, title=f"Edit {animal.display_id}")


@animals_bp.route("/<int:animal_id>/departure", methods=["POST"])
@login_required
def record_departure(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = DepartureForm()
    if form.validate_on_submit():
        animal.is_active = False
        animal.departure_reason = form.departure_reason.data
        animal.departure_date = form.departure_date.data
        if form.notes.data:
            animal.notes = (animal.notes + "\n" if animal.notes else "") + form.notes.data
        db.session.commit()
        flash(f"{animal.display_id} marked as {form.departure_reason.data}.", "info")
    else:
        flash("Could not record departure - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


@animals_bp.route("/<int:animal_id>/delete", methods=["POST"])
@login_required
@owner_required
def delete_animal(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    if animal.sale_lines or animal.rentals:
        flash("Cannot delete an animal with rental or sale history. Record a departure instead.", "danger")
        return redirect(url_for("animals.view_animal", animal_id=animal.id))
    db.session.delete(animal)
    db.session.commit()
    flash("Animal removed.", "info")
    return redirect(url_for("animals.list_animals"))


# ---------------------------------------------------------------- weight/health/last seen --

@animals_bp.route("/<int:animal_id>/weight", methods=["POST"])
@login_required
def add_weight(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = WeightRecordForm()
    if form.validate_on_submit():
        db.session.add(WeightRecord(
            animal_id=animal.id, weight=form.weight.data, date_recorded=form.date_recorded.data,
            notes=form.notes.data, recorded_by_id=current_user.id,
        ))
        db.session.commit()
        flash("Weight record added.", "success")
    else:
        flash("Could not add weight record - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


@animals_bp.route("/<int:animal_id>/health", methods=["POST"])
@login_required
def add_health(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = HealthRecordForm()
    if form.validate_on_submit():
        db.session.add(HealthRecord(
            animal_id=animal.id, record_type=form.record_type.data, description=form.description.data,
            date_recorded=form.date_recorded.data, vet_name=form.vet_name.data, cost=form.cost.data,
            next_due_date=form.next_due_date.data, recorded_by_id=current_user.id,
        ))
        db.session.commit()
        flash("Health record added.", "success")
    else:
        flash("Could not add health record - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


@animals_bp.route("/<int:animal_id>/last-seen", methods=["POST"])
@login_required
def add_last_seen(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = LastSeenCheckForm()
    form.location_id.choices = _location_choices()
    if form.validate_on_submit():
        db.session.add(LastSeenCheck(
            animal_id=animal.id, date_recorded=form.date_recorded.data,
            location_id=form.location_id.data or None, health_status=form.health_status.data,
            notes=form.notes.data, seen_by_id=current_user.id,
        ))
        db.session.commit()
        flash("Inventory check logged.", "success")
    else:
        flash("Could not log check - review the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


# ---------------------------------------------------------------- bulk operations --

@animals_bp.route("/bulk", methods=["POST"])
@login_required
def bulk_action():
    action = request.form.get("action")
    animal_ids = request.form.getlist("animal_ids", type=int)
    if not animal_ids:
        flash("Select at least one animal first.", "warning")
        return redirect(request.referrer or url_for("animals.list_animals"))

    animals = Animal.query.filter(Animal.id.in_(animal_ids)).all()

    if action == "move":
        location_id = request.form.get("location_id", type=int)
        location = Location.query.get(location_id) if location_id else None
        if not location:
            flash("Pick a location to move the selected animals to.", "warning")
        else:
            for a in animals:
                a.location_id = location.id
            db.session.commit()
            flash(f"Moved {len(animals)} animal(s) to {location.display_name}.", "success")

    elif action == "vaccinate":
        description = request.form.get("description", "").strip()
        date_recorded = request.form.get("date_recorded") or date.today().isoformat()
        vet_name = request.form.get("vet_name") or None
        cost = request.form.get("cost") or None
        next_due_date = request.form.get("next_due_date") or None
        if not description:
            flash("Enter a vaccine/description to apply to the selected animals.", "warning")
        else:
            for a in animals:
                db.session.add(HealthRecord(
                    animal_id=a.id, record_type="vaccination", description=description,
                    date_recorded=date.fromisoformat(date_recorded),
                    vet_name=vet_name, cost=cost or None,
                    next_due_date=date.fromisoformat(next_due_date) if next_due_date else None,
                    recorded_by_id=current_user.id,
                ))
            db.session.commit()
            flash(f"Logged vaccination for {len(animals)} animal(s).", "success")

    elif action == "semen_test":
        test_date = request.form.get("semen_test_date") or date.today().isoformat()
        result = request.form.get("semen_test_result")
        notes = request.form.get("semen_test_notes") or None
        bulls = [a for a in animals if a.is_bull]
        skipped = len(animals) - len(bulls)
        if result not in dict((r, r) for r in ("Good", "Bad", "Retest")):
            flash("Pick a semen test result to apply to the selected bulls.", "warning")
        elif not bulls:
            flash("None of the selected animals are bulls.", "warning")
        else:
            for b in bulls:
                db.session.add(SemenTest(
                    bull_id=b.id, test_date=date.fromisoformat(test_date), result=result,
                    notes=notes, recorded_by_id=current_user.id,
                ))
            db.session.commit()
            msg = f"Logged a semen test for {len(bulls)} bull(s)."
            if skipped:
                msg += f" Skipped {skipped} non-bull animal(s)."
            flash(msg, "success")

    elif action == "sell":
        session["bulk_sale_ids"] = animal_ids
        return redirect(url_for("sales.new_sale"))

    else:
        flash("Unknown bulk action.", "danger")

    return redirect(request.referrer or url_for("animals.list_animals"))


# ---------------------------------------------------------------- CSV import --

@animals_bp.route("/import", methods=["GET", "POST"])
@login_required
@owner_required
def import_csv():
    import csv
    import io

    form = ImportCSVForm()
    errors = []
    imported = 0
    if form.validate_on_submit():
        stream = io.StringIO(form.csv_file.data.stream.read().decode("utf-8-sig"))
        reader = csv.DictReader(stream)
        types_by_name = {t.name.lower(): t for t in AnimalType.query.all()}
        locations_by_name = {l.name.lower(): l for l in Location.query.all()}

        for i, row in enumerate(reader, start=2):
            tag = (row.get("tag_id") or "").strip() or None
            type_name = (row.get("animal_type") or "").strip().lower()
            atype = types_by_name.get(type_name)
            if not atype:
                errors.append(f"Row {i}: unknown animal type '{row.get('animal_type')}'")
                continue
            if tag and Animal.query.filter_by(tag_id=tag).first():
                errors.append(f"Row {i}: tag '{tag}' already exists, skipped")
                continue

            loc = locations_by_name.get((row.get("location") or "").strip().lower())
            birth_date = None
            if row.get("birth_date"):
                try:
                    birth_date = date.fromisoformat(row["birth_date"].strip())
                except ValueError:
                    errors.append(f"Row {i}: bad birth_date '{row['birth_date']}', left blank")

            animal = Animal(
                tag_id=tag,
                temp_id=None if tag else generate_temp_id(),
                name=(row.get("name") or "").strip() or None,
                animal_type_id=atype.id,
                sex=atype.sex,
                breed=(row.get("breed") or "").strip() or None,
                birth_date=birth_date,
                color=(row.get("color") or "").strip() or None,
                location_id=loc.id if loc else None,
                registration_number=(row.get("registration_number") or "").strip() or None,
                notes=(row.get("notes") or "").strip() or None,
                created_by_id=current_user.id,
            )
            db.session.add(animal)
            imported += 1

        db.session.commit()
        flash(f"Imported {imported} animal(s).{' ' + str(len(errors)) + ' row(s) had issues.' if errors else ''}", "success" if not errors else "warning")

    return render_template("animals/import.html", form=form, errors=errors, imported=imported)


# ---------------------------------------------------------------- Cows / calves --

@animals_bp.route("/cows")
@login_required
def list_cows():
    cows = [
        a for a in Animal.query.filter_by(is_active=True, sex=SEX_FEMALE).order_by(Animal.tag_id).all()
        if a.animal_type and ("Cow" in a.animal_type.name or "Heifer" in a.animal_type.name)
    ]
    return render_template("animals/cows_list.html", cows=cows)


@animals_bp.route("/<int:cow_id>/calves/new", methods=["POST"])
@login_required
def record_calf(cow_id):
    dam = Animal.query.get_or_404(cow_id)
    form = CalfBirthForm()
    form.sire_id.choices = [(0, "-- Unknown --")] + _bull_choices()
    form.breeding_group_id.choices = [(0, "-- None --")] + [
        (g.id, f"{g.location.name} ({g.start_date})") for g in BreedingGroup.query.order_by(BreedingGroup.start_date.desc()).all()
    ]
    form.birth_location_id.choices = _location_choices()
    form.animal_type_id.choices = _type_choices()

    if form.validate_on_submit():
        birth_location_id = form.birth_location_id.data or dam.location_id
        calf = Animal(
            temp_id=generate_temp_id(),
            animal_type_id=form.animal_type_id.data,
            sex=form.calf_sex.data,
            birth_date=form.calving_date.data,
            birth_weight=form.birth_weight.data,
            location_id=dam.location_id,
            birth_location_id=birth_location_id,
            dam_id=dam.id,
            sire_id=form.sire_id.data or None,
            notes=form.notes.data,
            created_by_id=current_user.id,
        )
        db.session.add(calf)
        db.session.commit()
        apply_candidate_sires(calf)

        record = CalfRecord(
            dam_id=dam.id,
            sire_id=form.sire_id.data or None,
            breeding_group_id=form.breeding_group_id.data or None,
            calving_date=form.calving_date.data,
            calf_sex=form.calf_sex.data,
            birth_weight=form.birth_weight.data,
            calf_animal_id=calf.id,
            outcome=CALF_OUTCOME_ACTIVE,
            notes=form.notes.data,
            created_by_id=current_user.id,
        )
        db.session.add(record)
        db.session.commit()
        flash(f"Calf recorded for {dam.display_id} (temp ID {calf.temp_id}).", "success")
    else:
        flash("Could not record the calf - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=dam.id))


@animals_bp.route("/calf/<int:calf_record_id>/outcome", methods=["POST"])
@login_required
def update_calf_outcome(calf_record_id):
    record = CalfRecord.query.get_or_404(calf_record_id)
    form = CalfOutcomeForm()
    if form.validate_on_submit():
        record.outcome = form.outcome.data
        record.cull_reason = form.cull_reason.data
        record.notes = form.notes.data
        if form.weaned_date.data:
            record.weaned_date = form.weaned_date.data
            apply_weaning_transfer(record)

        if record.calf_animal:
            from app.models import (
                CALF_OUTCOME_CULLED, CALF_OUTCOME_DIED_AFTER_BIRTH, CALF_OUTCOME_LOST,
                DEPARTURE_CULLED, DEPARTURE_DECEASED, DEPARTURE_LOST,
            )
            departure_map = {
                CALF_OUTCOME_LOST: DEPARTURE_LOST,
                CALF_OUTCOME_DIED_AFTER_BIRTH: DEPARTURE_DECEASED,
                CALF_OUTCOME_CULLED: DEPARTURE_CULLED,
            }
            if record.outcome in departure_map:
                record.calf_animal.is_active = False
                record.calf_animal.departure_reason = departure_map[record.outcome]
                record.calf_animal.departure_date = record.weaned_date or date.today()

        db.session.commit()
        flash("Calf outcome updated.", "success")
    else:
        flash("Could not update outcome - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=record.dam_id))


# ---------------------------------------------------------------- Breeding groups --

@animals_bp.route("/breeding")
@login_required
def list_breeding_groups():
    auto_sync_breeding_exposure()
    groups = BreedingGroup.query.order_by(BreedingGroup.start_date.desc()).all()
    return render_template("animals/breeding_list.html", groups=groups)


@animals_bp.route("/breeding/new", methods=["GET", "POST"])
@login_required
def new_breeding_group():
    form = BreedingGroupForm()
    form.location_id.choices = _location_choices(include_blank=False)
    form.bull_ids.choices = _bull_choices()

    if form.validate_on_submit():
        group = BreedingGroup(
            location_id=form.location_id.data, start_date=form.start_date.data,
            end_date=form.end_date.data, notes=form.notes.data, created_by_id=current_user.id,
        )
        group.bulls = Animal.query.filter(Animal.id.in_(form.bull_ids.data)).all()
        db.session.add(group)
        db.session.commit()
        flash("Breeding group saved.", "success")
        return redirect(url_for("animals.view_breeding_group", group_id=group.id))

    return render_template("animals/breeding_form.html", form=form, title="New Breeding Group")


@animals_bp.route("/breeding/<int:group_id>")
@login_required
def view_breeding_group(group_id):
    group = BreedingGroup.query.get_or_404(group_id)
    add_form = AddToBreedingGroupForm()
    already_in = {e.animal_id for e in group.exposures}
    add_form.animal_ids.choices = [c for c in _cow_choices() if c[0] not in already_in]
    confirm_form = ConfirmBredForm()

    warnings_by_cow = {}
    for exposure in group.exposures:
        warnings = []
        for bull in group.bulls:
            warnings += inbreeding_warnings(bull, exposure.animal)
        if warnings:
            warnings_by_cow[exposure.id] = warnings

    return render_template(
        "animals/breeding_detail.html", group=group, add_form=add_form,
        confirm_form=confirm_form, warnings_by_cow=warnings_by_cow,
    )


@animals_bp.route("/breeding/<int:group_id>/add-cows", methods=["POST"])
@login_required
def add_cows_to_group(group_id):
    group = BreedingGroup.query.get_or_404(group_id)
    form = AddToBreedingGroupForm()
    already_in = {e.animal_id for e in group.exposures}
    form.animal_ids.choices = [c for c in _cow_choices() if c[0] not in already_in]

    if form.validate_on_submit():
        warning_count = 0
        for animal_id in form.animal_ids.data:
            cow = Animal.query.get(animal_id)
            for bull in group.bulls:
                if inbreeding_warnings(bull, cow):
                    warning_count += 1
                    break
            db.session.add(ExposureRecord(breeding_group_id=group.id, animal_id=animal_id))
        db.session.commit()
        msg = f"Added {len(form.animal_ids.data)} animal(s) to the group."
        if warning_count:
            msg += f" {warning_count} flagged with a possible inbreeding warning - review below."
        flash(msg, "warning" if warning_count else "success")
    else:
        flash("Select at least one animal.", "danger")
    return redirect(url_for("animals.view_breeding_group", group_id=group.id))


@animals_bp.route("/breeding/exposure/<int:exposure_id>/confirm", methods=["POST"])
@login_required
def confirm_bred(exposure_id):
    exposure = ExposureRecord.query.get_or_404(exposure_id)
    form = ConfirmBredForm()
    if form.validate_on_submit():
        if form.confirmed_bred.data == "yes":
            exposure.confirmed_bred = True
        elif form.confirmed_bred.data == "no":
            exposure.confirmed_bred = False
        else:
            exposure.confirmed_bred = None
        exposure.confirmed_bred_date = form.confirmed_bred_date.data
        exposure.notes = form.notes.data
        db.session.commit()
        flash("Breeding status updated.", "success")
    return redirect(url_for("animals.view_breeding_group", group_id=exposure.breeding_group_id))


# ---------------------------------------------------------------- Steers / castration --

@animals_bp.route("/<int:animal_id>/castration", methods=["POST"])
@login_required
def record_castration(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = CastrationForm()
    if form.validate_on_submit():
        animal.castration_date = form.castration_date.data
        animal.castration_method = form.castration_method.data
        db.session.commit()
        flash("Castration recorded.", "success")
    else:
        flash("Could not save castration record - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


# ---------------------------------------------------------------- Bulls: EPD / semen --

@animals_bp.route("/bulls")
@login_required
def list_bulls():
    bulls = [a for a in Animal.query.filter_by(is_active=True, sex=SEX_MALE).order_by(Animal.tag_id).all() if a.is_bull]
    return render_template("animals/bulls_list.html", bulls=bulls)


@animals_bp.route("/bulls/export")
@login_required
def export_bulls():
    import csv
    import io

    from flask import Response

    type_id = request.args.get("type_id", type=int)
    location_id = request.args.get("location_id", type=int)
    q = (request.args.get("q") or "").strip()

    query = Animal.query.filter_by(is_active=True, sex=SEX_MALE)
    if type_id:
        query = query.filter_by(animal_type_id=type_id)
    if location_id:
        query = query.filter_by(location_id=location_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            db.or_(Animal.tag_id.ilike(like), Animal.temp_id.ilike(like), Animal.name.ilike(like))
        )
    bulls = [a for a in query.order_by(Animal.tag_id).all() if a.is_bull]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Type", "Location", "Semen Test Result", "Semen Test Date",
        "Availability", "Renter", "Rental Start", "Rental End", "Rental Status",
    ])
    for b in bulls:
        test = b.latest_semen_test
        rental = b.latest_rental
        writer.writerow([
            b.display_id,
            b.animal_type.name if b.animal_type else "",
            b.location.display_name if b.location else "",
            test.result if test else "",
            test.test_date.isoformat() if test else "",
            "Available" if b.is_rentable_available else (b.rental_unavailable_reason or ""),
            rental.customer.name if rental else "",
            rental.start_date.isoformat() if rental else "",
            rental.end_date.isoformat() if rental else "",
            rental.status if rental else "",
        ])

    response = Response(output.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=bulls_export.csv"
    return response


@animals_bp.route("/<int:animal_id>/epd", methods=["POST"])
@login_required
def edit_epd(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = BullEPDForm()
    if form.validate_on_submit():
        epd = animal.epd or BullEPD(animal_id=animal.id)
        epd.ced = form.ced.data
        epd.birth_weight_epd = form.birth_weight_epd.data
        epd.weaning_weight_epd = form.weaning_weight_epd.data
        epd.yearling_weight_epd = form.yearling_weight_epd.data
        epd.milk_epd = form.milk_epd.data
        epd.marbling_epd = form.marbling_epd.data
        epd.ribeye_area_epd = form.ribeye_area_epd.data
        if not animal.epd:
            db.session.add(epd)
        db.session.commit()
        flash("EPDs saved.", "success")
    else:
        flash("Could not save EPDs - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


@animals_bp.route("/<int:animal_id>/semen-test", methods=["POST"])
@login_required
def add_semen_test(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = SemenTestForm()
    if form.validate_on_submit():
        db.session.add(SemenTest(
            bull_id=animal.id, test_date=form.test_date.data, result=form.result.data,
            notes=form.notes.data, recorded_by_id=current_user.id,
        ))
        db.session.commit()
        flash("Semen test recorded.", "success")
    else:
        flash("Could not save semen test - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


# ---------------------------------------------------------------- Feedlot / butcher --

@animals_bp.route("/feedlot")
@login_required
def list_feedlot():
    records = FeedoutRecord.query.order_by(FeedoutRecord.start_date.desc()).all()
    return render_template("animals/feedlot_list.html", records=records)


@animals_bp.route("/<int:animal_id>/feedout", methods=["POST"])
@login_required
def add_feedout(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = FeedoutForm()
    if form.validate_on_submit():
        db.session.add(FeedoutRecord(
            animal_id=animal.id, start_date=form.start_date.data, start_weight=form.start_weight.data,
            days_on_feed=form.days_on_feed.data, end_date=form.end_date.data,
            hanging_weight=form.hanging_weight.data, dressed_yield_pct=form.dressed_yield_pct.data,
            steak_grade=form.steak_grade.data or None, notes=form.notes.data, created_by_id=current_user.id,
        ))
        db.session.commit()
        flash("Feedout record saved.", "success")
    else:
        flash("Could not save feedout record - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))
