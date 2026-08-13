"""Cost/revenue accounting and herd performance metrics used by the reports module."""
from datetime import date, timedelta

from app.models import (
    Animal, AnimalType, AnimalTypeCostRate, BreedingGroup, CALF_QUALITY_SCALE,
    CalfRecord, DEPARTURE_CULLED, ExposureRecord, FeedoutRecord, GRADE_SCALE, SEX_MALE,
)


DAM_COST_DAYS_AT_WEANING = 365  # ~12 months of the dam's daily rate, transferred to the calf at weaning


def _dam_weaning_transfer_amount(dam):
    """The one-time lump (12 months of her current type's daily rate) that
    moves from a dam's own cost to a calf's cost once that calf is weaned."""
    if not dam:
        return 0.0
    latest_rate = AnimalTypeCostRate.query.filter_by(
        animal_type_id=dam.animal_type_id
    ).order_by(AnimalTypeCostRate.effective_date.desc()).first()
    if not latest_rate:
        return 0.0
    return float(latest_rate.rate_per_day) * DAM_COST_DAYS_AT_WEANING


def cost_for_animal(animal, start=None, end=None):
    """Sums rate_per_day * days on farm using the AnimalTypeCostRate history in
    effect on each day of the range (rate can change over time).

    A recorded calf (has a CalfRecord) doesn't accrue its own upkeep cost
    until it's weaned - before that, its upkeep is assumed to be covered by
    its dam. At the moment of weaning, 12 months of the dam's daily rate
    transfers from her cost to the calf's as a one-time lump sum, and the
    calf's own cost starts accruing from the weaned date forward. This is a
    real (zero-sum) transfer: the same amount is subtracted from the dam for
    every calf of hers that's been weaned, so the combined dam+calf total is
    unchanged - it only shifts which animal the cost is attributed to."""
    calf_record = animal.calf_record
    dam_credit = 0.0
    if calf_record:
        if not calf_record.weaned_date:
            return 0.0
        start = start or calf_record.weaned_date
        dam_credit = _dam_weaning_transfer_amount(calf_record.dam)

    own_start = start or animal.birth_date or (animal.created_at.date() if animal.created_at else None)
    own_end = end or animal.departure_date or date.today()

    own_cost = 0.0
    if own_start and own_start <= own_end:
        rates = AnimalTypeCostRate.query.filter_by(
            animal_type_id=animal.animal_type_id
        ).order_by(AnimalTypeCostRate.effective_date).all()
        for i, r in enumerate(rates):
            seg_start = max(own_start, r.effective_date)
            seg_end = rates[i + 1].effective_date - timedelta(days=1) if i + 1 < len(rates) else own_end
            seg_end = min(seg_end, own_end)
            if seg_start <= seg_end:
                days = (seg_end - seg_start).days + 1
                own_cost += days * float(r.rate_per_day)

    weaned_calf_count = sum(1 for c in animal.calf_records_as_dam if c.weaned_date)
    dam_debit = weaned_calf_count * _dam_weaning_transfer_amount(animal) if weaned_calf_count else 0.0

    return own_cost + dam_credit - dam_debit


def animal_revenue(animal):
    revenue = sum(float(line.price) for line in animal.sale_lines)
    if animal.is_bull:
        revenue += sum(float(r.revenue) for r in animal.rentals)
    return revenue


def bull_lifetime_revenue(bull):
    return animal_revenue(bull)


def net_margin_by_type():
    results = {}
    for t in AnimalType.query.order_by(AnimalType.name).all():
        animals = Animal.query.filter_by(animal_type_id=t.id).all()
        cost = sum(cost_for_animal(a) for a in animals)
        revenue = sum(animal_revenue(a) for a in animals)
        results[t.name] = {
            "count": len(animals),
            "cost": round(cost, 2),
            "revenue": round(revenue, 2),
            "net": round(revenue - cost, 2),
        }
    return results


def _year_bounds(year):
    return date(year, 1, 1), date(year, 12, 31)


def weaning_rate(year):
    start, end = _year_bounds(year)
    exposed_ids = {
        e.animal_id for e in ExposureRecord.query.join(BreedingGroup)
        .filter(BreedingGroup.start_date >= start, BreedingGroup.start_date <= end).all()
    }
    calves = CalfRecord.query.filter(CalfRecord.calving_date >= start, CalfRecord.calving_date <= end).all()
    weaned = [c for c in calves if c.weaned_date]
    weights = [float(c.weaning_weight) for c in weaned if c.weaning_weight]
    exposed = len(exposed_ids)
    rate = (len(weaned) / exposed * 100) if exposed else None
    return {
        "year": year,
        "exposed": exposed,
        "weaned": len(weaned),
        "rate_pct": round(rate, 1) if rate is not None else None,
        "avg_weaning_weight": round(sum(weights) / len(weights), 1) if weights else None,
    }


def pregnancy_rate(year):
    start, end = _year_bounds(year)
    exposures = ExposureRecord.query.join(BreedingGroup).filter(
        BreedingGroup.start_date >= start, BreedingGroup.start_date <= end
    ).all()
    tested = [e for e in exposures if e.confirmed_bred is not None]
    confirmed = [e for e in tested if e.confirmed_bred]
    rate = (len(confirmed) / len(tested) * 100) if tested else None
    return {
        "year": year,
        "exposed": len(exposures),
        "tested": len(tested),
        "confirmed": len(confirmed),
        "rate_pct": round(rate, 1) if rate is not None else None,
    }


def death_loss_rate(year):
    start, end = _year_bounds(year)
    deaths = Animal.query.filter(
        Animal.departure_reason == "deceased",
        Animal.departure_date >= start, Animal.departure_date <= end,
    ).count()
    herd_present = Animal.query.filter(
        Animal.created_at <= end,
        (Animal.departure_date.is_(None)) | (Animal.departure_date >= start),
    ).count()
    rate = (deaths / herd_present * 100) if herd_present else None
    return {"year": year, "deaths": deaths, "herd_present": herd_present, "rate_pct": round(rate, 1) if rate is not None else None}


def feedout_rollup_by_parent(relation="sire"):
    records = FeedoutRecord.query.all()
    buckets = {}
    for r in records:
        animal = r.animal
        if not animal:
            continue
        parent = animal.sire if relation == "sire" else animal.dam
        if not parent:
            continue
        b = buckets.setdefault(parent, {"grades": [], "adgs": [], "count": 0})
        b["count"] += 1
        if r.steak_grade in GRADE_SCALE:
            b["grades"].append(GRADE_SCALE[r.steak_grade])
        adg = r.average_daily_gain
        if adg:
            b["adgs"].append(float(adg))
    result = []
    for parent, b in buckets.items():
        result.append({
            "parent": parent,
            "count": b["count"],
            "avg_grade_score": round(sum(b["grades"]) / len(b["grades"]), 2) if b["grades"] else None,
            "avg_adg": round(sum(b["adgs"]) / len(b["adgs"]), 2) if b["adgs"] else None,
        })
    result.sort(key=lambda x: (x["avg_grade_score"] is None, -(x["avg_grade_score"] or 0)))
    return result


def bulls_culled(year):
    start, end = _year_bounds(year)
    culled = Animal.query.filter(
        Animal.sex == SEX_MALE,
        Animal.departure_reason == DEPARTURE_CULLED,
        Animal.departure_date >= start, Animal.departure_date <= end,
    ).all()
    return {"year": year, "count": len([a for a in culled if a.is_bull])}


def calf_performance_by_parent(relation="sire"):
    """Rolls up CalfRecords by sire or dam: count, average weaning weight,
    average age at weaning (days), and average calf quality score."""
    records = CalfRecord.query.all()
    buckets = {}
    for r in records:
        parent = r.sire if relation == "sire" else r.dam
        if not parent:
            continue
        b = buckets.setdefault(parent, {"count": 0, "weights": [], "ages": [], "quality_scores": []})
        b["count"] += 1
        if r.weaning_weight:
            b["weights"].append(float(r.weaning_weight))
        age = r.weaning_age_days
        if age is not None:
            b["ages"].append(age)
        if r.quality in CALF_QUALITY_SCALE:
            b["quality_scores"].append(CALF_QUALITY_SCALE[r.quality])

    result = []
    for parent, b in buckets.items():
        result.append({
            "parent": parent,
            "count": b["count"],
            "avg_weaning_weight": round(sum(b["weights"]) / len(b["weights"]), 1) if b["weights"] else None,
            "avg_weaning_age_days": round(sum(b["ages"]) / len(b["ages"]), 1) if b["ages"] else None,
            "avg_quality_score": round(sum(b["quality_scores"]) / len(b["quality_scores"]), 2) if b["quality_scores"] else None,
        })
    result.sort(key=lambda x: (x["avg_quality_score"] is None, -(x["avg_quality_score"] or 0)))
    return result
