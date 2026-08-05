from datetime import date, datetime

from flask_login import UserMixin
from werkzeug.security import check_password_hash, generate_password_hash

from app import db

ROLE_OWNER = "owner"
ROLE_HAND = "hand"
ROLES = [ROLE_OWNER, ROLE_HAND]

SEX_CHOICES = ["Bull", "Cow", "Steer", "Heifer"]
STATUS_AVAILABLE = "available"
STATUS_RENTED = "rented"
STATUS_SOLD = "sold"
STATUS_DECEASED = "deceased"
STATUS_CHOICES = [STATUS_AVAILABLE, STATUS_RENTED, STATUS_SOLD, STATUS_DECEASED]

RENTAL_BOOKED = "booked"
RENTAL_ACTIVE = "active"
RENTAL_RETURNED = "returned"
RENTAL_CANCELLED = "cancelled"
RENTAL_STATUS_CHOICES = [RENTAL_BOOKED, RENTAL_ACTIVE, RENTAL_RETURNED, RENTAL_CANCELLED]


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


class Animal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    tag_id = db.Column(db.String(40), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120))
    breed = db.Column(db.String(80))
    sex = db.Column(db.String(20), nullable=False)
    birth_date = db.Column(db.Date)
    color = db.Column(db.String(60))
    status = db.Column(db.String(20), nullable=False, default=STATUS_AVAILABLE)
    location = db.Column(db.String(120))
    notes = db.Column(db.Text)
    photo_filename = db.Column(db.String(255))

    registration_number = db.Column(db.String(80))
    registration_file = db.Column(db.String(255))

    sire_id = db.Column(db.Integer, db.ForeignKey("animal.id"))
    dam_id = db.Column(db.Integer, db.ForeignKey("animal.id"))

    purchase_date = db.Column(db.Date)
    purchase_price = db.Column(db.Numeric(10, 2))

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    sire = db.relationship("Animal", remote_side=[id], foreign_keys=[sire_id], backref="offspring_as_sire")
    dam = db.relationship("Animal", remote_side=[id], foreign_keys=[dam_id], backref="offspring_as_dam")
    created_by = db.relationship("User")

    weight_records = db.relationship(
        "WeightRecord", backref="animal", order_by="WeightRecord.date_recorded.desc()",
        cascade="all, delete-orphan"
    )
    health_records = db.relationship(
        "HealthRecord", backref="animal", order_by="HealthRecord.date_recorded.desc()",
        cascade="all, delete-orphan"
    )
    rentals = db.relationship(
        "Rental", backref="bull", order_by="Rental.start_date.desc()",
        cascade="all, delete-orphan"
    )

    @property
    def current_weight(self):
        if self.weight_records:
            return self.weight_records[0].weight
        return None

    @property
    def age_display(self):
        if not self.birth_date:
            return "Unknown"
        days = (date.today() - self.birth_date).days
        years, months = divmod(days // 30, 12)
        if years:
            return f"{years}y {months}m"
        return f"{months}m"

    @property
    def is_bull(self):
        return self.sex == "Bull"

    def __repr__(self):
        return f"<Animal {self.tag_id}>"


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


class BreedingRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sire_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    dam_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    breeding_date = db.Column(db.Date, nullable=False, default=date.today)
    expected_calving_date = db.Column(db.Date)
    actual_calving_date = db.Column(db.Date)
    offspring_id = db.Column(db.Integer, db.ForeignKey("animal.id"))
    notes = db.Column(db.Text)
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))

    sire = db.relationship("Animal", foreign_keys=[sire_id])
    dam = db.relationship("Animal", foreign_keys=[dam_id])
    offspring = db.relationship("Animal", foreign_keys=[offspring_id])
    recorded_by = db.relationship("User")


class Rental(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    bull_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)

    renter_name = db.Column(db.String(120), nullable=False)
    renter_phone = db.Column(db.String(40))
    renter_email = db.Column(db.String(255))
    renter_address = db.Column(db.String(255))

    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    actual_return_date = db.Column(db.Date)

    rate = db.Column(db.Numeric(8, 2))
    rate_type = db.Column(db.String(20), default="flat")  # flat or daily
    deposit_amount = db.Column(db.Numeric(8, 2))
    deposit_returned = db.Column(db.Boolean, default=False)

    status = db.Column(db.String(20), nullable=False, default=RENTAL_BOOKED)
    contract_notes = db.Column(db.Text)

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    created_by = db.relationship("User")
    checks = db.relationship(
        "RentalCheck", backref="rental", order_by="RentalCheck.date_recorded",
        cascade="all, delete-orphan"
    )

    @property
    def is_overdue(self):
        return self.status == RENTAL_ACTIVE and self.end_date < date.today()


class RentalCheck(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    rental_id = db.Column(db.Integer, db.ForeignKey("rental.id"), nullable=False)
    check_type = db.Column(db.String(20), nullable=False)  # pickup or return
    weight = db.Column(db.Numeric(7, 2))
    condition_notes = db.Column(db.Text)
    health_notes = db.Column(db.Text)
    date_recorded = db.Column(db.Date, nullable=False, default=date.today)
    recorded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    recorded_by = db.relationship("User")


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
    animal_id = db.Column(db.Integer, db.ForeignKey("animal.id"), nullable=False)
    buyer_id = db.Column(db.Integer, db.ForeignKey("buyer.id"), nullable=False)

    sale_price = db.Column(db.Numeric(10, 2), nullable=False)
    sale_date = db.Column(db.Date, nullable=False, default=date.today)
    payment_method = db.Column(db.String(60))
    notes = db.Column(db.Text)
    invoice_number = db.Column(db.String(40), unique=True)

    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    animal = db.relationship("Animal")
    created_by = db.relationship("User")
