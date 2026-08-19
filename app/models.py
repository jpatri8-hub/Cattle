from datetime import date, datetime, timedelta

from flask_login import UserMixin
from werkzeug.security import check_password_hash, generate_password_hash

from app import db

ROLE_OWNER = "owner"
ROLE_HAND = "hand"
ROLES = [ROLE_OWNER, ROLE_HAND]

SEX_MALE = "male"
SEX_FEMALE = "female"
SEX_CHOICES = [SEX_MALE, SEX_FEMALE]

TRANSFER_TRIGGER_AGE = "age_months"
TRANSFER_TRIGGER_WEANED = "first_calf_weaned"
TRANSFER_TRIGGER_CHOICES = [
    ("", "No automatic transfer"),
    (TRANSFER_TRIGGER_AGE, "At a given age (months)"),
    (TRANSFER_TRIGGER_WEANED, "When her first calf is weaned"),
]

DEPARTURE_SOLD = "sold"  # set automatically by the Sales flow - not a manual departure choice
DEPARTURE_DECEASED = "deceased"
DEPARTURE_CULLED = "culled"  # legacy value; culled bulls are now tracked via the "Cull Bull Sale" category
DEPARTURE_LOST = "lost"
DEPARTURE_OTHER = "other"
DEPARTURE_CHOICES = [
    (DEPARTURE_DECEASED, "Deceased"),
    (DEPARTURE_LOST, "Lost"),
    (DEPARTURE_OTHER, "Other"),
]

RENTAL_BOOKED = "booked"
RENTAL_ACTIVE = "active"
RENTAL_RETURNED = "returned"
RENTAL_CANCELLED = "cancelled"
RENTAL_STATUS_CHOICES = [RENTAL_BOOKED, RENTAL_ACTIVE, RENTAL_RETURNED, RENTAL_CANCELLED]
RENTAL_UNAVAILABLE_HOLD_DAYS = 15
NOT_SEEN_FLAG_DAYS = 122  # ~4 months

CONDITION_SCORE_CHOICES = ["Good", "Slim", "Poor"]

SEMEN_GOOD = "Good"
SEMEN_BAD = "Bad"
SEMEN_RETEST = "Retest"
SEMEN_NOT_TESTED = "Not Tested"
SEMEN_RESULT_CHOICES = [SEMEN_GOOD, SEMEN_BAD, SEMEN_RETEST]
SEMEN_TEST_VALID_DAYS = 183  # ~6 months - a Good result older than this no longer counts as current

HEALTH_STATUS_CHOICES = ["Healthy", "Sick", "Injured", "Other"]

CALF_QUALITY_SCALE = {"Good": 3, "Average": 2, "Poor": 1}
CALF_QUALITY_CHOICES = ["Good", "Average", "Poor"]

CALVING_EASE_CHOICES = [
    (1, "1 - No Assistance"),
    (2, "2 - Some Assistance"),
    (3, "3 - Mechanical Assistance"),
    (4, "4 - Cesarean Section"),
    (5, "5 - Abnormal Delivery"),
]

BRAND_TYPE_CHOICES = ["Hot Brand", "Freeze Brand"]

GRADE_SCALE = {"Prime": 4, "Choice": 3, "Select": 2, "Standard": 1}
STEAK_GRADE_CHOICES = ["Prime", "Choice", "Select", "Standard", "Other"]


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default=ROLE_HAND)
    is_active_user = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @property
    def is_owner(self):
        return self.role == ROLE_OWNER

    @property
    def is_active(self):
        return self.is_active_user

    def __repr__(self):
        return f"<User {self.email} ({self.role})>"


class Location(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    @property
    def display_name(self):
        return self.name

    def __repr__(self):
        return f"<Location {self.name}>"


class AnimalType(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False, unique=True)
    sex = db.Column(db.String(10), nullable=False)  # male / female
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    auto_transfer_trigger = db.Column(db.String(20))  # age_months / first_calf_weaned / None
    auto_transfer_age_months = db.Column(db.Integer)
    auto_transfer_to_type_id = db.Column(db.Integer, db.ForeignKey("animal_type.id"))

    auto_transfer_to = db.relationship("AnimalType", remote_side=[id])

    def __repr__(self):
        return f"<AnimalType {self.name}>"


class AnimalTypeCostRate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    animal_type_id = db.Column(db.Integer, db.ForeignKey("animal_type.id"), nullable=False)
    rate_per_day = db.Column(db.Numeric(8, 2), nullable=False)
    effective_date = db.Column(db.Date, nullable=False, default=date.today)
    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    animal_type = db.relationship("AnimalType", backref=db.backref(
        "cost_rates", order_by="AnimalTypeCostRate.effective_date.desc()", cascade="all, delete-orphan"
    ))


animal_candidate_sires = db.Table(
    "animal_candidate_sires",
    db.Column("animal_id", db.Integer, db.ForeignKey("animal.id"), primary_key=True),
    db.Column("sire_candidate_id", db.Integer, db.ForeignKey("animal.id"), primary_key=True),
)


class Animal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    tag_id = db.Column(db.String(40), index=True)  # not unique - duplicate tags are allowed; `id` is the true unique identifier
    temp_id = db.Column(db.String(40), unique=True, index=True)
    name = db.Column(db.String(120))

    animal_type_id = db.Column(db.Integer, db.ForeignKey("animal_type.id"), nullable=False)
    sex = db.Column(db.String(10), nullable=False)
    birth_date = db.Column(db.Date)
    birth_weight = db.Column(db.Numeric(7, 2))

    location_id = db.Column(db.Integer, db.ForeignKey("location.id"))
    birth_location_id = db.Column(db.Integer, db.ForeignKey("location.id"))
    notes = db.Column(db.Text)

    registration_number = db.Column(db.String(80))
    brand_type = db.Column(db.String(20))  # Hot Brand / Freeze Brand
    brand_number = db.Column(db.String(20), unique=True, index=True)
    is_sale_bull = db.Column(db.Boolean, default=False, nullable=False)
    is_cripple = db.Column(db.Boolean, default=False, nullable=False)

    sire_id = db.Column(db.Integer, db.ForeignKey("animal.id"))
    dam_id = db.Column(db.Integer, db.ForeignKey("animal.id"))

    is_active = db.Column(db.Boolean, default=True, nullable=False)  # on farm
    departure_reason = db.Column(db.String(20))
    departure_date = db.Column(db.Date)

    purchase_date = db.Column(db.Date)
    purchase_price = db.Column(db.Numeric(10, 2))

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    animal_type = db.relationship("AnimalType")
    location = db.relationship("Location", foreign_keys=[location_id])
    birth_location = db.relationship("Location", foreign_keys=[birth_location_id])
    sire = db.relationship("Animal", remote_side=[id], foreign_keys=[sire_id], backref="offspring_as_sire")
    dam = db.relationship("Animal", remote_side=[id], foreign_keys=[dam_id], backref="offspring_as_dam")
    created_by = db.relationship("User")

    candidate_sires = db.relationship(
        "Animal",
        secondary=animal_candidate_sires,
        primaryjoin=id == animal_candidate_sires.c.animal_id,
        secondaryjoin=id == animal_candidate_sires.c.sire_candidate_id,
    )

    weight_records = db.relationship(
        "WeightRecord", backref="animal", order_by="WeightRecord.date_recorded.desc()",
        cascade="all, delete-orphan"
    )
    health_records = db.relationship(
        "HealthRecord", backref="animal", order_by="HealthRecord.date_recorded.desc()",
        cascade="all, delete-orphan"
    )
    last_seen_checks = db.relationship(
        "LastSeenCheck", backref="animal", order_by="LastSeenCheck.date_recorded.desc()",
        cascade="all, delete-orphan"
    )
    rentals = db.relationship(
        "Rental", backref="bull", order_by="Rental.start_date.desc()",
        cascade="all, delete-orphan"
    )
    semen_tests = db.relationship(
        "SemenTest", backref="bull", order_by="SemenTest.test_date.desc()",
        cascade="all, delete-orphan"
    )
    epd = db.relationship("BullEPD", backref="animal", uselist=False, cascade="all, delete-orphan")
    feedout_records = db.relationship(
        "FeedoutRecord", backref="animal", order_by="FeedoutRecord.start_date.desc()",
        cascade="all, delete-orphan"
    )
    calf_records_as_dam = db.relationship(
        "CalfRecord", foreign_keys="CalfRecord.dam_id", backref="dam",
        order_by="CalfRecord.calving_date.desc()"
    )
    exposure_records = db.relationship(
        "ExposureRecord", backref="animal", order_by="ExposureRecord.id.desc()",
        cascade="all, delete-orphan"
    )
    sale_lines = db.relationship("SaleLine", backref="animal")

    @property
    def current_weight(self):
        if self.weight_records:
            return self.weight_records[0].weight
        return None

    @property
    def age_years_months(self):
        if not self.birth_date:
            return None
        end = self.departure_date or date.today()
        days = (end - self.birth_date).days
        years, months = divmod(days // 30, 12)
        return years, months

    @property
    def age_display(self):
        ym = self.age_years_months
        if ym is None:
            return "Unknown"
        years, months = ym
        if years:
            return f"{years}y {months}m"
        return f"{months}m"

    @property
    def display_id(self):
        return self.tag_id or self.temp_id or f"#{self.id}"

    @property
    def is_bull(self):
        return self.sex == SEX_MALE and self.animal_type and "Bull" in self.animal_type.name and "Calf" not in self.animal_type.name

    @property
    def is_male_calf(self):
        return self.sex == SEX_MALE and self.animal_type and "Calf" in self.animal_type.name

    @property
    def last_seen_date(self):
        dates = [c.date_recorded for c in self.last_seen_checks]
        dates += [h.date_recorded for h in self.health_records if h.record_type == "vaccination"]
        return max(dates) if dates else None

    @property
    def not_seen_flagged(self):
        if not self.is_active:
            return False
        last = self.last_seen_date
        if not last:
            return True
        return (date.today() - last).days > NOT_SEEN_FLAG_DAYS

    @property
    def latest_semen_test(self):
        return self.semen_tests[0] if self.semen_tests else None

    @property
    def current_semen_status(self):
        """One of SEMEN_NOT_TESTED / SEMEN_BAD / SEMEN_GOOD / SEMEN_RETEST. A
        Good result older than SEMEN_TEST_VALID_DAYS no longer counts as
        current and reads the same as never having been tested - it takes a
        fresh test to clear, not just the passage of being "the latest"."""
        test = self.latest_semen_test
        if not test:
            return SEMEN_NOT_TESTED
        if test.result == SEMEN_GOOD:
            if (date.today() - test.test_date).days > SEMEN_TEST_VALID_DAYS:
                return SEMEN_NOT_TESTED
            return SEMEN_GOOD
        return test.result

    @property
    def latest_rental(self):
        return self.rentals[0] if self.rentals else None

    @property
    def rental_unavailable_reason(self):
        """Returns a reason string if a bull is unavailable for rent, else None."""
        if not self.is_bull:
            return None
        if self.is_cripple:
            return "Marked cripple"
        open_rental = next(
            (r for r in self.rentals if r.status in (RENTAL_BOOKED, RENTAL_ACTIVE)), None
        )
        if open_rental:
            return "Out on rent" if open_rental.status == RENTAL_ACTIVE else "Committed to a rental"
        if self.location_id:
            with_females = Animal.query.filter_by(
                location_id=self.location_id, is_active=True, sex=SEX_FEMALE
            ).all()
            with_females = [
                a for a in with_females
                if a.animal_type and ("Cow" in a.animal_type.name or "Heifer" in a.animal_type.name)
            ]
            if with_females:
                return f"With cows/heifers at {self.location.display_name if self.location else 'current location'}"
        last_returned = next((r for r in self.rentals if r.status == RENTAL_RETURNED and r.actual_return_date), None)
        if last_returned:
            days_since = (date.today() - last_returned.actual_return_date).days
            if 0 <= days_since < RENTAL_UNAVAILABLE_HOLD_DAYS:
                return f"Returned {days_since} day(s) ago (holds for {RENTAL_UNAVAILABLE_HOLD_DAYS} days)"
        semen_status = self.current_semen_status
        if semen_status != SEMEN_GOOD:
            return f"Semen test: {semen_status}"
        return None

    @property
    def is_rentable_available(self):
        return self.is_bull and self.is_active and self.rental_unavailable_reason is None

    @property
    def has_calf_at_side(self):
        return any(
            c.weaned_date is None and c.calf_animal and c.calf_animal.is_active
            for c in self.calf_records_as_dam
        )

    @property
    def is_low_birth_weight_candidate(self):
        if not self.is_bull or not self.epd:
            return False
        ced = self.epd.ced
        bw = self.epd.birth_weight_epd
        return ced is not None and bw is not None and ced >= 5 and bw <= 1

    def __repr__(self):
        return f"<Animal {self.display_id}>"


class WeightRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    weight = db.Column(db.Numeric(7, 2), nullable=False)
    date_recorded = db.Column(db.Date, nullable=False, default=date.today)
    notes = db.Column(db.String(255))
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    recorded_by = db.relationship("User")


class HealthRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    record_type = db.Column(db.String(40), nullable=False)  # vaccination, treatment, illness, vet_visit
    description = db.Column(db.String(255), nullable=False)
    date_recorded = db.Column(db.Date, nullable=False, default=date.today)
    next_due_date = db.Column(db.Date)
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    recorded_by = db.relationship("User")


class LastSeenCheck(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    date_recorded = db.Column(db.Date, nullable=False, default=date.today)
    seen_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    location_id = db.Column(db.Integer, db.ForeignKey("location.id"))
    health_status = db.Column(db.String(20), nullable=False, default="Healthy")
    notes = db.Column(db.Text)

    seen_by = db.relationship("User")
    location = db.relationship("Location")


breeding_group_bulls = db.Table(
    "breeding_group_bulls",
    db.Column("breeding_group_id", db.Integer, db.ForeignKey("breeding_group.id"), primary_key=True),
    db.Column("bull_id", db.Integer, db.ForeignKey("animal.id"), primary_key=True),
)


class BreedingGroup(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    location_id = db.Column(db.Integer, db.ForeignKey("location.id"), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date)
    notes = db.Column(db.Text)
    is_auto = db.Column(db.Boolean, default=False, nullable=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    location = db.relationship("Location")
    bulls = db.relationship("Animal", secondary=breeding_group_bulls, order_by="Animal.tag_id")
    exposures = db.relationship(
        "ExposureRecord", backref="breeding_group", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<BreedingGroup {self.location_id} {self.start_date}>"


class ExposureRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    breeding_group_id = db.Column(db.Integer, db.ForeignKey("breeding_group.id"), nullable=False)
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    confirmed_bred = db.Column(db.Boolean)  # None = unknown/pending
    confirmed_bred_date = db.Column(db.Date)
    notes = db.Column(db.Text)


class BullEPD(db.Model):
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), primary_key=True)
    ced = db.Column(db.Numeric(5, 1))
    birth_weight_epd = db.Column(db.Numeric(5, 1))
    weaning_weight_epd = db.Column(db.Numeric(5, 1))
    yearling_weight_epd = db.Column(db.Numeric(5, 1))
    milk_epd = db.Column(db.Numeric(5, 1))
    marbling_epd = db.Column(db.Numeric(5, 2))
    ribeye_area_epd = db.Column(db.Numeric(5, 2))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SemenTest(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    bull_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    test_date = db.Column(db.Date, nullable=False, default=date.today)
    result = db.Column(db.String(20), nullable=False)
    notes = db.Column(db.Text)
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))


class CalfRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    dam_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    sire_id = db.Column(db.Integer, db.ForeignKey("animal.id"))
    breeding_group_id = db.Column(db.Integer, db.ForeignKey("breeding_group.id"))

    calving_date = db.Column(db.Date, nullable=False, default=date.today)
    calf_sex = db.Column(db.String(10))
    birth_weight = db.Column(db.Numeric(7, 2))
    calf_animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"))
    calving_ease = db.Column(db.Integer)  # 1-5, see CALVING_EASE_CHOICES

    weaned_date = db.Column(db.Date)
    weaning_weight = db.Column(db.Numeric(7, 2))
    scrotum_circumference = db.Column(db.Numeric(5, 2))  # cm, bull calves only
    hip_height = db.Column(db.Numeric(5, 2))  # inches, at weaning, both sexes
    quality = db.Column(db.String(10))  # Good / Average / Poor, see CALF_QUALITY_SCALE

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sire = db.relationship("Animal", foreign_keys=[sire_id])
    breeding_group = db.relationship("BreedingGroup")
    calf_animal = db.relationship("Animal", foreign_keys=[calf_animal_id], backref=db.backref("calf_record", uselist=False))

    @property
    def weaning_age_days(self):
        if self.weaned_date and self.calving_date:
            return (self.weaned_date - self.calving_date).days
        return None


class Rental(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    bull_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    customer_id = db.Column(db.Integer, db.ForeignKey("buyer.id"), nullable=False)

    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    actual_return_date = db.Column(db.Date)

    rate = db.Column(db.Numeric(8, 2))
    rate_type = db.Column(db.String(20), default="flat")  # flat or daily
    deposit_amount = db.Column(db.Numeric(8, 2))
    deposit_returned = db.Column(db.Boolean, default=False)

    status = db.Column(db.String(20), nullable=False, default=RENTAL_BOOKED)
    contract_notes = db.Column(db.Text)
    return_condition_score = db.Column(db.String(10))  # Good / Slim / Poor

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    created_by = db.relationship("User")
    customer = db.relationship("Buyer", backref=db.backref("rentals", order_by="Rental.start_date.desc()"))
    checks = db.relationship(
        "RentalCheck", backref="rental", order_by="RentalCheck.date_recorded",
        cascade="all, delete-orphan"
    )

    @property
    def is_overdue(self):
        return self.status == RENTAL_ACTIVE and self.end_date < date.today()

    @property
    def revenue(self):
        if self.rate_type == "daily" and self.rate:
            end = self.actual_return_date or self.end_date
            days = max((end - self.start_date).days, 0) + 1
            return self.rate * days
        return self.rate or 0


class RentalCheck(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    rental_id = db.Column(db.Integer, db.ForeignKey("rental.id"), nullable=False)
    check_type = db.Column(db.String(20), nullable=False)  # pickup or return
    condition_score = db.Column(db.String(10))  # Good / Slim / Poor - typically set on return
    condition_notes = db.Column(db.Text)
    date_recorded = db.Column(db.Date, nullable=False, default=date.today)
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    recorded_by = db.relationship("User")


class FeedoutRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)

    start_date = db.Column(db.Date, nullable=False, default=date.today)
    start_weight = db.Column(db.Numeric(7, 2))
    end_date = db.Column(db.Date)
    live_weight = db.Column(db.Numeric(7, 2))  # weight at slaughter
    yield_weight = db.Column(db.Numeric(7, 2))  # carcass/hanging weight, manually entered
    steak_grade = db.Column(db.String(20))
    notes = db.Column(db.Text)

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def start_age_display(self):
        animal = self.animal
        if not animal or not animal.birth_date:
            return None
        days = (self.start_date - animal.birth_date).days
        years, months = divmod(days // 30, 12)
        return f"{years}y {months}m" if years else f"{months}m"

    @property
    def days_on_feed(self):
        if self.start_date and self.end_date:
            return (self.end_date - self.start_date).days
        return None

    @property
    def yield_pct(self):
        if self.yield_weight and self.live_weight:
            return self.yield_weight / self.live_weight * 100
        return None

    @property
    def average_daily_gain(self):
        days = self.days_on_feed
        if self.live_weight and self.start_weight and days:
            return (self.live_weight - self.start_weight) / days
        return None


class SaleCategory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False, unique=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    def __repr__(self):
        return f"<SaleCategory {self.name}>"


class Buyer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(40))
    email = db.Column(db.String(255))
    address = db.Column(db.String(255))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sales = db.relationship("Sale", backref="buyer")


class Sale(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sale_category_id = db.Column(db.Integer, db.ForeignKey("sale_category.id"), nullable=False)
    buyer_id = db.Column(db.Integer, db.ForeignKey("buyer.id"), nullable=False)

    sale_date = db.Column(db.Date, nullable=False, default=date.today)
    payment_method = db.Column(db.String(60))
    notes = db.Column(db.Text)
    invoice_number = db.Column(db.String(40), unique=True)

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    category = db.relationship("SaleCategory")
    created_by = db.relationship("User")
    lines = db.relationship("SaleLine", backref="sale", cascade="all, delete-orphan")

    @property
    def total_price(self):
        return sum((line.price or 0) for line in self.lines)

    @property
    def average_price(self):
        return self.total_price / len(self.lines) if self.lines else 0

    @property
    def average_weight(self):
        weighted = [line.weight for line in self.lines if line.weight]
        return sum(weighted) / len(weighted) if weighted else None

    def averages_by_sex(self):
        """Returns {sex: {'count', 'avg_price', 'avg_weight'}} for bulk sale reporting."""
        buckets = {}
        for line in self.lines:
            sex = line.animal.sex if line.animal else "unknown"
            b = buckets.setdefault(sex, {"count": 0, "prices": [], "weights": []})
            b["count"] += 1
            if line.price:
                b["prices"].append(line.price)
            if line.weight:
                b["weights"].append(line.weight)
        result = {}
        for sex, b in buckets.items():
            result[sex] = {
                "count": b["count"],
                "avg_price": sum(b["prices"]) / len(b["prices"]) if b["prices"] else None,
                "avg_weight": sum(b["weights"]) / len(b["weights"]) if b["weights"] else None,
            }
        return result


class SaleLine(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sale_id = db.Column(db.Integer, db.ForeignKey("sale.id"), nullable=False)
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    price = db.Column(db.Numeric(10, 2), nullable=False)
    weight = db.Column(db.Numeric(7, 2))
    notes = db.Column(db.String(255))
