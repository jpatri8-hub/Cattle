# Cattle Manager — Patrick's Cattle Ranch

A web-based, mobile-friendly herd management system for a working cattle ranch:
inventory tracking, bull rentals, sales, breeding/inbreeding awareness, feedlot
grading, and cost/revenue reporting. Built to run comfortably on an iPhone
browser as well as a desktop.

## Feature summary

- **Herd inventory** — every animal has an editable **type** (e.g. "Registered
  Angus Cow", "Commercial Bull Calf") that drives its sex, and types can be
  configured to **automatically transfer** into another type — e.g. a bull
  calf becomes a bull at 12 months, or a heifer becomes a cow once her first
  calf is weaned. View the herd by location or by type, current-on-farm vs.
  archived (sold/deceased/culled/lost) animals are kept separate.
- **Bulk operations** — select multiple animals from the herd list to move
  them to a new location, log a vaccination across all of them at once, or
  send them into a bulk/truckload sale.
- **Inventory checks** — log who saw an animal, where, its health status, and
  when. Vaccination records also count as "seen." Any active animal not seen
  in 4+ months is flagged on the dashboard and in the herd list.
- **Cows** — record a new calf (birth date, weight, temp ID — tag comes
  later) directly from the dam's page; track each calf's outcome (lost,
  died after birth, culled + reason, retained, sold-not-cull); see at a
  glance which cows currently have a calf at side.
- **Breeding groups** — record which bull(s) ran with which cows/heifers at a
  location over a date range (supports multiple bulls per group), track
  confirmed-bred status, and every calf born gets a record of candidate
  sires (bulls present at her birth location during the likely conception
  window) so the app can flag inbreeding risk before you rebreed her.
- **Bulls** — manual EPD entry (CED, birth weight, and more) shown in list
  view; availability automatically reflects being out on rent, committed to
  a future rental, a 15-day hold after return, or a bad/retest semen result;
  condition score (Good/Slim/Poor) recorded on return; rental history shown
  at both the bull and the customer level.
- **Rentals** — availability-aware booking calendar, rental customers with
  full history, pickup/return checks with weight and condition score.
- **Steers** — castration date and method.
- **Feedlot / butcher calves** — starting age/weight, days on feed, hanging
  weight, dressed yield, steak grade; average grade and average daily gain
  rolled up by sire and by dam so you can see which bloodlines finish best.
- **Sales** — editable sale categories (Bull Sale, Cull Bull Sale, Scrap Bull
  Sale, Truckload Calf Sale, Cull Cow Sale, or your own), single or bulk
  sales in one form, with average price/weight broken out by steer vs.
  heifer for truckload sales, plus a printable invoice.
- **Cost & revenue** — $/day cost rate per animal type, with a rate history
  so past cost reports stay accurate even after rates change; a calf's cost
  also includes 12 months of her dam's daily rate; bulls show lifetime
  revenue (rentals + sales).
- **Reports** — weaning rate & average weaning weight, pregnancy/conception
  rate, death loss rate, net margin by animal type, bull lifetime revenue,
  and feedlot grade/efficiency by sire & dam. See "Suggested metrics" below.
- **Roles** — **Owner** has full access including sales, financials
  (cost/revenue reports), and user/admin management. **Hand** can manage
  animals, health/weight/breeding/inventory-check records, and rental
  pickup/return checks, but cannot see Sales, Reports, Buyers, or Admin.
- **Everything is configurable** — animal types (and their transfer rules),
  properties/locations, sale categories, and cost rates are all editable
  under **Admin** without touching code, so the system can be refined as the
  operation changes.

### Suggested metrics included (beyond the original spec)

Weaning rate & average weaning weight, pregnancy/conception rate per season,
death loss rate, bull rental utilization is visible via availability status,
and net margin by animal type. Add more anytime — see "Extending the
system" below.

## Tech stack

Python 3 + Flask, SQLAlchemy (SQLite by default, swap in Postgres via
`DATABASE_URL` for production), Flask-Login for auth, server-rendered
Jinja2/Bootstrap 5 templates (responsive, touch-friendly for phones) — no
separate frontend build step.

## Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create the database, seed default types/locations/sale categories, and
# create your first Owner login
python3 seed.py

# Run the dev server
python3 run.py
```

Visit `http://127.0.0.1:5000` and log in with the account you just created.
`seed.py` is safe to re-run — it skips anything that already exists.

## Configuration

Set these environment variables (a `.env` file is loaded automatically):

| Variable       | Default                          | Notes                                   |
|----------------|-----------------------------------|------------------------------------------|
| `SECRET_KEY`   | `dev-secret-key-change-me`        | Set a real random value in production.  |
| `DATABASE_URL` | `sqlite:///instance/cattle.db`    | e.g. `postgresql://user:pass@host/db`   |

## Deploying online

This app ships with a `Procfile` (`web: gunicorn wsgi:app`) so it runs as-is on
Render, Railway, Fly.io, or similar platforms:

1. Push this repo to the host of your choice.
2. Set `SECRET_KEY` and (recommended for production) `DATABASE_URL` pointing
   at a managed Postgres database — SQLite works but doesn't survive well on
   platforms with ephemeral filesystems.
3. Run `python3 seed.py` once (via a one-off shell/console on the platform) to
   create your first Owner account, or add a user directly via SQL.
4. Make sure the `app/static/uploads` folder is on persistent storage, or
   point `UPLOAD_FOLDER` at a mounted volume / object storage path, so animal
   photos and registration papers survive restarts.

Because it's just a mobile-responsive website (no app store install), open
the deployed URL on an iPhone and use "Add to Home Screen" from Safari's
share sheet for a one-tap icon.

## Getting your ranch set up

1. Log in as Owner, go to **Admin**.
2. **Properties & Locations** — add your property/properties and their
   pastures/pens/lots.
3. **Animal Types** — the starter set (Registered Angus Cow/Bull/Heifer/Bull
   Calf, Commercial Cow/Bull/Heifer/Bull Calf/Heifer Calf, Steer) is seeded
   with the auto-transfer rules from the original spec; edit ages, rename
   types, or add new ones (e.g. "Registered Angus Heifer Calf") to match
   how you actually run cattle.
4. **Cost Rates** — set a $/day rate per animal type so cost reports have
   something to work with.
5. **Sale Categories** — the starter set (Bull Sale, Cull Bull Sale, Scrap
   Bull Sale, Truckload Calf Sale, Cull Cow Sale) is seeded; add your own.
6. **Import your current herd** — from Admin, use "Import Animals (CSV)" to
   bulk-load your ~300–450 head. Columns: `tag_id`, `animal_type` (must
   match a type name from step 3 exactly), `name`, `breed`, `birth_date`
   (YYYY-MM-DD), `color`, `location` (must match a location from step 2),
   `registration_number`, `notes`.
7. **Add staff (Hand) accounts** — Admin → Users → New User, role "hand".

## Adding staff (Hand) accounts

Log in as an Owner, go to **Admin → Users → New User**, and pick the "hand"
role. Hands can update animal records, health/weight/breeding/inventory-check
records, and rental pickup/return checks, but everything under Sales,
Reports, Buyers, and Admin stays Owner-only.

## Extending the system

This is meant to keep evolving with the operation — nothing here is final:

- **New animal types or transfer rules**: Admin → Animal Types. No code
  changes needed.
- **New locations/properties, sale categories, cost rates**: same idea,
  all under Admin.
- **New metrics or reports**: calculation logic lives in `app/metrics.py`
  (pure functions, easy to add to) and is rendered from
  `app/reports/routes.py` + `app/templates/reports/`.
- **Lifecycle rules** (auto-transfer, "not seen" flagging, rental
  availability, semen-test-due alerts) live in `app/lifecycle.py`.
- **Data model**: `app/models.py`. The app runs `db.create_all()` via
  `seed.py`; for schema changes after you have real data, use
  `flask db migrate` / `flask db upgrade` (Flask-Migrate is already wired
  up in `app/__init__.py`).

## Project layout

```
app/
  models.py           # Full data model: Animal, AnimalType, Location/Property,
                       # BreedingGroup/ExposureRecord, CalfRecord, BullEPD,
                       # SemenTest, Rental (customer = Buyer), FeedoutRecord,
                       # Sale/SaleLine/SaleCategory, AnimalTypeCostRate, etc.
  lifecycle.py         # Auto type-transfers, inbreeding warnings, candidate
                       # sires, rental availability & "not seen" alerts
  metrics.py           # Cost/revenue and herd performance calculations
  auth/                # login/logout, user management
  animals/             # herd CRUD, weight/health/inventory checks, bulk ops,
                       # CSV import, cows/calves, breeding groups, bulls
                       # (EPD/semen), steers (castration), feedlot/butcher
  rentals/             # availability calendar, booking, customers, checks
  sales/               # buyers, sale categories, single/bulk sales, invoice
  admin/                # types, properties, locations, sale categories,
                       # cost rates (all Owner-editable, no code changes)
  reports/              # weaning/pregnancy/death-loss rate, net margin,
                       # bull lifetime revenue, feedlot grade/ADG rollups
  main/                 # dashboard with alerts
  templates/, static/
config.py               # env-driven configuration
run.py                  # local dev entrypoint
wsgi.py                 # production entrypoint (gunicorn)
seed.py                 # creates the first Owner account + default data
```
