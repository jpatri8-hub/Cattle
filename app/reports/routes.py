import io
from datetime import date

from flask import Blueprint, render_template, request, send_file
from flask_login import login_required

from app.decorators import owner_required
from app.metrics import (
    bull_lifetime_revenue, bulls_culled, calf_performance_by_parent, death_loss_rate,
    feedout_rollup_by_parent, net_margin_by_type, pregnancy_rate, weaning_rate,
)
from app.models import Animal, SEX_MALE
from app.reports.registration import (
    build_registration_workbook, default_season_end_year, registration_report_rows,
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
        culled=bulls_culled(year),
        bull_revenue=bull_revenue,
    )


@reports_bp.route("/feedout")
def feedout_rollup():
    return render_template(
        "reports/feedout.html",
        by_sire=feedout_rollup_by_parent("sire"),
        by_dam=feedout_rollup_by_parent("dam"),
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
    rows = registration_report_rows(season_end_year)
    dam_count = len({r["DAM TAG"] for r in rows})
    return render_template(
        "reports/registration.html", rows=rows, season_end_year=season_end_year, dam_count=dam_count,
    )


@reports_bp.route("/registration/export")
def registration_export():
    season_end_year = request.args.get("season_end_year", default_season_end_year(), type=int)
    wb = build_registration_workbook(season_end_year)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    filename = f"registrations_{season_end_year - 1}-{season_end_year}.xlsx"
    return send_file(
        buffer, as_attachment=True, download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
