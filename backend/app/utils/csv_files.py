"""Helpers for reading and writing questionnaire CSV files."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CsvFormat:
    """Serializable subset of CSV formatting options we want to preserve."""

    delimiter: str = ","
    quotechar: str = '"'
    lineterminator: str = "\n"


def detect_csv_format(text: str) -> CsvFormat:
    """Best-effort CSV dialect detection with safe defaults."""

    if not text.strip():
        return CsvFormat()

    try:
        dialect = csv.Sniffer().sniff(text, delimiters=",;\t|")
        return CsvFormat(
            delimiter=dialect.delimiter,
            quotechar=getattr(dialect, "quotechar", '"') or '"',
            lineterminator=getattr(dialect, "lineterminator", "\n") or "\n",
        )
    except csv.Error:
        return CsvFormat()


def read_csv_rows(file_path: Path) -> tuple[list[list[str]], CsvFormat]:
    """Read CSV rows and preserve the most likely file formatting."""

    text = file_path.read_text(encoding="utf-8-sig")
    csv_format = detect_csv_format(text)
    reader = csv.reader(
        text.splitlines(),
        delimiter=csv_format.delimiter,
        quotechar=csv_format.quotechar,
    )
    rows = [[cell.strip() for cell in row] for row in reader]
    return rows, csv_format


def write_csv_rows(file_path: Path, rows: list[list[str]], csv_format: CsvFormat) -> Path:
    """Write CSV rows using the preserved delimiter and quoting style."""

    with file_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(
            handle,
            delimiter=csv_format.delimiter,
            quotechar=csv_format.quotechar,
            lineterminator=csv_format.lineterminator or "\n",
        )
        writer.writerows(rows)
    return file_path
