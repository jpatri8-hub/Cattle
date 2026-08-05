# Cattle Manager

A simple, self-hosted web app for tracking a cattle herd, renting out bulls, and
recording sales of bulls and cows.

## Features

- **Herd inventory** — tag/ID, breed, sex, birth date, color, location, photo,
  status (available / rented / sold / deceased).
- **Health records** — vaccinations, treatments, illnesses, vet visits, with
  next-due-date tracking (surfaced on the dashboard).
- **Breeding & genetics** — sire/dam lineage per animal, breeding records with
  expected/actual calving dates, registration number + papers upload.
- **Weight history** per animal, logged manually or automatically when a
  rental pickup/return check records a weight.
- **Bull rentals** — availability-aware booking (blocks overlapping bookings
  for the same bull), a monthly calendar view, renter contact info, rate/
  deposit terms, and pickup/return condition + health checks that
  automatically flip the bull's and rental's status.
- **Sales** — buyer records, sale price/date/payment method, and a printable
  invoice/receipt page.
- **Roles** — **Owner** has full access including sales, financials, and user
  management. **Hand** can manage animals, health/weight/breeding records, and
  rental checks, but cannot see purchase/sale prices, rental rates, or access
  Sales/Buyers/Users.

## Tech stack

Python 3 + Flask, SQLAlchemy (SQLite by default, swap in Postgres via
`DATABASE_URL` for production), Flask-Login for auth, server-rendered
Jinja2/Bootstrap templates — no separate frontend build step.

## Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create the database and your first Owner login
python3 seed.py

# Run the dev server
python3 run.py
```

Visit `http://127.0.0.1:5000` and log in with the account you just created.

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

## Adding staff (Hand) accounts

Log in as an Owner, go to **Users → New User**, and pick the "hand" role.
Hands can update animal records, health/weight logs, and rental pickup/return
checks, but everything under Sales, Buyers, and Users stays Owner-only.

## Project layout

```
app/
  models.py          # Animal, User, WeightRecord, HealthRecord, BreedingRecord,
                      # Rental, RentalCheck, Buyer, Sale
  auth/               # login/logout, user management
  animals/            # herd CRUD, weight/health/breeding records
  rentals/            # availability calendar, booking, pickup/return checks
  sales/              # buyers, sale records, printable invoice
  main/               # dashboard
  templates/, static/
config.py             # env-driven configuration
run.py                # local dev entrypoint
wsgi.py               # production entrypoint (gunicorn)
seed.py               # creates the first Owner account
```
