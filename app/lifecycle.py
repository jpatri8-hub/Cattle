"""Herd lifecycle engine: automatic type transfers, breeding/inbreeding helpers,
bull rental availability alerts, and "not seen" flagging.

These are run lazily (called from the dashboard and relevant list views) rather
than on a schedule, since the app has no background worker.
"""
from datetime import date, timedelta

from app import db
from app.models import (
    Animal, AnimalType, BreedingGroup, ExposureRecord, Location, Rental,
    RENTAL_ACTIVE, SEMEN_BAD, SEMEN_RETEST, SEX_FEMALE, SEX_MALE,
    TRANSFER_TRIGGER_AGE, TRANSFER_TRIGGER_WEANED,
)

GESTATION_MIN_DAYS = 270
GESTATION_MAX_DAYS = 295


def compute_candidate_sires(animal):
    """Bulls that were in a breeding group at the animal's birth location during
    the likely conception window, used to flag inbreeding risk later on."""
    if not animal.birth_date or not animal.birth_location_id:
        return []
    window_start = animal.birth_date - timedelta(days=GESTATION_MAX_DAYS)
    window_end = animal.birth_date - timedelta(days=GESTATION_MIN_DAYS)
    groups = BreedingGroup.query.filter_by(location_id=animal.birth_location_id).all()
    bulls = {}
    for group in groups:
        group_end = group.end_date or date.today()
        if group.start_date <= window_end and group_end >= window_start:
            for bull in group.bulls:
                bulls[bull.id] = bull
    return list(bulls.values())


def apply_candidate_sires(animal):
    animal.candidate_sires = compute_candidate_sires(animal)


def inbreeding_warnings(bull, dam):
    """Returns a list of human-readable warnings if breeding `bull` to `dam`
    looks like it risks inbreeding, based on recorded/candidate parentage."""
    warnings = []
    if dam.sire_id and dam.sire_id == bull.id:
        warnings.append(f"{bull.display_id} is {dam.display_id}'s recorded sire.")
    if bull.sire_id and bull.sire_id == dam.id:
        warnings.append(f"{dam.display_id} is {bull.display_id}'s recorded sire.")

    dam_candidates = {a.id for a in dam.candidate_sires}
    if bull.id in dam_candidates:
        warnings.append(
            f"{bull.display_id} was a candidate sire for {dam.display_id} "
            f"(present at her birth location during the likely breeding window)."
        )
    bull_candidates = {a.id for a in bull.candidate_sires}
    shared = dam_candidates & bull_candidates
    if shared:
        warnings.append(f"{dam.display_id} and {bull.display_id} share a candidate sire — possible half-siblings.")
    if bull.dam_id and dam.dam_id and bull.dam_id == dam.dam_id:
        warnings.append(f"{bull.display_id} and {dam.display_id} share the same recorded dam.")
    return warnings


def generate_temp_id():
    year = date.today().year
    prefix = f"C{year}"
    count = Animal.query.filter(Animal.temp_id.like(f"{prefix}%")).count()
    return f"{prefix}-{count + 1:04d}"


def apply_age_transfers(commit=True):
    """Moves animals into their next type once they hit the configured age.
    e.g. Registered Angus Bull Calf -> Registered Angus Bull at 12 months."""
    transferred = []
    types = AnimalType.query.filter_by(auto_transfer_trigger=TRANSFER_TRIGGER_AGE).all()
    for t in types:
        if not t.auto_transfer_to_type_id or not t.auto_transfer_age_months:
            continue
        animals = Animal.query.filter_by(animal_type_id=t.id, is_active=True).all()
        for a in animals:
            if not a.birth_date:
                continue
            months = (date.today() - a.birth_date).days / 30.44
            if months >= t.auto_transfer_age_months:
                a.animal_type_id = t.auto_transfer_to_type_id
                transferred.append(a)
    if transferred and commit:
        db.session.commit()
    return transferred


def apply_weaning_transfer(calf_record):
    """Call right after setting calf_record.weaned_date. Transfers the dam's
    type if this is her first weaned calf and her type is configured to
    transfer on that trigger (e.g. Commercial Heifer -> Commercial Cow)."""
    dam = calf_record.dam
    if not dam or not calf_record.weaned_date:
        return False
    t = dam.animal_type
    if not t or t.auto_transfer_trigger != TRANSFER_TRIGGER_WEANED or not t.auto_transfer_to_type_id:
        return False
    earlier_weaned = [
        c for c in dam.calf_records_as_dam
        if c.weaned_date and c.calving_date < calf_record.calving_date
    ]
    if earlier_weaned:
        return False
    dam.animal_type_id = t.auto_transfer_to_type_id
    return True


def auto_sync_breeding_exposure(commit=True):
    """Automatically maintains one open BreedingGroup per location whenever an
    active bull and an active cow/heifer currently share that location, and
    creates ExposureRecords for the females present there. Closes the
    auto-tracked group once no bull is left paired with a female. Manually
    created (non-auto) groups are never touched by this."""
    changes = []
    for loc in Location.query.filter_by(is_active=True).all():
        animals_here = Animal.query.filter_by(location_id=loc.id, is_active=True).all()
        bulls_here = [a for a in animals_here if a.is_bull]
        females_here = [
            a for a in animals_here
            if a.sex == SEX_FEMALE and a.animal_type and ("Cow" in a.animal_type.name or "Heifer" in a.animal_type.name)
        ]

        group = BreedingGroup.query.filter_by(location_id=loc.id, end_date=None, is_auto=True).first()

        if not bulls_here or not females_here:
            if group:
                group.end_date = date.today()
                changes.append(f"Closed auto-tracked breeding group at {loc.name} (no bull+female pairing left)")
            continue

        if not group:
            group = BreedingGroup(
                location_id=loc.id, start_date=date.today(), is_auto=True,
                notes="Auto-detected: bull(s) and female(s) currently in the same location.",
            )
            db.session.add(group)
            db.session.flush()
            changes.append(f"Started auto-tracked breeding group at {loc.name}")

        current_bull_ids = {b.id for b in group.bulls}
        new_bull_ids = {b.id for b in bulls_here}
        if current_bull_ids != new_bull_ids:
            group.bulls = bulls_here

        existing_exposed_ids = {e.animal_id for e in group.exposures}
        for f in females_here:
            if f.id not in existing_exposed_ids:
                db.session.add(ExposureRecord(breeding_group_id=group.id, animal_id=f.id))
                changes.append(
                    f"{f.display_id} now exposed to {', '.join(b.display_id for b in bulls_here)} at {loc.name}"
                )

    if commit:
        db.session.commit()
    return changes


def not_seen_alerts():
    return sorted(
        (a for a in Animal.query.filter_by(is_active=True).all() if a.not_seen_flagged),
        key=lambda a: a.last_seen_date or date.min,
    )


def semen_test_alerts():
    alerts = []
    for a in Animal.query.filter_by(is_active=True).all():
        if not a.is_bull:
            continue
        test = a.latest_semen_test
        if test is None:
            alerts.append((a, "No semen test on record"))
        elif test.result in (SEMEN_BAD, SEMEN_RETEST):
            alerts.append((a, f"Semen test result: {test.result}"))
        elif (date.today() - test.test_date).days > 365:
            alerts.append((a, "Yearly semen test overdue"))
    return alerts


def rental_overdue_alerts():
    return Rental.query.filter(Rental.status == RENTAL_ACTIVE, Rental.end_date < date.today()).all()


def run_lifecycle_checks():
    """Convenience entry point called from the dashboard on each load."""
    apply_age_transfers()
    auto_sync_breeding_exposure()
    return {
        "not_seen": not_seen_alerts(),
        "semen": semen_test_alerts(),
        "rentals_overdue": rental_overdue_alerts(),
    }
