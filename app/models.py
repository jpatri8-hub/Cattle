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

DEPARTURE_SOLD = "sold"
DEPARTURE_DECEASED = "deceased"
DEPARTURE_CULLED = "culled"
DEPARTURE_LOST = "lost"
DEPARTURE_OTHER = "other"
DEPARTURE_CHOICES = [
    (DEPARTURE_SOLD, "Sold"),
    (DEPARTURE_DECEASED, "Deceased"),
    (DEPARTURE_CULLED, "Culled"),
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
SEMEN_RESULT_CHOICES = [SEMEN_GOOD, SEMEN_BAD, SEMEN_RETEST]

HEALTH_STATUS_CHOICES = ["Healthy", "Sick", "Injured", "Other"]

CALF_OUTCOME_ACTIVE = "active"
CALF_OUTCOME_LOST = "lost"
CALF_OUTCOME_DIED_AFTER_BIRTH = "died_after_birth"
CALF_OUTCOME_CULLED = "culled"
CALF_OUTCOME_RETAINED = "retained"
CALF_OUTCOME_SOLD = "sold"
CALF_OUTCOME_CHOICES = [
    (CALF_OUTCOME_ACTIVE, "Active (still with dam / on farm)"),
    (CALF_OUTCOME_LOST, "Lost calf (aborted / stillborn)"),
    (CALF_OUTCOME_DIED_AFTER_BIRTH, "Died after birth"),
    (CALF_OUTCOME_CULLED, "Culled"),
    (CALF_OUTCOME_RETAINED, "Retained (kept as breeding stock)"),
    (CALF_OUTCOME_SOLD, "Sold (not a cull)"),
]

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


class Property(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    locations = db.relationship("Location", backref="property", order_by="Location.name")

    def __repr__(self):
        return f"<Property {self.name}>"


class Location(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    property_id = db.Column(db.Integer, db.ForeignKey("property.id"), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    __table_args__ = (db.UniqueConstraint("name", "property_id", name="uq_location_name_property"),)

    @property
    def display_name(self):
        return f"{self.name} ({self.property.name})"

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
    tag_id = db.Column(db.String(40), unique=True, index=True)
    temp_id = db.Column(db.String(40), unique=True, index=True)
    name = db.Column(db.String(120))

    animal_type_id = db.Column(db.Integer, db.ForeignKey("animal_type.id"), nullable=False)
    sex = db.Column(db.String(10), nullable=False)
    breed = db.Column(db.String(80))
    birth_date = db.Column(db.Date)
    birth_weight = db.Column(db.Numeric(7, 2))
    color = db.Column(db.String(60))

    location_id = db.Column(db.Integer, db.ForeignKey("location.id"))
    birth_location_id = db.Column(db.Integer, db.ForeignKey("location.id"))
    notes = db.Column(db.Text)
    photo_filename = db.Column(db.String(255))

    registration_number = db.Column(db.String(80))
    registration_file = db.Column(db.String(255))

    sire_id = db.Column(db.Integer, db.ForeignKey("animal.id"))
    dam_id = db.Column(db.Integer, db.ForeignKey("animal.id"))

    is_active = db.Column(db.Boolean, default=True, nullable=False)  # on farm
    departure_reason = db.Column(db.String(20))
    departure_date = db.Column(db.Date)

    castration_date = db.Column(db.Date)
    castration_method = db.Column(db.String(80))

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
    def latest_rental(self):
        return self.rentals[0] if self.rentals else None

    @property
    def rental_unavailable_reason(self):
        """Returns a reason string if a bull is unavailable for rent, else None."""
        if not self.is_bull:
            return None
        open_rental = next(
            (r for r in self.rentals if r.status in (RENTAL_BOOKED, RENTAL_ACTIVE)), None
        )
        if open_rental:
            return "Out on rent" if open_rental.status == RENTAL_ACTIVE else "Committed to a rental"
        last_returned = next((r for r in self.rentals if r.status == RENTAL_RETURNED and r.actual_return_date), None)
        if last_returned:
            days_since = (date.today() - last_returned.actual_return_date).days
            if 0 <= days_since < RENTAL_UNAVAILABLE_HOLD_DAYS:
                return f"Returned {days_since} day(s) ago (holds for {RENTAL_UNAVAILABLE_HOLD_DAYS} days)"
        test = self.latest_semen_test
        if test and test.result in (SEMEN_BAD, SEMEN_RETEST):
            return f"Semen test result: {test.result}"
        return None

    @property
    def is_rentable_available(self):
        return self.is_bull and self.is_active and self.rental_unavailable_reason is None

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
    vet_name = db.Column(db.String(120))
    cost = db.Column(db.Numeric(8, 2))
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
    weaned_date = db.Column(db.Date)

    outcome = db.Column(db.String(20), nullable=False, default=CALF_OUTCOME_ACTIVE)
    cull_reason = db.Column(db.String(255))
    notes = db.Column(db.Text)

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sire = db.relationship("Animal", foreign_keys=[sire_id])
    breeding_group = db.relationship("BreedingGroup")
    calf_animal = db.relationship("Animal", foreign_keys=[calf_animal_id])


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
    weight = db.Column(db.Numeric(7, 2))
    condition_score = db.Column(db.String(10))  # Good / Slim / Poor - typically set on return
    condition_notes = db.Column(db.Text)
    health_notes = db.Column(db.Text)
    date_recorded = db.Column(db.Date, nullable=False, default=date.today)
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    recorded_by = db.relationship("User")


class FeedoutRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)

    start_date = db.Column(db.Date, nullable=False, default=date.today)
    start_weight = db.Column(db.Numeric(7, 2))
    days_on_feed = db.Column(db.Integer)
    end_date = db.Column(db.Date)
    hanging_weight = db.Column(db.Numeric(7, 2))
    dressed_yield_pct = db.Column(db.Numeric(5, 2))
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
    def estimated_finish_weight(self):
        if self.hanging_weight and self.dressed_yield_pct:
            return self.hanging_weight / (self.dressed_yield_pct / 100)
        return None

    @property
    def average_daily_gain(self):
        finish = self.estimated_finish_weight
        if finish and self.start_weight and self.days_on_feed:
            return (finish - self.start_weight) / self.days_on_feed
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
