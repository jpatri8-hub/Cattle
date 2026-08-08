from datetime import date, timedelta

from flask import Blueprint, render_template
from flask_login import current_user, login_required

from app.lifecycle import run_lifecycle_checks
from app.models import Animal, HealthRecord, Rental, Sale, RENTAL_ACTIVE, RENTAL_BOOKED

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
@login_required
def dashboard():
    active_animals = Animal.query.filter_by(is_active=True).all()
    bulls_available = len([a for a in active_animals if a.is_rentable_available])

    counts_by_type = {}
    counts_by_location = {}
    for a in active_animals:
        type_name = a.animal_type.name if a.animal_type else "Unknown Type"
        counts_by_type[type_name] = counts_by_type.get(type_name, 0) + 1
        loc_name = a.location.display_name if a.location else "No Location"
        counts_by_location[loc_name] = counts_by_location.get(loc_name, 0) + 1
    counts_by_type = dict(sorted(counts_by_type.items()))
    counts_by_location = dict(sorted(counts_by_location.items()))

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
    alerts = {"not_seen": [], "semen": [], "rentals_overdue": []}
    if current_user.is_owner:
        recent_sales = Sale.query.order_by(Sale.sale_date.desc()).limit(5).all()
        sales_this_year_total = sum(
            (s.total_price for s in Sale.query.filter(Sale.sale_date >= date(today.year, 1, 1)).all()),
            0,
        )
        alerts = run_lifecycle_checks()
    else:
        from app.lifecycle import not_seen_alerts
        alerts["not_seen"] = not_seen_alerts()

    return render_template(
        "main/dashboard.html",
        counts_by_type=counts_by_type,
        counts_by_location=counts_by_location,
        bulls_available=bulls_available,
        upcoming_returns=upcoming_returns,
        upcoming_bookings=upcoming_bookings,
        overdue_vaccines=overdue_vaccines,
        recent_sales=recent_sales,
        sales_this_year_total=sales_this_year_total,
        alerts=alerts,
    )
