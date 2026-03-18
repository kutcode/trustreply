#!/usr/bin/env python3
"""Generate a combined DOCX/CSV/PDF corpus for full-capacity upload testing."""

from __future__ import annotations

import csv
import shutil
import subprocess
import tempfile
from pathlib import Path

from generate_layout_variation_corpus import (
    THEMES,
    LAYOUTS as DOCX_LAYOUTS,
    render_document as render_docx_document,
    build_question_entries,
    build_label_entries,
    weave,
    rotate_select,
    make_entries,
)
from generate_csv_questionnaire_corpus import (
    LAYOUTS as CSV_LAYOUTS,
    build_entries as build_csv_entries,
    render_rows as render_csv_rows,
    count_status as count_csv_status,
)


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "test-data" / "Test-Full-Capacity"
DOCX_DIR = OUTPUT_DIR / "docx"
CSV_DIR = OUTPUT_DIR / "csv"
PDF_DIR = OUTPUT_DIR / "pdf"


PDF_LAYOUTS: list[dict[str, str]] = [
    {"slug": "numbered_question_packet", "label": "Numbered question packet", "profile": "default"},
    {"slug": "sectioned_question_packet", "label": "Sectioned question packet", "profile": "default"},
    {"slug": "metadata_and_questions", "label": "Metadata lines plus questions", "profile": "default"},
    {"slug": "known_heavy_brief", "label": "Known-heavy questionnaire brief", "profile": "default"},
    {"slug": "unknown_heavy_brief", "label": "Unknown-heavy questionnaire brief", "profile": "default"},
    {"slug": "dual_section_mix", "label": "Dual-section mixed prompt list", "profile": "default"},
    {"slug": "label_heavy_packet", "label": "Label-heavy questionnaire packet", "profile": "default"},
    {"slug": "appendix_style_packet", "label": "Appendix-style prompt packet", "profile": "default"},
    {"slug": "narrative_prompt_set", "label": "Narrative prompt set", "profile": "default"},
    {"slug": "mixed_followup_packet", "label": "Mixed follow-up prompt packet", "profile": "default"},
]


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def write_manifest(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "file",
                "theme",
                "layout_family",
                "suggested_profile",
                "total_prompts",
                "expected_known_matches",
                "expected_unknown_flags",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


def write_subfolder_readme(path: Path, title: str, description: str, rows: list[dict[str, object]]) -> None:
    lines = [
        f"# {title}",
        "",
        description,
        "",
        "| File | Layout Family | Theme | Suggested Profile | Expected Known | Expected Unknown |",
        "|---|---|---|---|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| `{row['file']}` | {row['layout_family']} | {row['theme']} | `{row['suggested_profile']}` | {row['expected_known_matches']} | {row['expected_unknown_flags']} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_top_level_readme() -> None:
    lines = [
        "# Full Capacity Test Corpus",
        "",
        "This folder contains a full mixed-format upload corpus for TrustReply.",
        "",
        "Subfolders:",
        "- `docx/`: 50 DOCX questionnaires with mixed supported layouts",
        "- `csv/`: 50 CSV questionnaires with mixed tabular layouts",
        "- `pdf/`: 50 text-based PDF questionnaires with known and unknown prompts",
        "",
        "Each subfolder includes its own `README.md` and `manifest.csv`.",
        "",
        "This corpus is designed to stress:",
        "- parser profile selection",
        "- bulk upload handling",
        "- known vs. unknown question matching",
        "- flagged-question generation",
        "- format-specific output generation",
    ]
    (OUTPUT_DIR / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def generate_docx_corpus() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    file_number = 1
    for theme_key in ["security", "privacy", "operations", "continuity", "vendor"]:
        theme = THEMES[theme_key]
        for layout_index, layout in enumerate(DOCX_LAYOUTS, start=1):
            filename = f"{file_number:02d}_{layout['slug']}_{theme_key}.docx"
            output_path = DOCX_DIR / filename
            known_count, unknown_count = render_docx_document(theme_key, theme, layout_index, output_path)
            rows.append(
                {
                    "file": filename,
                    "theme": str(theme["category"]),
                    "layout_family": layout["label"],
                    "suggested_profile": layout["profile"],
                    "total_prompts": known_count + unknown_count,
                    "expected_known_matches": known_count,
                    "expected_unknown_flags": unknown_count,
                }
            )
            file_number += 1
    return rows


def generate_csv_corpus() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    file_number = 1
    for theme_key in ["security", "privacy", "operations", "continuity", "vendor"]:
        theme = THEMES[theme_key]
        category = str(theme["category"])
        for layout_index, layout in enumerate(CSV_LAYOUTS, start=1):
            filename = f"{file_number:02d}_{layout['slug']}_{theme_key}.csv"
            entries = build_csv_entries(theme, layout_index)
            known_count, unknown_count = count_csv_status(entries)
            csv_rows = render_csv_rows(theme_key, category, layout_index, entries)
            with (CSV_DIR / filename).open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerows(csv_rows)
            rows.append(
                {
                    "file": filename,
                    "theme": category,
                    "layout_family": layout["label"],
                    "suggested_profile": layout["profile"],
                    "total_prompts": known_count + unknown_count,
                    "expected_known_matches": known_count,
                    "expected_unknown_flags": unknown_count,
                }
            )
            file_number += 1
    return rows


def build_long_pdf_label_entries(theme: dict[str, object], *, known_count: int, unknown_count: int, offset: int):
    known_labels = [label for label in list(theme["known_labels"]) if len(label.strip()) >= 10] or list(theme["known_labels"])
    unknown_labels = [label for label in list(theme["unknown_labels"]) if len(label.strip()) >= 10] or list(theme["unknown_labels"])
    known = make_entries(rotate_select(known_labels, known_count, offset), "known")
    unknown = make_entries(rotate_select(unknown_labels, unknown_count, offset), "unknown")
    return weave(known, unknown)


def build_pdf_entries(theme: dict[str, object], layout_index: int):
    offset = layout_index - 1
    if layout_index == 1:
        return build_question_entries(theme, known_count=3, unknown_count=3, offset=offset)
    if layout_index == 2:
        return build_question_entries(theme, known_count=2, unknown_count=4, offset=offset + 1)
    if layout_index == 3:
        return build_question_entries(theme, known_count=4, unknown_count=3, offset=offset + 1)
    if layout_index == 4:
        return build_question_entries(theme, known_count=4, unknown_count=2, offset=offset + 2)
    if layout_index == 5:
        return build_question_entries(theme, known_count=2, unknown_count=4, offset=offset + 2)
    if layout_index == 6:
        return weave(
            build_question_entries(theme, known_count=2, unknown_count=2, offset=offset),
            build_question_entries(theme, known_count=1, unknown_count=1, offset=offset + 3),
        )
    if layout_index == 7:
        return build_question_entries(theme, known_count=4, unknown_count=3, offset=offset + 2)
    if layout_index == 8:
        return build_question_entries(theme, known_count=3, unknown_count=3, offset=offset + 4)
    if layout_index == 9:
        return build_question_entries(theme, known_count=4, unknown_count=3, offset=offset + 1)
    return build_question_entries(theme, known_count=4, unknown_count=3, offset=offset + 2)


def count_pdf_status(entries) -> tuple[int, int]:
    known = sum(1 for entry in entries if entry.status == "known")
    unknown = sum(1 for entry in entries if entry.status == "unknown")
    return known, unknown


def render_pdf_text(theme_key: str, category: str, layout_index: int, entries) -> str:
    lines = [
        f"{category} PDF Stress Test Questionnaire",
        "",
        "The prompts below intentionally mix questions that exist in the sample knowledge base with prompts that do not.",
        "",
    ]

    if layout_index in {2, 6, 8}:
        midpoint = len(entries) // 2
        sections = [("Section A", entries[:midpoint]), ("Section B", entries[midpoint:])]
    else:
        sections = [("Questionnaire", entries)]

    for section_index, (section_title, section_entries) in enumerate(sections, start=1):
        lines.append(section_title)
        lines.append("")
        for entry_index, entry in enumerate(section_entries, start=1):
            if layout_index in {1, 4, 5, 8}:
                prompt = f"{entry_index}. {entry.text}"
            elif layout_index in {3, 7, 9, 10}:
                prompt = entry.text
            else:
                prompt = f"{chr(96 + entry_index)}. {entry.text}"
            lines.append(prompt)
            lines.append("")
        if section_index != len(sections):
            lines.append("")

    return "\n".join(lines) + "\n"


def convert_text_to_pdf(text: str, output_path: Path) -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        text_path = Path(temp_dir) / "source.txt"
        pdf_path = Path(temp_dir) / "source.pdf"
        text_path.write_text(text, encoding="utf-8")
        with pdf_path.open("wb") as output_handle:
            subprocess.run(
                ["cupsfilter", str(text_path)],
                check=True,
                stdout=output_handle,
                stderr=subprocess.DEVNULL,
            )
        shutil.copy2(pdf_path, output_path)


def generate_pdf_corpus() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    file_number = 1
    for theme_key in ["security", "privacy", "operations", "continuity", "vendor"]:
        theme = THEMES[theme_key]
        category = str(theme["category"])
        for layout_index, layout in enumerate(PDF_LAYOUTS, start=1):
            filename = f"{file_number:02d}_{layout['slug']}_{theme_key}.pdf"
            entries = build_pdf_entries(theme, layout_index)
            known_count, unknown_count = count_pdf_status(entries)
            pdf_text = render_pdf_text(theme_key, category, layout_index, entries)
            convert_text_to_pdf(pdf_text, PDF_DIR / filename)
            rows.append(
                {
                    "file": filename,
                    "theme": category,
                    "layout_family": layout["label"],
                    "suggested_profile": layout["profile"],
                    "total_prompts": known_count + unknown_count,
                    "expected_known_matches": known_count,
                    "expected_unknown_flags": unknown_count,
                }
            )
            file_number += 1
    return rows


def main() -> None:
    ensure_clean_dir(OUTPUT_DIR)
    ensure_clean_dir(DOCX_DIR)
    ensure_clean_dir(CSV_DIR)
    ensure_clean_dir(PDF_DIR)

    docx_rows = generate_docx_corpus()
    csv_rows = generate_csv_corpus()
    pdf_rows = generate_pdf_corpus()

    write_manifest(DOCX_DIR / "manifest.csv", docx_rows)
    write_manifest(CSV_DIR / "manifest.csv", csv_rows)
    write_manifest(PDF_DIR / "manifest.csv", pdf_rows)

    write_subfolder_readme(
        DOCX_DIR / "README.md",
        "DOCX Full Capacity Corpus",
        "50 DOCX questionnaires with mixed supported layouts, known prompts, and intentionally unknown prompts.",
        docx_rows,
    )
    write_subfolder_readme(
        CSV_DIR / "README.md",
        "CSV Full Capacity Corpus",
        "50 CSV questionnaires with mixed tabular layouts, known prompts, and intentionally unknown prompts.",
        csv_rows,
    )
    write_subfolder_readme(
        PDF_DIR / "README.md",
        "PDF Full Capacity Corpus",
        "50 text-based PDF questionnaires with sectioned prompt packets, known prompts, and intentionally unknown prompts.",
        pdf_rows,
    )
    write_top_level_readme()

    print(f"Generated DOCX corpus in {DOCX_DIR}")
    print(f"Generated CSV corpus in {CSV_DIR}")
    print(f"Generated PDF corpus in {PDF_DIR}")


if __name__ == "__main__":
    main()
