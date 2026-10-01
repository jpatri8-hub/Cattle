from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from app import db
from app.forms import RentalCheckForm, RentalForm
from app.models import (
    Animal, Buyer, Location, RENTAL_ACTIVE, RENTAL_BOOKED, RENTAL_RETURNED,
    Rental, RentalCheck,
)

rentals_bp = Blueprint("rentals", __name__, url_prefix="/rentals")


def _has_conflict(bull_id, start_date, end_date, exclude_rental_id=None):
    query = Rental.query.filter(
        Rental.bull_id == bull_id,
        Rental.status.in_([RENTAL_BOOKED, RENTAL_ACTIVE]),
        Rental.start_date <= end_date,
        Rental.end_date >= start_date,
    )
    if exclude_rental_id:
        query = query.filter(Rental.id != exclude_rental_id)
    return query.first()


@rentals_bp.route("/")
@login_required
def list_rentals():
    status_filter = request.args.get("status", "")
    query = Rental.query
    if status_filter:
        query = query.filter_by(status=status_filter)
    rentals = query.order_by(Rental.start_date.desc()).all()
    return render_template("rentals/list.html", rentals=rentals, status_filter=status_filter)


@rentals_bp.route("/new", methods=["GET", "POST"])
@login_required
def new_rental():
    form = RentalForm()
    bulls = [a for a in Animal.query.filter_by(is_active=True).order_by(Animal.tag_id).all() if a.is_bull]
    form.bull_id.choices = [(0, "-- Not yet decided --")] + [
        (a.id, f"{a.display_id}{'' if a.is_rentable_available else ' (unavailable)'}") for a in bulls
    ]
    form.customer_id.choices = [(c.id, c.name) for c in Buyer.query.order_by(Buyer.name).all()]

    if not form.customer_id.choices:
        flash("Add a buyer/customer before booking a rental.", "warning")

    if request.method == "GET":
        preselect = request.args.get("bull_id", type=int)
        form.bull_id.data = preselect or 0

    if form.validate_on_submit():
        bull_id = form.bull_id.data or None
        bull_count = form.bull_count.data
        if form.end_date.data < form.start_date.data:
            flash("End date must be on or after the start date.", "danger")
        elif not bull_id and not bull_count:
            flash("Pick a bull, or enter a number of bulls if it's too early to decide which one(s).", "danger")
        elif bull_id and _has_conflict(bull_id, form.start_date.data, form.end_date.data):
            flash("That bull is already booked during part of this date range.", "danger")
        else:
            rental = Rental(
                bull_id=bull_id,
                bull_count=None if bull_id else bull_count,
                customer_id=form.customer_id.data,
                start_date=form.start_date.data,
                end_date=form.end_date.data,
                rate=form.rate.data,
                rate_type=form.rate_type.data,
                deposit_amount=form.deposit_amount.data,
                contract_notes=form.contract_notes.data,
                created_by_id=current_user.id,
            )
            db.session.add(rental)
            db.session.commit()
            flash("Rental booked.", "success")
            return redirect(url_for("rentals.view_rental", rental_id=rental.id))

    return render_template("rentals/form.html", form=form, title="Book a Rental")


@rentals_bp.route("/<int:rental_id>/edit", methods=["GET", "POST"])
@login_required
def edit_rental(rental_id):
    rental = Rental.query.get_or_404(rental_id)
    form = RentalForm(obj=rental)
    bulls = [a for a in Animal.query.filter_by(is_active=True).order_by(Animal.tag_id).all() if a.is_bull]
    form.bull_id.choices = [(0, "-- Not yet decided --")] + [
        (a.id, f"{a.display_id}{'' if a.is_rentable_available else ' (unavailable)'}") for a in bulls
    ]
    form.customer_id.choices = [(c.id, c.name) for c in Buyer.query.order_by(Buyer.name).all()]

    if request.method == "GET":
        form.bull_id.data = rental.bull_id or 0
        form.customer_id.data = rental.customer_id

    if form.validate_on_submit():
        bull_id = form.bull_id.data or None
        bull_count = form.bull_count.data
        if form.end_date.data < form.start_date.data:
            flash("End date must be on or after the start date.", "danger")
        elif not bull_id and not bull_count:
            flash("Pick a bull, or enter a number of bulls if it's too early to decide which one(s).", "danger")
        elif bull_id and _has_conflict(bull_id, form.start_date.data, form.end_date.data, exclude_rental_id=rental.id):
            flash("That bull is already booked during part of this date range.", "danger")
        else:
            rental.bull_id = bull_id
            rental.bull_count = None if bull_id else bull_count
            rental.customer_id = form.customer_id.data
            rental.start_date = form.start_date.data
            rental.end_date = form.end_date.data
            rental.rate = form.rate.data
            rental.rate_type = form.rate_type.data
            rental.deposit_amount = form.deposit_amount.data
            rental.contract_notes = form.contract_notes.data
            db.session.commit()
            flash("Rental updated.", "success")
            return redirect(url_for("rentals.view_rental", rental_id=rental.id))

    return render_template("rentals/form.html", form=form, title=f"Edit Rental #{rental.id}", rental=rental)


@rentals_bp.route("/<int:rental_id>")
@login_required
def view_rental(rental_id):
    rental = Rental.query.get_or_404(rental_id)
    check_form = RentalCheckForm(date_recorded=date.today())
    check_form.location_id.choices = [(0, "-- Keep current location --")] + [
        (l.id, l.display_name) for l in Location.query.filter_by(is_active=True).order_by(Location.name).all()
    ]
    return render_template("rentals/detail.html", rental=rental, check_form=check_form)


@rentals_bp.route("/<int:rental_id>/check", methods=["POST"])
@login_required
def add_check(rental_id):
    rental = Rental.query.get_or_404(rental_id)
    if not rental.bull_id:
        flash("Assign a specific bull to this rental before logging a pickup/return check.", "warning")
        return redirect(url_for("rentals.view_rental", rental_id=rental.id))
    form = RentalCheckForm()
    form.location_id.choices = [(0, "-- Keep current location --")] + [
        (l.id, l.display_name) for l in Location.query.filter_by(is_active=True).order_by(Location.name).all()
    ]
    if form.validate_on_submit():
        check = RentalCheck(
            rental_id=rental.id,
            check_type=form.check_type.data,
            condition_score=form.condition_score.data or None,
            condition_notes=form.condition_notes.data,
            date_recorded=form.date_recorded.data,
            recorded_by_id=current_user.id,
        )
        db.session.add(check)

        if form.check_type.data == "pickup" and rental.status == RENTAL_BOOKED:
            rental.status = RENTAL_ACTIVE
        elif form.check_type.data == "return" and rental.status == RENTAL_ACTIVE:
            rental.status = RENTAL_RETURNED
            rental.actual_return_date = form.date_recorded.data
            if form.condition_score.data:
                rental.return_condition_score = form.condition_score.data
            if form.location_id.data:
                rental.bull.location_id = form.location_id.data

        db.session.commit()
        flash("Check logged.", "success")
    else:
        flash("Could not log check - review the form.", "danger")
    return redirect(url_for("rentals.view_rental", rental_id=rental.id))
