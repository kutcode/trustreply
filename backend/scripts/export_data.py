"""Export all database tables to CSV files in a timestamped backup directory.

Usage:
    cd backend && python -m scripts.export_data
    cd backend && python scripts/export_data.py
"""

import csv
import os
import sys
from datetime import datetime
from pathlib import Path

# Allow running as both `python -m scripts.export_data` and `python scripts/export_data.py`
_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from sqlalchemy import create_engine, inspect, text

from app.config import settings

# Tables to export (order doesn't matter for CSV export)
TABLES = [
    "qa_pairs",
    "processing_jobs",
    "flagged_questions",
    "question_results",
    "audit_logs",
    "format_fingerprints",
    "answer_corrections",
    "questionnaire_templates",
    "template_answers",
    "agent_presets",
]

# Binary columns to skip
SKIP_COLUMNS = {"embedding"}


def _sync_database_url(url: str) -> str:
    """Convert an async database URL to a synchronous one."""
    if url.startswith("sqlite+aiosqlite"):
        return url.replace("sqlite+aiosqlite", "sqlite", 1)
    if url.startswith("postgresql+asyncpg"):
        return url.replace("postgresql+asyncpg", "postgresql", 1)
    return url


def main():
    db_url = _sync_database_url(settings.database_url)
    engine = create_engine(db_url)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_dir = _backend_dir / "backups" / timestamp
    backup_dir.mkdir(parents=True, exist_ok=True)

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    summary = []

    with engine.connect() as conn:
        for table_name in TABLES:
            if table_name not in existing_tables:
                print(f"  SKIP  {table_name} (table does not exist)")
                summary.append((table_name, 0, 0, "skipped"))
                continue

            # Get column info, skip binary columns
            columns_info = inspector.get_columns(table_name)
            columns = [
                c["name"] for c in columns_info if c["name"] not in SKIP_COLUMNS
            ]

            col_list = ", ".join(f'"{c}"' for c in columns)
            result = conn.execute(text(f"SELECT {col_list} FROM {table_name}"))
            rows = result.fetchall()

            csv_path = backup_dir / f"{table_name}.csv"
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(columns)
                for row in rows:
                    writer.writerow(list(row))

            file_size = csv_path.stat().st_size
            row_count = len(rows)
            summary.append((table_name, row_count, file_size, "ok"))
            print(f"  OK    {table_name}: {row_count} rows")

    # Print summary
    print()
    print(f"Backup directory: {backup_dir}")
    print()
    print(f"{'Table':<30} {'Rows':>8} {'Size':>12} {'Status':>8}")
    print("-" * 62)
    for table_name, row_count, file_size, status in summary:
        size_str = _format_size(file_size) if status == "ok" else "-"
        print(f"{table_name:<30} {row_count:>8} {size_str:>12} {status:>8}")

    total_rows = sum(r for _, r, _, s in summary if s == "ok")
    total_size = sum(sz for _, _, sz, s in summary if s == "ok")
    print("-" * 62)
    print(f"{'TOTAL':<30} {total_rows:>8} {_format_size(total_size):>12}")
    print()


def _format_size(size_bytes: int) -> str:
    """Format bytes to a human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


if __name__ == "__main__":
    main()
