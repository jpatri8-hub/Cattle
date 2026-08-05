"""Create the first Owner account. Run once after setting up the database."""
import getpass

from app import create_app, db
from app.models import ROLE_OWNER, User


def main():
    app = create_app()
    with app.app_context():
        db.create_all()

        if User.query.filter_by(role=ROLE_OWNER).first():
            print("An owner account already exists. Nothing to do.")
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
