from flask_wtf import FlaskForm
from flask_wtf.file import FileAllowed, FileField
from wtforms import (
    BooleanField, DateField, DecimalField, PasswordField, SelectField,
    StringField, SubmitField, TextAreaField,
)
from wtforms.validators import DataRequired, Email, Length, Optional

from app.models import RENTAL_STATUS_CHOICES, ROLES, SEX_CHOICES, STATUS_CHOICES


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email()])
    password = PasswordField("Password", validators=[DataRequired()])
    submit = SubmitField("Log In")


class UserForm(FlaskForm):
    name = StringField("Name", validators=[DataRequired(), Length(max=120)])
    email = StringField("Email", validators=[DataRequired(), Email()])
    role = SelectField("Role", choices=[(r, r.capitalize()) for r in ROLES])
    password = PasswordField("Password", validators=[Optional(), Length(min=6)])
    is_active_user = BooleanField("Active", default=True)
    submit = SubmitField("Save")


class AnimalForm(FlaskForm):
    tag_id = StringField("Tag / ID Number", validators=[DataRequired(), Length(max=40)])
    name = StringField("Name", validators=[Optional(), Length(max=120)])
    breed = StringField("Breed", validators=[Optional(), Length(max=80)])
    sex = SelectField("Sex", choices=[(s, s) for s in SEX_CHOICES], validators=[DataRequired()])
    birth_date = DateField("Birth Date", validators=[Optional()])
    color = StringField("Color", validators=[Optional(), Length(max=60)])
    status = SelectField("Status", choices=[(s, s.capitalize()) for s in STATUS_CHOICES], validators=[DataRequired()])
    location = StringField("Location / Pen", validators=[Optional(), Length(max=120)])
    sire_id = SelectField("Sire", coerce=int, validators=[Optional()])
    dam_id = SelectField("Dam", coerce=int, validators=[Optional()])
    registration_number = StringField("Registration Number", validators=[Optional(), Length(max=80)])
    registration_file = FileField("Registration Papers", validators=[FileAllowed(["pdf", "png", "jpg", "jpeg"])])
    photo = FileField("Photo", validators=[FileAllowed(["png", "jpg", "jpeg", "gif"])])
    purchase_date = DateField("Purchase Date", validators=[Optional()])
    purchase_price = DecimalField("Purchase Price", validators=[Optional()], places=2)
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Animal")


class WeightRecordForm(FlaskForm):
    weight = DecimalField("Weight (lbs)", validators=[DataRequired()], places=2)
    date_recorded = DateField("Date", validators=[DataRequired()])
    notes = StringField("Notes", validators=[Optional(), Length(max=255)])
    submit = SubmitField("Add Weight Record")


class HealthRecordForm(FlaskForm):
    record_type = SelectField(
        "Type",
        choices=[
            ("vaccination", "Vaccination"),
            ("treatment", "Treatment"),
            ("illness", "Illness"),
            ("vet_visit", "Vet Visit"),
        ],
        validators=[DataRequired()],
    )
    description = StringField("Description", validators=[DataRequired(), Length(max=255)])
    date_recorded = DateField("Date", validators=[DataRequired()])
    vet_name = StringField("Vet Name", validators=[Optional(), Length(max=120)])
    cost = DecimalField("Cost", validators=[Optional()], places=2)
    next_due_date = DateField("Next Due Date", validators=[Optional()])
    submit = SubmitField("Add Health Record")


class BreedingRecordForm(FlaskForm):
    sire_id = SelectField("Sire (Bull)", coerce=int, validators=[DataRequired()])
    dam_id = SelectField("Dam (Cow)", coerce=int, validators=[DataRequired()])
    breeding_date = DateField("Breeding Date", validators=[DataRequired()])
    expected_calving_date = DateField("Expected Calving Date", validators=[Optional()])
    actual_calving_date = DateField("Actual Calving Date", validators=[Optional()])
    offspring_id = SelectField("Offspring (if born)", coerce=int, validators=[Optional()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Breeding Record")


class RentalForm(FlaskForm):
    bull_id = SelectField("Bull", coerce=int, validators=[DataRequired()])
    renter_name = StringField("Renter Name", validators=[DataRequired(), Length(max=120)])
    renter_phone = StringField("Renter Phone", validators=[Optional(), Length(max=40)])
    renter_email = StringField("Renter Email", validators=[Optional(), Email(), Length(max=255)])
    renter_address = StringField("Renter Address", validators=[Optional(), Length(max=255)])
    start_date = DateField("Start Date", validators=[DataRequired()])
    end_date = DateField("End Date", validators=[DataRequired()])
    rate = DecimalField("Rate", validators=[Optional()], places=2)
    rate_type = SelectField("Rate Type", choices=[("flat", "Flat Fee"), ("daily", "Per Day")])
    deposit_amount = DecimalField("Deposit Amount", validators=[Optional()], places=2)
    contract_notes = TextAreaField("Contract Notes / Terms", validators=[Optional()])
    submit = SubmitField("Book Rental")


class RentalCheckForm(FlaskForm):
    check_type = SelectField("Check Type", choices=[("pickup", "Pickup"), ("return", "Return")])
    weight = DecimalField("Weight (lbs)", validators=[Optional()], places=2)
    condition_notes = TextAreaField("Condition Notes", validators=[Optional()])
    health_notes = TextAreaField("Health Notes", validators=[Optional()])
    date_recorded = DateField("Date", validators=[DataRequired()])
    submit = SubmitField("Log Check")


class RentalStatusForm(FlaskForm):
    status = SelectField("Status", choices=[(s, s.capitalize()) for s in RENTAL_STATUS_CHOICES])
    actual_return_date = DateField("Actual Return Date", validators=[Optional()])
    deposit_returned = BooleanField("Deposit Returned")
    submit = SubmitField("Update Rental")


class BuyerForm(FlaskForm):
    name = StringField("Name", validators=[DataRequired(), Length(max=120)])
    phone = StringField("Phone", validators=[Optional(), Length(max=40)])
    email = StringField("Email", validators=[Optional(), Email(), Length(max=255)])
    address = StringField("Address", validators=[Optional(), Length(max=255)])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Buyer")


class SaleForm(FlaskForm):
    animal_id = SelectField("Animal", coerce=int, validators=[DataRequired()])
    buyer_id = SelectField("Buyer", coerce=int, validators=[DataRequired()])
    sale_price = DecimalField("Sale Price", validators=[DataRequired()], places=2)
    sale_date = DateField("Sale Date", validators=[DataRequired()])
    payment_method = StringField("Payment Method", validators=[Optional(), Length(max=60)])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Record Sale")
