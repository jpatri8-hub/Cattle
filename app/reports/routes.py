import io
from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, send_file, url_for
from flask_login import login_required

from app import db
from app.decorators import owner_required
from app.metrics import (
    bull_lifetime_revenue, bulls_culled, calf_performance_by_parent, cost_for_animal, death_loss_rate,
    feedout_rollup_by_parent, feedout_rollup_by_type, net_margin_by_type, pregnancy_rate, weaning_rate,
)
from app.models import Animal, CalfRecord, SEX_MALE
from app.reports.registration import (
    assign_brand_numbers, build_registration_workbook, default_season_end_year,
    eligible_calf_records,
)

reports_bp = Blueprint("reports", __name__, url_prefix="/reports")


@reports_bp.before_request
@login_required
@owner_required
def _guard():
    pass


@reports_bp.route("/")
def overview():
    year = request.args.get("year", date.today().year, type=int)
    show_departed = request.args.get("show_departed") == "1"
    bull_query = Animal.query.filter_by(sex=SEX_MALE)
    if not show_departed:
        bull_query = bull_query.filter_by(is_active=True)
    bulls = [a for a in bull_query.order_by(Animal.tag_id).all() if a.is_bull]
    bull_revenue = sorted(
        ((b, bull_lifetime_revenue(b), cost_for_animal(b)) for b in bulls), key=lambda x: -x[1]
    )
    net_margin = net_margin_by_type()
    net_margin_totals = {
        "count": sum(m["count"] for m in net_margin.values()),
        "cost": round(sum(m["cost"] for m in net_margin.values()), 2),
        "revenue": round(sum(m["revenue"] for m in net_margin.values()), 2),
        "net": round(sum(m["net"] for m in net_margin.values()), 2),
    }
    return render_template(
        "reports/overview.html",
        year=year,
        net_margin=net_margin,
        net_margin_totals=net_margin_totals,
        weaning=weaning_rate(year),
        pregnancy=pregnancy_rate(year),
        death_loss=death_loss_rate(year),
        culled=bulls_culled(year),
        bull_revenue=bull_revenue,
        show_departed=show_departed,
    )


@reports_bp.route("/feedout")
def feedout_rollup():
    return render_template(
        "reports/feedout.html",
        by_sire=feedout_rollup_by_parent("sire"),
        by_dam=feedout_rollup_by_parent("dam"),
        by_type=feedout_rollup_by_type(),
    )


@reports_bp.route("/calf-performance")
def calf_performance():
    return render_template(
        "reports/calf_performance.html",
        by_sire=calf_performance_by_parent("sire"),
        by_dam=calf_performance_by_parent("dam"),
    )


@reports_bp.route("/registration")
def registration():
    season_end_year = request.args.get("season_end_year", default_season_end_year(), type=int)
    calves = eligible_calf_records(season_end_year)
    dam_count = len({c.dam_id for c in calves})
    return render_template(
        "reports/registration.html", calves=calves, season_end_year=season_end_year, dam_count=dam_count,
    )


@reports_bp.route("/registration/export", methods=["POST"])
def registration_export():
    season_end_year = request.form.get("season_end_year", default_season_end_year(), type=int)
    selected_ids = {int(i) for i in request.form.getlist("calf_record_id")}
    if not selected_ids:
        flash("Select at least one calf to export first.", "warning")
        return redirect(url_for("reports.registration", season_end_year=season_end_year))

    calves = CalfRecord.query.filter(CalfRecord.id.in_(selected_ids)).all()
    assign_brand_numbers(calves)
    db.session.commit()

    wb = build_registration_workbook(season_end_year, selected_ids)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    filename = f"registrations_{season_end_year - 1}-{season_end_year}.xlsx"
    return send_file(
        buffer, as_attachment=True, download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
