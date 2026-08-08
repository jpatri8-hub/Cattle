from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from app import db
from app.forms import RentalCheckForm, RentalForm, RentalStatusForm
from app.models import (
    Animal, Buyer, RENTAL_ACTIVE, RENTAL_BOOKED, RENTAL_CANCELLED, RENTAL_RETURNED,
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
    form.bull_id.choices = [(a.id, f"{a.display_id}{'' if a.is_rentable_available else ' (unavailable)'}") for a in bulls]
    form.customer_id.choices = [(c.id, c.name) for c in Buyer.query.order_by(Buyer.name).all()]

    if not form.customer_id.choices:
        flash("Add a buyer/customer before booking a rental.", "warning")

    if request.method == "GET":
        preselect = request.args.get("bull_id", type=int)
        if preselect:
            form.bull_id.data = preselect

    if form.validate_on_submit():
        if form.end_date.data < form.start_date.data:
            flash("End date must be on or after the start date.", "danger")
        elif _has_conflict(form.bull_id.data, form.start_date.data, form.end_date.data):
            flash("That bull is already booked during part of this date range.", "danger")
        else:
            rental = Rental(
                bull_id=form.bull_id.data,
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


@rentals_bp.route("/<int:rental_id>")
@login_required
def view_rental(rental_id):
    rental = Rental.query.get_or_404(rental_id)
    check_form = RentalCheckForm(date_recorded=date.today())
    status_form = RentalStatusForm(obj=rental)
    status_form.status.data = rental.status
    return render_template("rentals/detail.html", rental=rental, check_form=check_form, status_form=status_form)


@rentals_bp.route("/<int:rental_id>/check", methods=["POST"])
@login_required
def add_check(rental_id):
    rental = Rental.query.get_or_404(rental_id)
    form = RentalCheckForm()
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

        db.session.commit()
        flash("Check logged.", "success")
    else:
        flash("Could not log check - review the form.", "danger")
    return redirect(url_for("rentals.view_rental", rental_id=rental.id))


@rentals_bp.route("/<int:rental_id>/status", methods=["POST"])
@login_required
def update_status(rental_id):
    rental = Rental.query.get_or_404(rental_id)
    form = RentalStatusForm()
    if form.validate_on_submit():
        rental.status = form.status.data
        rental.actual_return_date = form.actual_return_date.data
        rental.deposit_returned = form.deposit_returned.data
        db.session.commit()
        flash("Rental status updated.", "success")
    return redirect(url_for("rentals.view_rental", rental_id=rental.id))
