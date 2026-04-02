"""Import database tables from a CSV backup directory.

Usage:
    cd backend && python -m scripts.import_data backups/2026-03-31_143022
    cd backend && python scripts/import_data.py backups/2026-03-31_143022 --dry-run
"""

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from sqlalchemy import create_engine, inspect, text

from app.config import settings

# Tables in dependency order (parents before children)
TABLES = [
    "qa_pairs",
    "processing_jobs",
    "agent_presets",
    "questionnaire_templates",
    "format_fingerprints",
    "audit_logs",
    "flagged_questions",
    "question_results",
    "answer_corrections",
    "template_answers",
]

# Columns that store datetime values (need string -> datetime conversion for Postgres)
DATETIME_COLUMNS = {
    "created_at",
    "updated_at",
    "deleted_at",
    "uploaded_at",
    "completed_at",
    "resolved_at",
    "last_used_at",
    "timestamp",
}

# Columns that store boolean values (need 0/1 -> True/False for Postgres)
BOOLEAN_COLUMNS = {
    "resolved",
    "reviewed",
    "is_builtin",
    "fallback_recommended",
    "auto_added_to_kb",
}


def _sync_database_url(url: str) -> str:
    """Convert an async database URL to a synchronous one."""
    if url.startswith("sqlite+aiosqlite"):
        return url.replace("sqlite+aiosqlite", "sqlite", 1)
    if url.startswith("postgresql+asyncpg"):
        return url.replace("postgresql+asyncpg", "postgresql", 1)
    return url


def _convert_value(value: str, column_name: str, is_postgres: bool) -> object:
    """Convert a CSV string value to the appropriate Python type."""
    if value == "":
        return None

    if column_name in DATETIME_COLUMNS:
        # Try common datetime formats
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        # Return as-is if no format matches (let the DB handle it)
        return value

    if column_name in BOOLEAN_COLUMNS and is_postgres:
        return value.lower() in ("1", "true", "t", "yes")

    return value


def main():
    parser = argparse.ArgumentParser(description="Import database tables from a CSV backup.")
    parser.add_argument("backup_dir", help="Path to the backup directory containing CSV files")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be imported without writing")
    args = parser.parse_args()

    backup_path = Path(args.backup_dir)
    if not backup_path.is_absolute():
        backup_path = _backend_dir / backup_path

    if not backup_path.is_dir():
        print(f"ERROR: Backup directory not found: {backup_path}")
        sys.exit(1)

    db_url = _sync_database_url(settings.database_url)
    is_postgres = db_url.startswith("postgresql")
    engine = create_engine(db_url)

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    print(f"Backup directory: {backup_path}")
    print(f"Database: {'PostgreSQL' if is_postgres else 'SQLite'}")
    if args.dry_run:
        print("MODE: DRY RUN (no data will be written)")
    print()

    summary = []

    for table_name in TABLES:
        csv_path = backup_path / f"{table_name}.csv"
        if not csv_path.exists():
            print(f"  SKIP  {table_name} (no CSV file found)")
            summary.append((table_name, 0, "skipped"))
            continue

        if table_name not in existing_tables:
            print(f"  SKIP  {table_name} (table does not exist in database)")
            summary.append((table_name, 0, "no table"))
            continue

        with open(csv_path, "r", newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            headers = next(reader)
            rows = list(reader)

        if not rows:
            print(f"  SKIP  {table_name} (0 rows in CSV)")
            summary.append((table_name, 0, "empty"))
            continue

        if args.dry_run:
            print(f"  DRY   {table_name}: {len(rows)} rows would be imported")
            summary.append((table_name, len(rows), "dry-run"))
            continue

        # Insert rows
        with engine.begin() as conn:
            placeholders = ", ".join(f":{h}" for h in headers)
            col_list = ", ".join(f'"{h}"' for h in headers)
            insert_sql = text(f'INSERT INTO {table_name} ({col_list}) VALUES ({placeholders})')

            inserted = 0
            for row in rows:
                values = {}
                for col_name, val in zip(headers, row):
                    values[col_name] = _convert_value(val, col_name, is_postgres)
                try:
                    conn.execute(insert_sql, values)
                    inserted += 1
                except Exception as e:
                    print(f"  WARN  {table_name} row error: {e}")

            print(f"  OK    {table_name}: {inserted}/{len(rows)} rows imported")
            summary.append((table_name, inserted, "ok"))

    # Print summary
    print()
    print(f"{'Table':<30} {'Rows':>8} {'Status':>10}")
    print("-" * 52)
    for table_name, row_count, status in summary:
        print(f"{table_name:<30} {row_count:>8} {status:>10}")

    total_rows = sum(r for _, r, s in summary if s in ("ok", "dry-run"))
    print("-" * 52)
    label = "WOULD IMPORT" if args.dry_run else "TOTAL IMPORTED"
    print(f"{label:<30} {total_rows:>8}")
    print()


if __name__ == "__main__":
    main()
