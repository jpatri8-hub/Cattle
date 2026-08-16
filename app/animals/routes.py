from datetime import date

from flask import Blueprint, abort, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required

from app import db
from app.decorators import owner_required
from app.forms import (
    AddToBreedingGroupForm, AnimalForm, BreedingGroupForm, BulkLocationForm,
    BulkVaccinationForm, CalfBirthForm, CalfQualityForm,
    ConfirmBredForm, DepartureForm, FeedoutForm, HealthRecordForm, ImportCSVForm,
    LastSeenCheckForm, SemenTestForm, WeightRecordForm, BullEPDForm,
)
from app.lifecycle import (
    apply_candidate_sires, apply_weaning_transfer, auto_sync_breeding_exposure,
    choose_rotating_sire, compute_calf_type, compute_dam_candidate_sires,
    generate_temp_id,
)
from app.models import (
    Animal, AnimalType, BreedingGroup, BullEPD, CALVING_EASE_CHOICES, CalfRecord,
    ExposureRecord, FeedoutRecord, HealthRecord, LastSeenCheck,
    Location, RENTAL_ACTIVE, RENTAL_BOOKED, SemenTest, SEX_FEMALE, SEX_MALE, WeightRecord,
)
from app.pedigree import coefficient_of_inbreeding_pct

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
    locs = Location.query.filter_by(is_active=True).order_by(Location.name).all()
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
    sale_bulls = request.args.get("sale_bulls") == "1"
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
    if sale_bulls:
        query = query.filter_by(is_sale_bull=True)
    if q:
        like = f"%{q}%"
        query = query.filter(
            db.or_(Animal.tag_id.ilike(like), Animal.temp_id.ilike(like), Animal.name.ilike(like))
        )

    animals = query.order_by(Animal.tag_id).all()

    if has_calf:
        animals = [a for a in animals if a.has_calf_at_side]
    if flagged:
        animals = [a for a in animals if a.not_seen_flagged]

    types = AnimalType.query.order_by(AnimalType.name).all()
    locations = Location.query.filter_by(is_active=True).order_by(Location.name).all()

    groups = {}
    for a in animals:
        type_name = a.animal_type.name if a.animal_type else "No Type"
        groups.setdefault(type_name, []).append(a)
    grouped_animals = [(name, groups[name]) for name in sorted(groups.keys())]

    return render_template(
        "animals/list.html", animals=animals, grouped_animals=grouped_animals,
        types=types, locations=locations,
        type_id=type_id, location_id=location_id, current_only=current_only,
        has_calf=has_calf, flagged=flagged, sale_bulls=sale_bulls, q=q,
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
        calf_form.birth_location_id.choices = _location_choices()
        calf_form.birth_location_id.data = animal.location_id or 0

    epd_form = None
    semen_form = None
    if animal.is_bull:
        epd_form = BullEPDForm(obj=animal.epd) if animal.epd else BullEPDForm()
        semen_form = SemenTestForm(test_date=date.today())

    feedout_form = FeedoutForm(start_date=date.today())

    quality_form = None
    calving_ease_label = None
    if animal.calf_record:
        quality_form = CalfQualityForm(quality=animal.calf_record.quality or "")
        calving_ease_label = dict(CALVING_EASE_CHOICES).get(animal.calf_record.calving_ease, "Not recorded")

    return render_template(
        "animals/detail.html", animal=animal, weight_form=weight_form, health_form=health_form,
        last_seen_form=last_seen_form, calf_form=calf_form,
        epd_form=epd_form, semen_form=semen_form, feedout_form=feedout_form,
        quality_form=quality_form, calving_ease_label=calving_ease_label,
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
        brand_number = (form.brand_number.data or "").strip() or None
        if brand_number and Animal.query.filter_by(brand_number=brand_number).first():
            flash("An animal with that brand number already exists.", "danger")
        else:
            atype = AnimalType.query.get(form.animal_type_id.data)
            animal = Animal(
                tag_id=tag,
                temp_id=None if tag else generate_temp_id(),
                name=brand_number or form.name.data,
                animal_type_id=atype.id,
                sex=atype.sex,
                birth_date=form.birth_date.data,
                birth_weight=form.birth_weight.data,
                location_id=form.location_id.data or None,
                birth_location_id=form.birth_location_id.data or None,
                sire_id=form.sire_id.data or None,
                dam_id=form.dam_id.data or None,
                registration_number=form.registration_number.data,
                brand_type=form.brand_type.data or None,
                brand_number=brand_number,
                is_sale_bull=form.is_sale_bull.data,
                is_cripple=form.is_cripple.data,
                notes=form.notes.data,
                created_by_id=current_user.id,
            )
            if current_user.is_owner:
                animal.purchase_date = form.purchase_date.data
                animal.purchase_price = form.purchase_price.data

            db.session.add(animal)
            db.session.commit()
            apply_candidate_sires(animal)
            db.session.commit()
            flash(f"Animal {animal.display_id} added.", "success")
            return redirect(url_for("animals.view_animal", animal_id=animal.id))

    return render_template("animals/form.html", form=form, title="Add Animal")


@animals_bp.route("/<int:animal_id>/edit", methods=["GET", "POST"])
@login_required
@owner_required
def edit_animal(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    back = request.values.get("back") or None
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
        brand_number = (form.brand_number.data or "").strip() or None
        existing_brand = Animal.query.filter_by(brand_number=brand_number).first() if brand_number else None
        if existing_brand and existing_brand.id != animal.id:
            flash("An animal with that brand number already exists.", "danger")
        else:
            atype = AnimalType.query.get(form.animal_type_id.data)
            animal.tag_id = tag
            animal.name = brand_number or form.name.data
            animal.animal_type_id = atype.id
            animal.sex = atype.sex
            animal.birth_date = form.birth_date.data
            animal.birth_weight = form.birth_weight.data
            animal.location_id = form.location_id.data or None
            animal.birth_location_id = form.birth_location_id.data or None
            animal.sire_id = form.sire_id.data or None
            animal.dam_id = form.dam_id.data or None
            animal.registration_number = form.registration_number.data
            animal.brand_type = form.brand_type.data or None
            animal.brand_number = brand_number
            animal.is_sale_bull = form.is_sale_bull.data
            animal.is_cripple = form.is_cripple.data
            animal.notes = form.notes.data

            if current_user.is_owner:
                animal.purchase_date = form.purchase_date.data
                animal.purchase_price = form.purchase_price.data

            db.session.commit()
            flash(f"Animal {animal.display_id} updated.", "success")
            return redirect(url_for("animals.view_animal", animal_id=animal.id, back=back))

    return render_template("animals/form.html", form=form, title=f"Edit {animal.display_id}", back=back)


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
@owner_required
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
@owner_required
def add_health(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = HealthRecordForm()
    if form.validate_on_submit():
        db.session.add(HealthRecord(
            animal_id=animal.id, record_type=form.record_type.data, description=form.description.data,
            date_recorded=form.date_recorded.data,
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

OWNER_ONLY_BULK_ACTIONS = {"move", "vaccinate", "semen_test", "sell", "create_breeding_group"}


@animals_bp.route("/bulk", methods=["POST"])
@login_required
def bulk_action():
    action = request.form.get("action")
    if action in OWNER_ONLY_BULK_ACTIONS and not current_user.is_owner:
        abort(403)
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
        next_due_date = request.form.get("next_due_date") or None
        if not description:
            flash("Enter a vaccine/description to apply to the selected animals.", "warning")
        else:
            for a in animals:
                db.session.add(HealthRecord(
                    animal_id=a.id, record_type="vaccination", description=description,
                    date_recorded=date.fromisoformat(date_recorded),
                    next_due_date=date.fromisoformat(next_due_date) if next_due_date else None,
                    recorded_by_id=current_user.id,
                ))
            db.session.commit()
            flash(f"Logged vaccination for {len(animals)} animal(s).", "success")

    elif action == "mark_seen":
        date_recorded = request.form.get("seen_date") or date.today().isoformat()
        location_id = request.form.get("seen_location_id", type=int)
        notes = request.form.get("seen_notes") or None
        for a in animals:
            db.session.add(LastSeenCheck(
                animal_id=a.id, date_recorded=date.fromisoformat(date_recorded),
                location_id=location_id or a.location_id, health_status="Healthy",
                notes=notes, seen_by_id=current_user.id,
            ))
        db.session.commit()
        flash(f"Marked {len(animals)} animal(s) as seen.", "success")

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

    elif action == "create_breeding_group":
        bg_location_id = request.form.get("bg_location_id", type=int)
        bg_start_date = request.form.get("bg_start_date") or date.today().isoformat()
        females = [a for a in animals if a.sex == SEX_FEMALE]
        skipped = len(animals) - len(females)
        location = Location.query.get(bg_location_id) if bg_location_id else None
        if not location:
            flash("Pick a location for the new breeding group.", "warning")
        elif not females:
            flash("None of the selected animals are female - pick cows/heifers to expose.", "warning")
        else:
            group = BreedingGroup(
                location_id=location.id, start_date=date.fromisoformat(bg_start_date),
                is_auto=False, created_by_id=current_user.id,
            )
            db.session.add(group)
            db.session.flush()
            for f in females:
                db.session.add(ExposureRecord(breeding_group_id=group.id, animal_id=f.id))
            db.session.commit()
            msg = f"Created a breeding group with {len(females)} animal(s), no bull assigned yet."
            if skipped:
                msg += f" Skipped {skipped} non-female animal(s)."
            flash(msg, "success")
            return redirect(url_for("animals.view_breeding_group", group_id=group.id))

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
                birth_date=birth_date,
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
    form.birth_location_id.choices = _location_choices()

    if form.validate_on_submit():
        calf_type = compute_calf_type(dam, form.calf_sex.data)
        if not calf_type:
            flash(
                "Could not figure out the calf's type - make sure a matching "
                "\"Registered Angus/Commercial Bull/Heifer Calf\" type exists under Admin.",
                "danger",
            )
            return redirect(url_for("animals.view_animal", animal_id=dam.id))

        birth_location_id = form.birth_location_id.data or dam.location_id
        calf = Animal(
            temp_id=generate_temp_id(),
            animal_type_id=calf_type.id,
            sex=form.calf_sex.data,
            birth_date=form.calving_date.data,
            birth_weight=form.birth_weight.data,
            location_id=dam.location_id,
            birth_location_id=birth_location_id,
            dam_id=dam.id,
            notes=form.notes.data,
            created_by_id=current_user.id,
        )
        db.session.add(calf)
        db.session.commit()

        candidate_sires, matched_groups = compute_dam_candidate_sires(dam, form.calving_date.data)
        calf.candidate_sires = candidate_sires
        chosen_group = matched_groups[0] if len(matched_groups) == 1 else None
        chosen_sire = choose_rotating_sire(candidate_sires)
        if chosen_sire:
            calf.sire_id = chosen_sire.id
        db.session.commit()

        record = CalfRecord(
            dam_id=dam.id,
            sire_id=chosen_sire.id if chosen_sire else None,
            breeding_group_id=chosen_group.id if chosen_group else None,
            calving_date=form.calving_date.data,
            calf_sex=form.calf_sex.data,
            birth_weight=form.birth_weight.data,
            calf_animal_id=calf.id,
            calving_ease=form.calving_ease.data or None,
            created_by_id=current_user.id,
        )
        db.session.add(record)
        db.session.commit()

        msg = f"Calf recorded for {dam.display_id} ({calf_type.name}, temp ID {calf.temp_id})."
        if chosen_sire:
            msg += f" Sire assigned: {chosen_sire.display_id}"
            if len(candidate_sires) > 1:
                msg += f" (rotated among {len(candidate_sires)} bulls she was exposed to)"
            msg += "."
        else:
            msg += " No breeding exposure found in the prior 6-12 months, so no sire could be assigned automatically."
        flash(msg, "success")
    else:
        flash("Could not record the calf - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=dam.id))


@animals_bp.route("/calf/<int:calf_record_id>/quality", methods=["POST"])
@login_required
def update_calf_quality(calf_record_id):
    record = CalfRecord.query.get_or_404(calf_record_id)
    form = CalfQualityForm()
    redirect_to = record.calf_animal_id or record.dam_id
    if form.validate_on_submit():
        record.quality = form.quality.data or None
        record.weaning_weight = form.weaning_weight.data
        if form.weaned_date.data:
            record.weaned_date = form.weaned_date.data
            apply_weaning_transfer(record)
        db.session.commit()
        flash("Calf record updated.", "success")
    else:
        flash("Could not update the calf record - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=redirect_to))


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


HIGH_COI_PCT = 6.25  # first-cousin level or closer; flagged as a review-worthy pairing


@animals_bp.route("/breeding/<int:group_id>")
@login_required
def view_breeding_group(group_id):
    group = BreedingGroup.query.get_or_404(group_id)
    add_form = AddToBreedingGroupForm()
    already_in = {e.animal_id for e in group.exposures}
    add_form.animal_ids.choices = [c for c in _cow_choices() if c[0] not in already_in]
    confirm_form = ConfirmBredForm()

    cows_in_group = [e.animal for e in group.exposures]

    coi_by_exposure = {}
    for exposure in group.exposures:
        coi_by_exposure[exposure.id] = {
            bull.id: coefficient_of_inbreeding_pct(bull.id, exposure.animal_id) for bull in group.bulls
        }

    group_bull_ids = {b.id for b in group.bulls}
    available_bulls_coi = []
    if cows_in_group:
        candidate_bulls = [
            a for a in Animal.query.filter_by(is_active=True, sex=SEX_MALE).all()
            if a.is_bull and a.id not in group_bull_ids and a.is_rentable_available
        ]
        for bull in candidate_bulls:
            worst_cow, worst_coi = None, -1.0
            for cow in cows_in_group:
                coi = coefficient_of_inbreeding_pct(bull.id, cow.id)
                if coi > worst_coi:
                    worst_coi, worst_cow = coi, cow
            available_bulls_coi.append({"bull": bull, "coi": worst_coi, "cow": worst_cow})
        available_bulls_coi.sort(key=lambda r: r["coi"])

    return render_template(
        "animals/breeding_detail.html", group=group, add_form=add_form,
        confirm_form=confirm_form, coi_by_exposure=coi_by_exposure,
        available_bulls_coi=available_bulls_coi, high_coi_pct=HIGH_COI_PCT,
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
            for bull in group.bulls:
                if coefficient_of_inbreeding_pct(bull.id, animal_id) >= HIGH_COI_PCT:
                    warning_count += 1
                    break
            db.session.add(ExposureRecord(breeding_group_id=group.id, animal_id=animal_id))
        db.session.commit()
        msg = f"Added {len(form.animal_ids.data)} animal(s) to the group."
        if warning_count:
            msg += f" {warning_count} flagged with a high inbreeding coefficient (COI >= {HIGH_COI_PCT}%) - review below."
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




# ---------------------------------------------------------------- Bulls: EPD / semen --

@animals_bp.route("/bulls")
@login_required
def list_bulls():
    low_bw = request.args.get("low_bw") == "1"
    cripple = request.args.get("cripple") == "1"
    bulls = [a for a in Animal.query.filter_by(is_active=True, sex=SEX_MALE).order_by(Animal.tag_id).all() if a.is_bull]
    if low_bw:
        bulls = [b for b in bulls if b.is_low_birth_weight_candidate]
    if cripple:
        bulls = [b for b in bulls if b.is_cripple]
    return render_template("animals/bulls_list.html", bulls=bulls, low_bw=low_bw, cripple=cripple)


@animals_bp.route("/<int:animal_id>/toggle-sale-bull", methods=["POST"])
@login_required
def toggle_sale_bull(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    animal.is_sale_bull = not animal.is_sale_bull
    db.session.commit()
    flash(
        f"{animal.display_id} marked as {'a Sale Bull (excluded from the Bull export).' if animal.is_sale_bull else 'no longer a Sale Bull.'}",
        "success",
    )
    return redirect(request.referrer or url_for("animals.list_bulls"))


@animals_bp.route("/<int:animal_id>/toggle-cripple", methods=["POST"])
@login_required
def toggle_cripple(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    animal.is_cripple = not animal.is_cripple
    db.session.commit()
    flash(
        f"{animal.display_id} marked as {'cripple (not available for rent).' if animal.is_cripple else 'no longer cripple.'}",
        "success",
    )
    return redirect(request.referrer or url_for("animals.list_bulls"))


@animals_bp.route("/bulls/export")
@login_required
def export_bulls():
    import csv
    import io

    from flask import Response

    type_id = request.args.get("type_id", type=int)
    location_id = request.args.get("location_id", type=int)
    q = (request.args.get("q") or "").strip()

    query = Animal.query.filter_by(is_active=True, sex=SEX_MALE, is_sale_bull=False)
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
        "ID", "Brand", "Location", "CED EPD", "Birth Weight EPD",
        "Availability", "Renter", "Rental Start", "Rental End", "Rental Status",
    ])
    for b in bulls:
        rental = b.latest_rental
        show_rental = False
        if rental:
            if rental.status in (RENTAL_ACTIVE, RENTAL_BOOKED):
                show_rental = True
            else:
                reference_date = rental.actual_return_date or rental.end_date
                if reference_date and (date.today() - reference_date).days <= 60:
                    show_rental = True
        writer.writerow([
            b.display_id,
            b.brand_number or "",
            b.location.display_name if b.location else "",
            b.epd.ced if b.epd else "",
            b.epd.birth_weight_epd if b.epd else "",
            "Available" if b.is_rentable_available else (b.rental_unavailable_reason or ""),
            rental.customer.name if show_rental else "",
            rental.start_date.isoformat() if show_rental else "",
            rental.end_date.isoformat() if show_rental else "",
            rental.status if show_rental else "",
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
@owner_required
def add_feedout(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = FeedoutForm()
    if form.validate_on_submit():
        db.session.add(FeedoutRecord(
            animal_id=animal.id, start_date=form.start_date.data, start_weight=form.start_weight.data,
            end_date=form.end_date.data, live_weight=form.live_weight.data, yield_weight=form.yield_weight.data,
            steak_grade=form.steak_grade.data or None, notes=form.notes.data, created_by_id=current_user.id,
        ))
        db.session.commit()
        flash("Feedout record saved.", "success")
    else:
        flash("Could not save feedout record - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))
