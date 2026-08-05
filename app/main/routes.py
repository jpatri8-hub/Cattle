from datetime import date, timedelta

from flask import Blueprint, render_template
from flask_login import current_user, login_required

from app.models import (
    Animal, HealthRecord, Rental, Sale, STATUS_AVAILABLE, STATUS_RENTED, STATUS_SOLD,
    RENTAL_ACTIVE, RENTAL_BOOKED,
)

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
@login_required
def dashboard():
    total_animals = Animal.query.filter(Animal.status != STATUS_SOLD).count()
    available = Animal.query.filter_by(status=STATUS_AVAILABLE).count()
    rented_out = Animal.query.filter_by(status=STATUS_RENTED).count()

    today = date.today()
    soon = today + timedelta(days=14)

    upcoming_returns = (
        Rental.query.filter(Rental.status == RENTAL_ACTIVE, Rental.end_date <= soon)
        .order_by(Rental.end_date)
        .all()
    )
    upcoming_bookings = (
        Rental.query.filter(Rental.status == RENTAL_BOOKED, Rental.start_date <= soon)
        .order_by(Rental.start_date)
        .all()
    )
    overdue_vaccines = (
        HealthRecord.query.filter(
            HealthRecord.next_due_date.isnot(None), HealthRecord.next_due_date <= soon
        )
        .order_by(HealthRecord.next_due_date)
        .all()
    )

    recent_sales = []
    sales_this_year_total = None
    if current_user.is_owner:
        recent_sales = Sale.query.order_by(Sale.sale_date.desc()).limit(5).all()
        sales_this_year_total = sum(
            (s.sale_price for s in Sale.query.filter(Sale.sale_date >= date(today.year, 1, 1)).all()),
            0,
        )

    return render_template(
        "main/dashboard.html",
        total_animals=total_animals,
        available=available,
        rented_out=rented_out,
        upcoming_returns=upcoming_returns,
        upcoming_bookings=upcoming_bookings,
        overdue_vaccines=overdue_vaccines,
        recent_sales=recent_sales,
        sales_this_year_total=sales_this_year_total,
    )
