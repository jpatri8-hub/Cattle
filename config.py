import os

from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, ".env"))


def _normalize_db_url(url):
    # Render (like Heroku) hands out "postgres://" but SQLAlchemy 2.x requires "postgresql://"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    # Force the psycopg2 driver explicitly (that's what's in requirements.txt) -
    # newer SQLAlchemy releases can default a bare "postgresql://" URL to the
    # psycopg (v3) driver instead, which isn't installed and would make the
    # app fail to start.
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")
    SQLALCHEMY_DATABASE_URI = _normalize_db_url(
        os.environ.get("DATABASE_URL", f"sqlite:///{os.path.join(basedir, 'instance', 'cattle.db')}")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
