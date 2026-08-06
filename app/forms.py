from flask_wtf import FlaskForm
from flask_wtf.file import FileAllowed, FileField
from wtforms import (
    BooleanField, DateField, DecimalField, IntegerField, PasswordField, SelectField,
    SelectMultipleField, StringField, SubmitField, TextAreaField,
)
from wtforms.validators import DataRequired, Email, Length, NumberRange, Optional

from app.models import (
    CALF_OUTCOME_CHOICES, CONDITION_SCORE_CHOICES, DEPARTURE_CHOICES,
    HEALTH_STATUS_CHOICES, RENTAL_STATUS_CHOICES, ROLES, SEMEN_RESULT_CHOICES,
    SEX_CHOICES, STEAK_GRADE_CHOICES, TRANSFER_TRIGGER_CHOICES,
)


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


# ---- Admin / configuration -------------------------------------------------

class PropertyForm(FlaskForm):
    name = StringField("Property Name", validators=[DataRequired(), Length(max=120)])
    submit = SubmitField("Save Property")


class LocationForm(FlaskForm):
    name = StringField("Location / Pasture Name", validators=[DataRequired(), Length(max=120)])
    property_id = SelectField("Property", coerce=int, validators=[DataRequired()])
    submit = SubmitField("Save Location")


class AnimalTypeForm(FlaskForm):
    name = StringField("Type Name", validators=[DataRequired(), Length(max=80)])
    sex = SelectField("Sex", choices=[(s, s.capitalize()) for s in SEX_CHOICES], validators=[DataRequired()])
    auto_transfer_trigger = SelectField("Automatic Transfer", choices=TRANSFER_TRIGGER_CHOICES, validators=[Optional()])
    auto_transfer_age_months = IntegerField("Transfer Age (months)", validators=[Optional(), NumberRange(min=1)])
    auto_transfer_to_type_id = SelectField("Transfers Into", coerce=int, validators=[Optional()])
    is_active = BooleanField("Active", default=True)
    submit = SubmitField("Save Type")


class CostRateForm(FlaskForm):
    animal_type_id = SelectField("Animal Type", coerce=int, validators=[DataRequired()])
    rate_per_day = DecimalField("Rate per Day ($)", validators=[DataRequired()], places=2)
    effective_date = DateField("Effective Date", validators=[DataRequired()])
    submit = SubmitField("Save Rate")


class SaleCategoryForm(FlaskForm):
    name = StringField("Category Name", validators=[DataRequired(), Length(max=80)])
    submit = SubmitField("Save Category")


# ---- Animals ----------------------------------------------------------------

class AnimalForm(FlaskForm):
    tag_id = StringField("Tag / ID Number", validators=[Optional(), Length(max=40)])
    name = StringField("Name", validators=[Optional(), Length(max=120)])
    animal_type_id = SelectField("Type", coerce=int, validators=[DataRequired()])
    breed = StringField("Breed", validators=[Optional(), Length(max=80)])
    birth_date = DateField("Birth Date", validators=[Optional()])
    birth_weight = DecimalField("Birth Weight (lbs)", validators=[Optional()], places=2)
    color = StringField("Color", validators=[Optional(), Length(max=60)])
    location_id = SelectField("Location", coerce=int, validators=[Optional()])
    birth_location_id = SelectField("Birth Location", coerce=int, validators=[Optional()])
    sire_id = SelectField("Sire (known/actual)", coerce=int, validators=[Optional()])
    dam_id = SelectField("Dam (known/actual)", coerce=int, validators=[Optional()])
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


class BulkVaccinationForm(FlaskForm):
    description = StringField("Vaccine / Description", validators=[DataRequired(), Length(max=255)])
    date_recorded = DateField("Date", validators=[DataRequired()])
    vet_name = StringField("Vet Name", validators=[Optional(), Length(max=120)])
    cost = DecimalField("Cost (per head)", validators=[Optional()], places=2)
    next_due_date = DateField("Next Due Date", validators=[Optional()])
    submit = SubmitField("Apply to Selected Animals")


class BulkLocationForm(FlaskForm):
    location_id = SelectField("New Location", coerce=int, validators=[DataRequired()])
    submit = SubmitField("Move Selected Animals")


class LastSeenCheckForm(FlaskForm):
    date_recorded = DateField("Date", validators=[DataRequired()])
    location_id = SelectField("Location Seen", coerce=int, validators=[Optional()])
    health_status = SelectField("Health Status", choices=[(s, s) for s in HEALTH_STATUS_CHOICES], validators=[DataRequired()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Log Check")


class DepartureForm(FlaskForm):
    departure_reason = SelectField("Reason", choices=DEPARTURE_CHOICES, validators=[DataRequired()])
    departure_date = DateField("Date", validators=[DataRequired()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Record Departure")


class CastrationForm(FlaskForm):
    castration_date = DateField("Castration Date", validators=[DataRequired()])
    castration_method = StringField("Method", validators=[Optional(), Length(max=80)])
    submit = SubmitField("Save Castration Record")


class ImportCSVForm(FlaskForm):
    csv_file = FileField("CSV File", validators=[DataRequired(), FileAllowed(["csv"])])
    submit = SubmitField("Import Animals")


# ---- Cows / Breeding ---------------------------------------------------------

class CalfBirthForm(FlaskForm):
    calving_date = DateField("Calving Date", validators=[DataRequired()])
    calf_sex = SelectField("Calf Sex", choices=[(s, s.capitalize()) for s in SEX_CHOICES], validators=[DataRequired()])
    birth_weight = DecimalField("Birth Weight (lbs)", validators=[Optional()], places=2)
    sire_id = SelectField("Sire (if known)", coerce=int, validators=[Optional()])
    breeding_group_id = SelectField("Breeding Group (if known)", coerce=int, validators=[Optional()])
    birth_location_id = SelectField("Birth Location", coerce=int, validators=[Optional()])
    animal_type_id = SelectField("Calf Type", coerce=int, validators=[DataRequired()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Record Calf")


class CalfOutcomeForm(FlaskForm):
    outcome = SelectField("Outcome", choices=CALF_OUTCOME_CHOICES, validators=[DataRequired()])
    cull_reason = StringField("Cull Reason", validators=[Optional(), Length(max=255)])
    weaned_date = DateField("Weaned Date", validators=[Optional()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Update Outcome")


class BreedingGroupForm(FlaskForm):
    location_id = SelectField("Location", coerce=int, validators=[DataRequired()])
    start_date = DateField("Bulls In (Start Date)", validators=[DataRequired()])
    end_date = DateField("Bulls Out (End Date)", validators=[Optional()])
    bull_ids = SelectMultipleField("Bull(s)", coerce=int, validators=[DataRequired()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Breeding Group")


class AddToBreedingGroupForm(FlaskForm):
    animal_ids = SelectMultipleField("Cows / Heifers to Expose", coerce=int, validators=[DataRequired()])
    submit = SubmitField("Add to Group")


class ConfirmBredForm(FlaskForm):
    confirmed_bred = SelectField(
        "Confirmed Bred?", choices=[("", "Unknown / Pending"), ("yes", "Yes"), ("no", "No")], validators=[Optional()]
    )
    confirmed_bred_date = DateField("Confirmation Date", validators=[Optional()])
    notes = StringField("Notes", validators=[Optional(), Length(max=255)])
    submit = SubmitField("Save")


# ---- Bulls --------------------------------------------------------------------

class BullEPDForm(FlaskForm):
    ced = DecimalField("CED (Calving Ease Direct)", validators=[Optional()], places=1)
    birth_weight_epd = DecimalField("Birth Weight EPD", validators=[Optional()], places=1)
    weaning_weight_epd = DecimalField("Weaning Weight EPD", validators=[Optional()], places=1)
    yearling_weight_epd = DecimalField("Yearling Weight EPD", validators=[Optional()], places=1)
    milk_epd = DecimalField("Milk EPD", validators=[Optional()], places=1)
    marbling_epd = DecimalField("Marbling EPD", validators=[Optional()], places=2)
    ribeye_area_epd = DecimalField("Ribeye Area EPD", validators=[Optional()], places=2)
    submit = SubmitField("Save EPDs")


class SemenTestForm(FlaskForm):
    test_date = DateField("Test Date", validators=[DataRequired()])
    result = SelectField("Result", choices=[(r, r) for r in SEMEN_RESULT_CHOICES], validators=[DataRequired()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Semen Test")


# ---- Rentals --------------------------------------------------------------------

class RentalCustomerForm(FlaskForm):
    name = StringField("Customer Name", validators=[DataRequired(), Length(max=120)])
    phone = StringField("Phone", validators=[Optional(), Length(max=40)])
    email = StringField("Email", validators=[Optional(), Email(), Length(max=255)])
    address = StringField("Address", validators=[Optional(), Length(max=255)])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Customer")


class RentalForm(FlaskForm):
    bull_id = SelectField("Bull", coerce=int, validators=[DataRequired()])
    customer_id = SelectField("Customer", coerce=int, validators=[DataRequired()])
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
    condition_score = SelectField(
        "Condition Score", choices=[("", "-- N/A --")] + [(c, c) for c in CONDITION_SCORE_CHOICES], validators=[Optional()]
    )
    condition_notes = TextAreaField("Condition Notes", validators=[Optional()])
    health_notes = TextAreaField("Health Notes", validators=[Optional()])
    date_recorded = DateField("Date", validators=[DataRequired()])
    submit = SubmitField("Log Check")


class RentalStatusForm(FlaskForm):
    status = SelectField("Status", choices=[(s, s.capitalize()) for s in RENTAL_STATUS_CHOICES])
    actual_return_date = DateField("Actual Return Date", validators=[Optional()])
    deposit_returned = BooleanField("Deposit Returned")
    submit = SubmitField("Update Rental")


# ---- Feedlot / Butcher ------------------------------------------------------------

class FeedoutForm(FlaskForm):
    start_date = DateField("Start Feeding Date", validators=[DataRequired()])
    start_weight = DecimalField("Starting Weight (lbs)", validators=[Optional()], places=2)
    days_on_feed = IntegerField("Days on Feed", validators=[Optional(), NumberRange(min=0)])
    end_date = DateField("Slaughter Date", validators=[Optional()])
    hanging_weight = DecimalField("Hanging Weight (lbs)", validators=[Optional()], places=2)
    dressed_yield_pct = DecimalField("Dressed Yield %", validators=[Optional()], places=2)
    steak_grade = SelectField("Steak Grade", choices=[("", "-- Not graded yet --")] + [(g, g) for g in STEAK_GRADE_CHOICES], validators=[Optional()])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Feedout Record")


# ---- Sales --------------------------------------------------------------------

class BuyerForm(FlaskForm):
    name = StringField("Name", validators=[DataRequired(), Length(max=120)])
    phone = StringField("Phone", validators=[Optional(), Length(max=40)])
    email = StringField("Email", validators=[Optional(), Email(), Length(max=255)])
    address = StringField("Address", validators=[Optional(), Length(max=255)])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Save Buyer")


class SaleForm(FlaskForm):
    sale_category_id = SelectField("Sale Category", coerce=int, validators=[DataRequired()])
    buyer_id = SelectField("Buyer", coerce=int, validators=[DataRequired()])
    sale_date = DateField("Sale Date", validators=[DataRequired()])
    payment_method = StringField("Payment Method", validators=[Optional(), Length(max=60)])
    notes = TextAreaField("Notes", validators=[Optional()])
    submit = SubmitField("Continue")
