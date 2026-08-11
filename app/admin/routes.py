from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import login_required

from app import db
from app.decorators import owner_required
from app.forms import (
    AnimalTypeForm, CostRateForm, LocationForm, SaleCategoryForm,
)
from app.models import AnimalType, AnimalTypeCostRate, Location, SaleCategory

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


@admin_bp.before_request
@login_required
@owner_required
def _guard():
    pass


@admin_bp.route("/")
def index():
    return render_template("admin/index.html")


# ---- Locations ---------------------------------------------------------------

@admin_bp.route("/locations", methods=["GET", "POST"])
def locations():
    form = LocationForm()
    if form.validate_on_submit():
        existing = Location.query.filter_by(name=form.name.data.strip()).first()
        if existing:
            flash("A location with that name already exists.", "danger")
        else:
            db.session.add(Location(name=form.name.data.strip()))
            db.session.commit()
            flash("Location added.", "success")
            return redirect(url_for("admin.locations"))
    locs = Location.query.order_by(Location.name).all()
    return render_template("admin/locations.html", form=form, locations=locs)


@admin_bp.route("/locations/<int:location_id>/edit", methods=["GET", "POST"])
def edit_location(location_id):
    loc = Location.query.get_or_404(location_id)
    form = LocationForm(obj=loc)
    if form.validate_on_submit():
        loc.name = form.name.data.strip()
        db.session.commit()
        flash("Location updated.", "success")
        return redirect(url_for("admin.locations"))
    return render_template("admin/location_form.html", form=form, loc=loc)


@admin_bp.route("/locations/<int:location_id>/deactivate", methods=["POST"])
def deactivate_location(location_id):
    loc = Location.query.get_or_404(location_id)
    loc.is_active = not loc.is_active
    db.session.commit()
    return redirect(url_for("admin.locations"))


# ---- Animal Types -------------------------------------------------------------

@admin_bp.route("/types", methods=["GET", "POST"])
def types():
    form = AnimalTypeForm()
    existing = AnimalType.query.order_by(AnimalType.name).all()
    form.auto_transfer_to_type_id.choices = [(0, "-- None --")] + [(t.id, t.name) for t in existing]
    if form.validate_on_submit():
        t = AnimalType(
            name=form.name.data.strip(),
            sex=form.sex.data,
            auto_transfer_trigger=form.auto_transfer_trigger.data or None,
            auto_transfer_age_months=form.auto_transfer_age_months.data,
            auto_transfer_to_type_id=form.auto_transfer_to_type_id.data or None,
            is_active=form.is_active.data,
        )
        db.session.add(t)
        db.session.commit()
        flash(f"Type '{t.name}' added.", "success")
        return redirect(url_for("admin.types"))
    return render_template("admin/types.html", form=form, types=existing)


@admin_bp.route("/types/<int:type_id>/edit", methods=["GET", "POST"])
def edit_type(type_id):
    t = AnimalType.query.get_or_404(type_id)
    form = AnimalTypeForm(obj=t)
    others = AnimalType.query.filter(AnimalType.id != type_id).order_by(AnimalType.name).all()
    form.auto_transfer_to_type_id.choices = [(0, "-- None --")] + [(o.id, o.name) for o in others]
    if request.method == "GET":
        form.auto_transfer_to_type_id.data = t.auto_transfer_to_type_id or 0
        form.auto_transfer_trigger.data = t.auto_transfer_trigger or ""
    if form.validate_on_submit():
        t.name = form.name.data.strip()
        t.sex = form.sex.data
        t.auto_transfer_trigger = form.auto_transfer_trigger.data or None
        t.auto_transfer_age_months = form.auto_transfer_age_months.data
        t.auto_transfer_to_type_id = form.auto_transfer_to_type_id.data or None
        t.is_active = form.is_active.data
        db.session.commit()
        flash(f"Type '{t.name}' updated.", "success")
        return redirect(url_for("admin.types"))
    return render_template("admin/type_form.html", form=form, animal_type=t)


# ---- Sale Categories ------------------------------------------------------------

@admin_bp.route("/sale-categories", methods=["GET", "POST"])
def sale_categories():
    form = SaleCategoryForm()
    if form.validate_on_submit():
        db.session.add(SaleCategory(name=form.name.data.strip()))
        db.session.commit()
        flash("Sale category added.", "success")
        return redirect(url_for("admin.sale_categories"))
    cats = SaleCategory.query.order_by(SaleCategory.name).all()
    return render_template("admin/sale_categories.html", form=form, categories=cats)


@admin_bp.route("/sale-categories/<int:category_id>/deactivate", methods=["POST"])
def deactivate_sale_category(category_id):
    cat = SaleCategory.query.get_or_404(category_id)
    cat.is_active = not cat.is_active
    db.session.commit()
    return redirect(url_for("admin.sale_categories"))


# ---- Cost Rates -----------------------------------------------------------------

@admin_bp.route("/cost-rates", methods=["GET", "POST"])
def cost_rates():
    form = CostRateForm()
    form.animal_type_id.choices = [(t.id, t.name) for t in AnimalType.query.order_by(AnimalType.name).all()]
    if request.method == "GET":
        form.effective_date.data = date.today()
    if form.validate_on_submit():
        db.session.add(AnimalTypeCostRate(
            animal_type_id=form.animal_type_id.data,
            rate_per_day=form.rate_per_day.data,
            effective_date=form.effective_date.data,
        ))
        db.session.commit()
        flash("Cost rate saved.", "success")
        return redirect(url_for("admin.cost_rates"))
    rates_by_type = {}
    for t in AnimalType.query.order_by(AnimalType.name).all():
        rates_by_type[t] = t.cost_rates
    return render_template("admin/cost_rates.html", form=form, rates_by_type=rates_by_type)
