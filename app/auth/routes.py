from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user

from app import db
from app.decorators import owner_required
from app.forms import LoginForm, UserForm
from app.models import User

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.dashboard"))

    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data.lower().strip()).first()
        if user and user.is_active_user and user.check_password(form.password.data):
            login_user(user)
            next_page = request.args.get("next")
            return redirect(next_page or url_for("main.dashboard"))
        flash("Invalid email or password.", "danger")

    return render_template("auth/login.html", form=form)


@auth_bp.route("/logout")
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "info")
    return redirect(url_for("auth.login"))


@auth_bp.route("/users")
@login_required
@owner_required
def users():
    all_users = User.query.order_by(User.name).all()
    return render_template("auth/users.html", users=all_users)


@auth_bp.route("/users/new", methods=["GET", "POST"])
@login_required
@owner_required
def new_user():
    form = UserForm()
    if form.validate_on_submit():
        if not form.password.data:
            flash("Password is required for a new user.", "danger")
        elif User.query.filter_by(email=form.email.data.lower().strip()).first():
            flash("A user with that email already exists.", "danger")
        else:
            user = User(
                name=form.name.data,
                email=form.email.data.lower().strip(),
                role=form.role.data,
                is_active_user=form.is_active_user.data,
            )
            user.set_password(form.password.data)
            db.session.add(user)
            db.session.commit()
            flash(f"User {user.name} created.", "success")
            return redirect(url_for("auth.users"))
    elif request.method == "POST":
        flash("Could not save the user - check the errors below.", "danger")

    return render_template("auth/user_form.html", form=form, title="New User")


@auth_bp.route("/users/<int:user_id>/edit", methods=["GET", "POST"])
@login_required
@owner_required
def edit_user(user_id):
    user = User.query.get_or_404(user_id)
    form = UserForm(obj=user)
    if request.method == "GET":
        form.name.data = user.name
        form.email.data = user.email
        form.role.data = user.role
        form.is_active_user.data = user.is_active_user
        form.password.data = ""

    if form.validate_on_submit():
        existing = User.query.filter_by(email=form.email.data.lower().strip()).first()
        if existing and existing.id != user.id:
            flash("A user with that email already exists.", "danger")
        else:
            user.name = form.name.data
            user.email = form.email.data.lower().strip()
            user.role = form.role.data
            user.is_active_user = form.is_active_user.data
            if form.password.data:
                user.set_password(form.password.data)
            db.session.commit()
            flash(f"User {user.name} updated.", "success")
            return redirect(url_for("auth.users"))
    elif request.method == "POST":
        flash("Could not save the user - check the errors below.", "danger")

    return render_template("auth/user_form.html", form=form, title=f"Edit {user.name}")
