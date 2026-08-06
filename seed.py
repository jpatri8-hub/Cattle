"""Set up a fresh database: creates the first Owner account and seeds sensible
defaults (animal types with lifecycle transfers, a starter property/location,
and sale categories) so the app is usable immediately. Safe to re-run - it
skips anything that already exists.
"""
import getpass

from app import create_app, db
from app.models import (
    AnimalType, Location, Property, ROLE_OWNER, SEX_FEMALE, SEX_MALE,
    SaleCategory, TRANSFER_TRIGGER_AGE, TRANSFER_TRIGGER_WEANED, User,
)

DEFAULT_TYPES = [
    # name, sex, transfer_trigger, transfer_age_months, transfers_to_name
    ("Registered Angus Cow", SEX_FEMALE, None, None, None),
    ("Registered Angus Bull", SEX_MALE, None, None, None),
    ("Registered Angus Heifer", SEX_FEMALE, TRANSFER_TRIGGER_WEANED, None, "Registered Angus Cow"),
    ("Registered Angus Bull Calf", SEX_MALE, TRANSFER_TRIGGER_AGE, 12, "Registered Angus Bull"),
    ("Commercial Cow", SEX_FEMALE, None, None, None),
    ("Commercial Bull", SEX_MALE, None, None, None),
    ("Commercial Heifer", SEX_FEMALE, TRANSFER_TRIGGER_WEANED, None, "Commercial Cow"),
    ("Commercial Bull Calf", SEX_MALE, TRANSFER_TRIGGER_AGE, 12, "Commercial Bull"),
    ("Commercial Heifer Calf", SEX_FEMALE, None, None, None),
    ("Steer", SEX_MALE, None, None, None),
]

DEFAULT_SALE_CATEGORIES = [
    "Bull Sale", "Cull Bull Sale", "Scrap Bull Sale", "Truckload Calf Sale", "Cull Cow Sale",
]


def seed_defaults():
    if not AnimalType.query.first():
        created = {}
        for name, sex, trigger, months, _ in DEFAULT_TYPES:
            t = AnimalType(name=name, sex=sex, auto_transfer_trigger=trigger, auto_transfer_age_months=months)
            db.session.add(t)
            created[name] = t
        db.session.flush()
        for name, *_rest, transfers_to_name in DEFAULT_TYPES:
            if transfers_to_name:
                created[name].auto_transfer_to_type_id = created[transfers_to_name].id
        db.session.commit()
        print(f"Seeded {len(DEFAULT_TYPES)} animal types.")

    if not Property.query.first():
        prop = Property(name="Home Ranch")
        db.session.add(prop)
        db.session.flush()
        db.session.add(Location(name="Home Pen", property_id=prop.id))
        db.session.commit()
        print("Seeded a starter property ('Home Ranch') and location ('Home Pen') - rename or add more under Admin.")

    if not SaleCategory.query.first():
        for name in DEFAULT_SALE_CATEGORIES:
            db.session.add(SaleCategory(name=name))
        db.session.commit()
        print(f"Seeded {len(DEFAULT_SALE_CATEGORIES)} sale categories.")


def main():
    app = create_app()
    with app.app_context():
        db.create_all()
        seed_defaults()

        if User.query.filter_by(role=ROLE_OWNER).first():
            print("An owner account already exists. Nothing more to do.")
            return

        print("Create the first Owner account for your ranch:")
        name = input("Name: ").strip()
        email = input("Email: ").strip().lower()
        password = getpass.getpass("Password: ")

        user = User(name=name, email=email, role=ROLE_OWNER)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        print(f"Owner account '{email}' created.")


if __name__ == "__main__":
    main()
