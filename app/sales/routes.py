from datetime import date

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from app import db
from app.decorators import owner_required
from app.forms import BuyerForm, SaleForm
from app.models import Animal, Buyer, Sale, STATUS_SOLD

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
    sellable = Animal.query.filter(Animal.status != STATUS_SOLD).order_by(Animal.tag_id).all()
    form.animal_id.choices = [(a.id, f"{a.tag_id} ({a.sex}, {a.status})") for a in sellable]
    form.buyer_id.choices = [(b.id, b.name) for b in Buyer.query.order_by(Buyer.name).all()]

    if request.method == "GET":
        preselect = request.args.get("animal_id", type=int)
        if preselect:
            form.animal_id.data = preselect
        form.sale_date.data = date.today()

    if not form.buyer_id.choices:
        flash("Add a buyer before recording a sale.", "warning")

    if form.validate_on_submit():
        animal = Animal.query.get(form.animal_id.data)
        if animal.status == STATUS_SOLD:
            flash("That animal has already been sold.", "danger")
        else:
            sale = Sale(
                animal_id=form.animal_id.data,
                buyer_id=form.buyer_id.data,
                sale_price=form.sale_price.data,
                sale_date=form.sale_date.data,
                payment_method=form.payment_method.data,
                notes=form.notes.data,
                created_by_id=current_user.id,
            )
            db.session.add(sale)
            animal.status = STATUS_SOLD
            db.session.commit()
            sale.invoice_number = f"INV-{sale.id:05d}"
            db.session.commit()
            flash("Sale recorded.", "success")
            return redirect(url_for("sales.view_sale", sale_id=sale.id))

    return render_template("sales/form.html", form=form, title="Record Sale")


@sales_bp.route("/<int:sale_id>")
@login_required
@owner_required
def view_sale(sale_id):
    sale = Sale.query.get_or_404(sale_id)
    return render_template("sales/detail.html", sale=sale)


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
        next_sale = request.args.get("next_sale")
        if next_sale:
            return redirect(url_for("sales.new_sale", animal_id=next_sale))
        return redirect(url_for("sales.list_buyers"))

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
