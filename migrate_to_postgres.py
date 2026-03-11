"""One-time migration script: SQLite -> PostgreSQL.

Usage:
    python migrate_to_postgres.py [sqlite_path]
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parent
APP_DIR = ROOT_DIR / "app"
DEFAULT_SQLITE_PATH = ROOT_DIR / "app" / "reddit_accounts.db"
DATETIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
)


def normalize_database_url(database_url: str | None) -> str | None:
    if database_url and database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql://", 1)
    return database_url


def resolve_sqlite_path(argv: list[str]) -> Path:
    if len(argv) > 1:
        candidate = Path(argv[1])
        if not candidate.is_absolute():
            candidate = ROOT_DIR / candidate
        return candidate.resolve()
    return DEFAULT_SQLITE_PATH.resolve()


def parse_datetime(value: Any) -> Any:
    if value is None or isinstance(value, datetime):
        return value

    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value)
        except (OverflowError, OSError, ValueError):
            return value

    if not isinstance(value, str):
        return value

    cleaned = value.strip()
    if not cleaned:
        return None

    try:
        return datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    except ValueError:
        pass

    for fmt in DATETIME_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue

    return value


def parse_boolean(value: Any) -> Any:
    if value is None or isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return bool(value)

    if isinstance(value, str):
        cleaned = value.strip().lower()
        if cleaned in {"1", "true", "t", "yes", "y", "on"}:
            return True
        if cleaned in {"0", "false", "f", "no", "n", "off"}:
            return False

    return value


def coerce_value(value: Any, column: sa.Column[Any]) -> Any:
    if value is None:
        return None

    if isinstance(column.type, sa.Boolean):
        return parse_boolean(value)

    if isinstance(column.type, sa.DateTime):
        return parse_datetime(value)

    if isinstance(column.type, sa.Integer) and not isinstance(value, bool):
        try:
            return int(value)
        except (TypeError, ValueError):
            return value

    if isinstance(value, bytes):
        return value.decode("utf-8")

    return value


def get_sqlite_table_names(sqlite_conn: sqlite3.Connection) -> set[str]:
    rows = sqlite_conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(row[0]) for row in rows}


def get_sqlite_column_names(sqlite_conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = sqlite_conn.execute(f'PRAGMA table_info("{table_name}")').fetchall()
    return {str(row[1]) for row in rows}


def truncate_target_tables(table_names: list[str], session: Any) -> None:
    if not table_names:
        return

    quoted_names = ", ".join(f'"{table_name}"' for table_name in table_names)
    session.execute(sa.text(f"TRUNCATE TABLE {quoted_names} RESTART IDENTITY CASCADE"))
    session.commit()


def reset_sequence(table_name: str, session: Any) -> None:
    session.execute(
        sa.text(
            f"""
            SELECT setval(
                pg_get_serial_sequence('{table_name}', 'id'),
                COALESCE((SELECT MAX(id) FROM \"{table_name}\"), 0) + 1,
                false
            )
            """
        )
    )


def migrate_table(
    sqlite_conn: sqlite3.Connection,
    table: sa.Table,
    session: Any,
) -> None:
    table_name = table.name
    source_columns = get_sqlite_column_names(sqlite_conn, table_name)
    target_columns = {column.name: column for column in table.columns}
    shared_columns = [name for name in target_columns if name in source_columns]

    row_count = sqlite_conn.execute(
        f'SELECT COUNT(*) FROM "{table_name}"'
    ).fetchone()[0]
    print(f"Migrating {table_name} ({row_count} rows)...")

    if row_count == 0:
        print(f"  {table_name}: no rows to migrate")
        return

    ignored_columns = sorted(source_columns - set(shared_columns))
    if ignored_columns:
        print(f"  {table_name}: skipping unmapped columns {ignored_columns}")

    rows = sqlite_conn.execute(f'SELECT * FROM "{table_name}"').fetchall()
    payload: list[dict[str, Any]] = []
    for row in rows:
        values: dict[str, Any] = {}
        for column_name in shared_columns:
            values[column_name] = coerce_value(row[column_name], target_columns[column_name])
        payload.append(values)

    session.execute(table.insert(), payload)

    if "id" in target_columns and isinstance(target_columns["id"].type, sa.Integer):
        reset_sequence(table_name, session)

    session.commit()
    print(f"  {table_name}: migrated {len(payload)} rows")


def migrate() -> None:
    load_dotenv()

    sqlite_path = resolve_sqlite_path(sys.argv)
    if not sqlite_path.exists():
        print(f"SQLite database not found at: {sqlite_path}")
        sys.exit(1)

    pg_url = normalize_database_url(os.environ.get("DATABASE_URL"))
    if not pg_url or "postgresql" not in pg_url:
        print("DATABASE_URL must be set to a PostgreSQL connection string")
        sys.exit(1)

    if str(APP_DIR) not in sys.path:
        sys.path.insert(0, str(APP_DIR))

    from app import app as flask_app, db  # pylint: disable=import-error

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row

    try:
        with flask_app.app_context():
            if db.engine.dialect.name != "postgresql":
                print("Configured SQLAlchemy engine is not PostgreSQL. Check DATABASE_URL.")
                sys.exit(1)

            db.create_all()

            sqlite_tables = get_sqlite_table_names(sqlite_conn)
            metadata_tables = list(db.Model.metadata.sorted_tables)
            model_table_names = [table.name for table in metadata_tables]

            print("Found model tables:")
            for table_name in model_table_names:
                print(f"- {table_name}")

            extra_sqlite_tables = sorted(sqlite_tables - set(model_table_names))
            if extra_sqlite_tables:
                print("\nSQLite tables not present in SQLAlchemy metadata:")
                for table_name in extra_sqlite_tables:
                    print(f"- {table_name}")

            print("\nClearing PostgreSQL tables for idempotent migration...")
            truncate_target_tables([table.name for table in reversed(metadata_tables)], db.session)

            print("Starting migration...\n")
            for table in metadata_tables:
                if table.name not in sqlite_tables:
                    print(f"Skipping {table.name}: not found in SQLite source")
                    continue

                try:
                    migrate_table(sqlite_conn, table, db.session)
                except Exception as exc:  # noqa: BLE001
                    db.session.rollback()
                    print(f"  {table.name}: failed - {exc}")

            print("\nMigration complete!")
    finally:
        sqlite_conn.close()


if __name__ == "__main__":
    migrate()
