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


@sales_bp.route("/")
@login_required
@owner_required
def list_sales():
    sales = Sale.query.order_by(Sale.sale_date.desc()).all()
    return render_template("sales/list.html", sales=sales)


@sales_bp.route("/new", methods=["GET", "POST"])
@login_required
@owner_required
def new_sale():
    form = SaleForm()
    form.sale_category_id.choices = [(c.id, c.name) for c in SaleCategory.query.filter_by(is_active=True).order_by(SaleCategory.name).all()]
    form.buyer_id.choices = [(b.id, b.name) for b in Buyer.query.order_by(Buyer.name).all()]

    if not form.buyer_id.choices:
        flash("Add a buyer before recording a sale.", "warning")
    if not form.sale_category_id.choices:
        flash("Add a sale category before recording a sale.", "warning")

    sellable = Animal.query.filter_by(is_active=True).order_by(Animal.tag_id).all()

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
                bad_rows = []
                lines = []
                for a in animals:
                    price_raw = request.form.get(f"price_{a.id}", "").strip()
                    weight_raw = request.form.get(f"weight_{a.id}", "").strip()
                    if not price_raw:
                        bad_rows.append(a.display_id)
                        continue
                    try:
                        price = float(price_raw)
                    except ValueError:
                        bad_rows.append(a.display_id)
                        continue
                    weight = float(weight_raw) if weight_raw else None
                    lines.append((a, price, weight))

                if bad_rows:
                    flash(f"Enter a valid price for: {', '.join(bad_rows)}", "danger")
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

    return render_template("sales/form.html", form=form, animals=sellable, preselected=preselected)


@sales_bp.route("/<int:sale_id>")
@login_required
@owner_required
def view_sale(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    return render_template("sales/detail.html", sale=sale, averages=sale.averages_by_sex())


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
        return redirect(url_for("sales.list_buyers"))
    return render_template("sales/buyer_form.html", form=form, title=f"Edit {buyer.name}")
