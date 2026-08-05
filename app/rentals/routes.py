import calendar
from datetime import date, timedelta

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from app import db
from app.forms import RentalCheckForm, RentalForm, RentalStatusForm
from app.models import (
    Animal, RENTAL_ACTIVE, RENTAL_BOOKED, RENTAL_CANCELLED, RENTAL_RETURNED,
    Rental, RentalCheck, STATUS_AVAILABLE, STATUS_RENTED, WeightRecord,
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


@rentals_bp.route("/calendar")
@login_required
def calendar_view():
    today = date.today()
    year = request.args.get("year", today.year, type=int)
    month = request.args.get("month", today.month, type=int)

    first_of_month = date(year, month, 1)
    prev_month = (first_of_month - timedelta(days=1)).replace(day=1)
    next_month = (first_of_month + timedelta(days=32)).replace(day=1)

    cal = calendar.Calendar(firstweekday=6)  # start weeks on Sunday
    month_days = cal.monthdatescalendar(year, month)

    rentals = Rental.query.filter(
        Rental.status.in_([RENTAL_BOOKED, RENTAL_ACTIVE]),
        Rental.start_date <= month_days[-1][-1],
        Rental.end_date >= month_days[0][0],
    ).all()

    day_rentals = {}
    for r in rentals:
        d = max(r.start_date, month_days[0][0])
        end = min(r.end_date, month_days[-1][-1])
        while d <= end:
            day_rentals.setdefault(d, []).append(r)
            d += timedelta(days=1)

    bulls = Animal.query.filter_by(sex="Bull").order_by(Animal.tag_id).all()
    open_rentals = Rental.query.filter(Rental.status.in_([RENTAL_BOOKED, RENTAL_ACTIVE])).order_by(Rental.start_date).all()

    return render_template(
        "rentals/calendar.html",
        month_days=month_days,
        day_rentals=day_rentals,
        month_name=first_of_month.strftime("%B %Y"),
        prev_month=prev_month,
        next_month=next_month,
        current_month=month,
        bulls=bulls,
        open_rentals=open_rentals,
        today=today,
    )


@rentals_bp.route("/new", methods=["GET", "POST"])
@login_required
def new_rental():
    form = RentalForm()
    bulls = Animal.query.filter_by(sex="Bull").order_by(Animal.tag_id).all()
    form.bull_id.choices = [(a.id, f"{a.tag_id} ({a.status})") for a in bulls]

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
                renter_name=form.renter_name.data,
                renter_phone=form.renter_phone.data,
                renter_email=form.renter_email.data,
                renter_address=form.renter_address.data,
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
            weight=form.weight.data,
            condition_notes=form.condition_notes.data,
            health_notes=form.health_notes.data,
            date_recorded=form.date_recorded.data,
            recorded_by_id=current_user.id,
        )
        db.session.add(check)

        if form.weight.data:
            db.session.add(WeightRecord(
                animal_id=rental.bull_id,
                weight=form.weight.data,
                date_recorded=form.date_recorded.data,
                notes=f"Rental {form.check_type.data} check ({rental.renter_name})",
                recorded_by_id=current_user.id,
            ))

        bull = Animal.query.get(rental.bull_id)
        if form.check_type.data == "pickup" and rental.status == RENTAL_BOOKED:
            rental.status = RENTAL_ACTIVE
            bull.status = STATUS_RENTED
        elif form.check_type.data == "return" and rental.status == RENTAL_ACTIVE:
            rental.status = RENTAL_RETURNED
            rental.actual_return_date = form.date_recorded.data
            bull.status = STATUS_AVAILABLE

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

        bull = Animal.query.get(rental.bull_id)
        if rental.status == RENTAL_ACTIVE:
            bull.status = STATUS_RENTED
        elif rental.status in (RENTAL_RETURNED, RENTAL_CANCELLED):
            if bull.status == STATUS_RENTED:
                bull.status = STATUS_AVAILABLE

        db.session.commit()
        flash("Rental status updated.", "success")
    return redirect(url_for("rentals.view_rental", rental_id=rental.id))
