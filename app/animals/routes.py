from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from app import db
from app.decorators import owner_required
from app.forms import AnimalForm, BreedingRecordForm, HealthRecordForm, WeightRecordForm
from app.models import Animal, BreedingRecord, HealthRecord, STATUS_SOLD, WeightRecord
from app.utils import save_upload

animals_bp = Blueprint("animals", __name__, url_prefix="/animals")


def _sire_dam_choices():
    bulls = Animal.query.filter_by(sex="Bull").order_by(Animal.tag_id).all()
    cows = Animal.query.filter_by(sex="Cow").order_by(Animal.tag_id).all()
    sire_choices = [(0, "-- None --")] + [(a.id, a.tag_id) for a in bulls]
    dam_choices = [(0, "-- None --")] + [(a.id, a.tag_id) for a in cows]
    return sire_choices, dam_choices


@animals_bp.route("/")
@login_required
def list_animals():
    status_filter = request.args.get("status", "")
    sex_filter = request.args.get("sex", "")
    query = Animal.query
    if status_filter:
        query = query.filter_by(status=status_filter)
    if sex_filter:
        query = query.filter_by(sex=sex_filter)
    animals = query.order_by(Animal.tag_id).all()
    return render_template("animals/list.html", animals=animals, status_filter=status_filter, sex_filter=sex_filter)


@animals_bp.route("/<int:animal_id>")
@login_required
def view_animal(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    weight_form = WeightRecordForm()
    health_form = HealthRecordForm()
    return render_template("animals/detail.html", animal=animal, weight_form=weight_form, health_form=health_form)


@animals_bp.route("/new", methods=["GET", "POST"])
@login_required
def new_animal():
    form = AnimalForm()
    form.sire_id.choices, form.dam_id.choices = _sire_dam_choices()

    if form.validate_on_submit():
        if Animal.query.filter_by(tag_id=form.tag_id.data.strip()).first():
            flash("An animal with that tag/ID already exists.", "danger")
        else:
            animal = Animal(
                tag_id=form.tag_id.data.strip(),
                name=form.name.data,
                breed=form.breed.data,
                sex=form.sex.data,
                birth_date=form.birth_date.data,
                color=form.color.data,
                status=form.status.data,
                location=form.location.data,
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
            flash(f"Animal {animal.tag_id} added.", "success")
            return redirect(url_for("animals.view_animal", animal_id=animal.id))

    return render_template("animals/form.html", form=form, title="Add Animal")


@animals_bp.route("/<int:animal_id>/edit", methods=["GET", "POST"])
@login_required
def edit_animal(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = AnimalForm(obj=animal)
    form.sire_id.choices, form.dam_id.choices = _sire_dam_choices()

    if request.method == "GET":
        form.sire_id.data = animal.sire_id or 0
        form.dam_id.data = animal.dam_id or 0

    if form.validate_on_submit():
        existing = Animal.query.filter_by(tag_id=form.tag_id.data.strip()).first()
        if existing and existing.id != animal.id:
            flash("An animal with that tag/ID already exists.", "danger")
        else:
            animal.tag_id = form.tag_id.data.strip()
            animal.name = form.name.data
            animal.breed = form.breed.data
            animal.sex = form.sex.data
            animal.birth_date = form.birth_date.data
            animal.color = form.color.data
            animal.status = form.status.data
            animal.location = form.location.data
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
            flash(f"Animal {animal.tag_id} updated.", "success")
            return redirect(url_for("animals.view_animal", animal_id=animal.id))

    return render_template("animals/form.html", form=form, title=f"Edit {animal.tag_id}")


@animals_bp.route("/<int:animal_id>/weight", methods=["POST"])
@login_required
def add_weight(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    form = WeightRecordForm()
    if form.validate_on_submit():
        record = WeightRecord(
            animal_id=animal.id,
            weight=form.weight.data,
            date_recorded=form.date_recorded.data,
            notes=form.notes.data,
            recorded_by_id=current_user.id,
        )
        db.session.add(record)
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
        record = HealthRecord(
            animal_id=animal.id,
            record_type=form.record_type.data,
            description=form.description.data,
            date_recorded=form.date_recorded.data,
            vet_name=form.vet_name.data,
            cost=form.cost.data,
            next_due_date=form.next_due_date.data,
            recorded_by_id=current_user.id,
        )
        db.session.add(record)
        db.session.commit()
        flash("Health record added.", "success")
    else:
        flash("Could not add health record - check the form.", "danger")
    return redirect(url_for("animals.view_animal", animal_id=animal.id))


@animals_bp.route("/breeding")
@login_required
def list_breeding():
    records = BreedingRecord.query.order_by(BreedingRecord.breeding_date.desc()).all()
    return render_template("animals/breeding_list.html", records=records)


@animals_bp.route("/breeding/new", methods=["GET", "POST"])
@login_required
def new_breeding():
    form = BreedingRecordForm()
    bulls = Animal.query.filter_by(sex="Bull").order_by(Animal.tag_id).all()
    cows = Animal.query.filter_by(sex="Cow").order_by(Animal.tag_id).all()
    calves = Animal.query.order_by(Animal.tag_id).all()
    form.sire_id.choices = [(a.id, a.tag_id) for a in bulls]
    form.dam_id.choices = [(a.id, a.tag_id) for a in cows]
    form.offspring_id.choices = [(0, "-- None yet --")] + [(a.id, a.tag_id) for a in calves]

    if form.validate_on_submit():
        record = BreedingRecord(
            sire_id=form.sire_id.data,
            dam_id=form.dam_id.data,
            breeding_date=form.breeding_date.data,
            expected_calving_date=form.expected_calving_date.data,
            actual_calving_date=form.actual_calving_date.data,
            offspring_id=form.offspring_id.data or None,
            notes=form.notes.data,
            recorded_by_id=current_user.id,
        )
        db.session.add(record)
        db.session.commit()
        flash("Breeding record saved.", "success")
        return redirect(url_for("animals.list_breeding"))

    return render_template("animals/breeding_form.html", form=form, title="New Breeding Record")


@animals_bp.route("/<int:animal_id>/delete", methods=["POST"])
@login_required
@owner_required
def delete_animal(animal_id):
    animal = Animal.query.get_or_404(animal_id)
    if animal.rentals or animal.status == STATUS_SOLD:
        flash("Cannot delete an animal with rental or sale history. Mark as deceased instead if needed.", "danger")
        return redirect(url_for("animals.view_animal", animal_id=animal.id))
    db.session.delete(animal)
    db.session.commit()
    flash("Animal removed.", "info")
    return redirect(url_for("animals.list_animals"))
