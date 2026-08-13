from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required

from app import db
from app.decorators import owner_required
from app.forms import BuyerForm, SaleForm
from app.models import (
    Animal, Buyer, DEPARTURE_SOLD, Sale, SaleCategory, SaleLine,
)

sales_bp = Blueprint("sales", __name__, url_prefix="/sales")

TRUCKLOAD_CATEGORY_NAME = "truckload calf sale"


@sales_bp.route("/")
@login_required
@owner_required
def list_sales():
    sales = Sale.query.order_by(Sale.sale_date.desc()).all()
    return render_template("sales/list.html", sales=sales)


def _parse_sale_lines(animals, is_truckload):
    """Returns (lines, error_message). lines is a list of (animal, price, weight)."""
    lines = []
    errors = []

    if is_truckload:
        selected_by_type = {}
        for a in animals:
            selected_by_type.setdefault(a.animal_type_id, []).append(a)
        for type_id, type_animals in selected_by_type.items():
            type_name = type_animals[0].animal_type.name if type_animals[0].animal_type else f"type #{type_id}"
            total_price_raw = request.form.get(f"total_price_{type_id}", "").strip()
            total_weight_raw = request.form.get(f"total_weight_{type_id}", "").strip()
            count = len(type_animals)
            try:
                total_price = float(total_price_raw)
            except ValueError:
                errors.append(type_name)
                continue
            price_each = round(total_price / count, 2)
            weight_each = None
            if total_weight_raw:
                try:
                    weight_each = round(float(total_weight_raw) / count, 2)
                except ValueError:
                    weight_each = None
            for a in type_animals:
                lines.append((a, price_each, weight_each))
        error_msg = f"Enter a total sale price for: {', '.join(errors)}" if errors else None
    else:
        for a in animals:
            price_raw = request.form.get(f"price_{a.id}", "").strip()
            weight_raw = request.form.get(f"weight_{a.id}", "").strip()
            try:
                price = float(price_raw)
            except ValueError:
                errors.append(a.display_id)
                continue
            weight = float(weight_raw) if weight_raw else None
            lines.append((a, price, weight))
        error_msg = f"Enter a valid price for: {', '.join(errors)}" if errors else None

    return lines, error_msg


@sales_bp.route("/new", methods=["GET", "POST"])
@login_required
@owner_required
def new_sale():
    form = SaleForm()
    categories = SaleCategory.query.filter_by(is_active=True).order_by(SaleCategory.name).all()
    form.sale_category_id.choices = [(c.id, c.name) for c in categories]
    form.buyer_id.choices = [(b.id, b.name) for b in Buyer.query.order_by(Buyer.name).all()]
    truckload_category = next((c for c in categories if c.name.strip().lower() == TRUCKLOAD_CATEGORY_NAME), None)

    if not form.buyer_id.choices:
        flash("Add a buyer before recording a sale.", "warning")
    if not form.sale_category_id.choices:
        flash("Add a sale category before recording a sale.", "warning")

    sellable = Animal.query.filter_by(is_active=True).order_by(Animal.tag_id).all()
    animals_data = [
        {
            "id": a.id,
            "display_id": a.display_id,
            "name": a.name or "",
            "type_id": a.animal_type_id or 0,
            "type_name": a.animal_type.name if a.animal_type else "Unknown type",
            "location": a.location.display_name if a.location else "-",
            "current_weight": float(a.current_weight) if a.current_weight else None,
        }
        for a in sellable
    ]

    if request.method == "GET":
        form.sale_date.data = date.today()
        preselect_ids = session.pop("bulk_sale_ids", None)
        single = request.args.get("animal_id", type=int)
        if single:
            preselect_ids = [single]
        preselected = set(preselect_ids or [])
    else:
        preselected = set()

    if form.validate_on_submit():
        animal_ids = request.form.getlist("animal_ids", type=int)
        if not animal_ids:
            flash("Select at least one animal to sell.", "danger")
        else:
            animals = Animal.query.filter(Animal.id.in_(animal_ids), Animal.is_active == True).all()  # noqa: E712
            if len(animals) != len(animal_ids):
                flash("One or more selected animals are no longer available to sell.", "danger")
            else:
                is_truckload = bool(truckload_category) and form.sale_category_id.data == truckload_category.id
                lines, error_msg = _parse_sale_lines(animals, is_truckload)

                if error_msg:
                    flash(error_msg, "danger")
                else:
                    sale = Sale(
                        sale_category_id=form.sale_category_id.data,
                        buyer_id=form.buyer_id.data,
                        sale_date=form.sale_date.data,
                        payment_method=form.payment_method.data,
                        notes=form.notes.data,
                        created_by_id=current_user.id,
                    )
                    db.session.add(sale)
                    db.session.flush()
                    for a, price, weight in lines:
                        db.session.add(SaleLine(sale_id=sale.id, animal_id=a.id, price=price, weight=weight))
                        a.is_active = False
                        a.departure_reason = DEPARTURE_SOLD
                        a.departure_date = form.sale_date.data
                    sale.invoice_number = f"INV-{sale.id:05d}"
                    db.session.commit()
                    flash(f"Sale recorded with {len(lines)} animal(s).", "success")
                    return redirect(url_for("sales.view_sale", sale_id=sale.id))

    return render_template(
        "sales/form.html", form=form, animals_data=animals_data, preselected=preselected,
        truckload_category_id=truckload_category.id if truckload_category else None,
    )


@sales_bp.route("/<int:sale_id>")
@login_required
@owner_required
def view_sale(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    return render_template("sales/detail.html", sale=sale, averages=sale.averages_by_sex())


@sales_bp.route("/<int:sale_id>/edit", methods=["GET", "POST"])
@login_required
@owner_required
def edit_sale(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    form = SaleForm(obj=sale)
    form.sale_category_id.choices = [(c.id, c.name) for c in SaleCategory.query.order_by(SaleCategory.name).all()]
    form.buyer_id.choices = [(b.id, b.name) for b in Buyer.query.order_by(Buyer.name).all()]

    if request.method == "GET":
        form.sale_category_id.data = sale.sale_category_id
        form.buyer_id.data = sale.buyer_id

    if form.validate_on_submit():
        bad_rows = []
        line_updates = []
        for line in sale.lines:
            price_raw = request.form.get(f"price_{line.id}", "").strip()
            weight_raw = request.form.get(f"weight_{line.id}", "").strip()
            try:
                price = float(price_raw)
            except ValueError:
                bad_rows.append(line.animal.display_id)
                continue
            weight = float(weight_raw) if weight_raw else None
            line_updates.append((line, price, weight))

        if bad_rows:
            flash(f"Enter a valid price for: {', '.join(bad_rows)}", "danger")
        else:
            sale.sale_category_id = form.sale_category_id.data
            sale.buyer_id = form.buyer_id.data
            sale.sale_date = form.sale_date.data
            sale.payment_method = form.payment_method.data
            sale.notes = form.notes.data
            for line, price, weight in line_updates:
                line.price = price
                line.weight = weight
                line.animal.departure_date = form.sale_date.data
            db.session.commit()
            flash("Sale updated.", "success")
            return redirect(url_for("sales.view_sale", sale_id=sale.id))

    return render_template("sales/edit_form.html", form=form, sale=sale)


@sales_bp.route("/<int:sale_id>/delete", methods=["POST"])
@login_required
@owner_required
def delete_sale(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    for line in sale.lines:
        animal = line.animal
        if animal:
            animal.is_active = True
            animal.departure_reason = None
            animal.departure_date = None
    db.session.delete(sale)
    db.session.commit()
    flash("Sale deleted and its animals returned to the active herd.", "info")
    return redirect(url_for("sales.list_sales"))


@sales_bp.route("/<int:sale_id>/invoice")
@login_required
@owner_required
def invoice(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    return render_template("sales/invoice.html", sale=sale)


@sales_bp.route("/buyers")
@login_required
@owner_required
def list_buyers():
    buyers = Buyer.query.order_by(Buyer.name).all()
    return render_template("sales/buyers.html", buyers=buyers)


@sales_bp.route("/buyers/<int:buyer_id>")
@login_required
@owner_required
def view_buyer(buyer_id):
    buyer = Buyer.query.get_or_404(buyer_id)
    return render_template("sales/buyer_detail.html", buyer=buyer)


@sales_bp.route("/buyers/new", methods=["GET", "POST"])
@login_required
@owner_required
def new_buyer():
    form = BuyerForm()
    if form.validate_on_submit():
        buyer = Buyer(
            name=form.name.data,
            phone=form.phone.data,
            email=form.email.data,
            address=form.address.data,
            notes=form.notes.data,
        )
        db.session.add(buyer)
        db.session.commit()
        flash(f"Buyer {buyer.name} added.", "success")
        if request.args.get("next") == "rental":
            return redirect(url_for("rentals.new_rental"))
        return redirect(url_for("sales.new_sale"))

    return render_template("sales/buyer_form.html", form=form, title="New Buyer")


@sales_bp.route("/buyers/<int:buyer_id>/edit", methods=["GET", "POST"])
@login_required
@owner_required
def edit_buyer(buyer_id):
    buyer = Buyer.query.get_or_404(buyer_id)
    form = BuyerForm(obj=buyer)
    if form.validate_on_submit():
        buyer.name = form.name.data
        buyer.phone = form.phone.data
        buyer.email = form.email.data
        buyer.address = form.address.data
        buyer.notes = form.notes.data
        db.session.commit()
        flash(f"Buyer {buyer.name} updated.", "success")
        return redirect(url_for("sales.view_buyer", buyer_id=buyer.id))
    return render_template("sales/buyer_form.html", form=form, title=f"Edit {buyer.name}")
