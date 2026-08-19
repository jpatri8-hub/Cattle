"""Additive-only schema sync for a live database with no migration history.

On every app startup this creates any brand-new tables (via db.create_all(),
which only ever creates tables that don't already exist - it never touches
an existing table) and adds any model columns missing from the actual
database tables (plain ADD COLUMN, only ever nullable columns). It never
drops or alters an existing column, so it's safe to run against live
production data on every deploy without a separate manual migration step.
"""
from sqlalchemy import inspect, text


def sync_schema(app, db):
    db.create_all()

    inspector = inspect(db.engine)
    existing_tables = set(inspector.get_table_names())

    with db.engine.begin() as conn:
        for table in db.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # brand new tables were just handled by create_all() above
            existing_columns = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                if not column.nullable:
                    app.logger.warning(
                        "schema sync: skipping non-nullable new column %s.%s - "
                        "add it manually with a default/backfill.",
                        table.name, column.name,
                    )
                    continue
                col_type = column.type.compile(dialect=db.engine.dialect)
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'
                try:
                    conn.execute(text(ddl))
                    app.logger.info("schema sync: added column %s.%s", table.name, column.name)
                except Exception as exc:
                    app.logger.warning("schema sync: could not add %s.%s: %s", table.name, column.name, exc)
