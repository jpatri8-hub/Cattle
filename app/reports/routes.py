from datetime import date

from flask import Blueprint, render_template, request
from flask_login import login_required

from app.decorators import owner_required
from app.metrics import (
    bull_lifetime_revenue, death_loss_rate, feedout_rollup_by_parent,
    net_margin_by_type, pregnancy_rate, weaning_rate,
)
from app.models import Animal, SEX_MALE

reports_bp = Blueprint("reports", __name__, url_prefix="/reports")


@reports_bp.before_request
@login_required
@owner_required
def _guard():
    pass


@reports_bp.route("/")
def overview():
    year = request.args.get("year", date.today().year, type=int)
    bulls = [a for a in Animal.query.filter_by(sex=SEX_MALE).order_by(Animal.tag_id).all() if a.is_bull]
    bull_revenue = sorted(
        ((b, bull_lifetime_revenue(b)) for b in bulls), key=lambda x: -x[1]
    )
    return render_template(
        "reports/overview.html",
        year=year,
        net_margin=net_margin_by_type(),
        weaning=weaning_rate(year),
        pregnancy=pregnancy_rate(year),
        death_loss=death_loss_rate(year),
        bull_revenue=bull_revenue,
    )


@reports_bp.route("/feedout")
def feedout_rollup():
    return render_template(
        "reports/feedout.html",
        by_sire=feedout_rollup_by_parent("sire"),
        by_dam=feedout_rollup_by_parent("dam"),
    )
