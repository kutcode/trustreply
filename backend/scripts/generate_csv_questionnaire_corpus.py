#!/usr/bin/env python3
"""Generate a 50-file CSV questionnaire corpus for TrustReply upload testing."""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

from generate_layout_variation_corpus import (
    THEMES,
    build_question_entries,
    weave,
    rotate_select,
    make_entries,
)


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "test-data" / "Test-CSV"
MANIFEST_PATH = OUTPUT_DIR / "manifest.csv"
README_PATH = OUTPUT_DIR / "README.md"


LAYOUTS: list[dict[str, str]] = [
    {"slug": "question_answer_grid", "label": "Two-column Question/Answer grid", "profile": "default"},
    {"slug": "prompt_response_sheet", "label": "Two-column Prompt/Response sheet", "profile": "default"},
    {"slug": "domain_question_response_grid", "label": "Three-column domain/question/response grid", "profile": "three_column_table"},
    {"slug": "reference_question_response_matrix", "label": "Four-column reference/question/response matrix", "profile": "default"},
    {"slug": "label_question_answer_sheet", "label": "Two-column label and question answer sheet", "profile": "default"},
    {"slug": "id_question_answer_registry", "label": "Three-column ID/question/answer registry", "profile": "three_column_table"},
    {"slug": "domain_control_prompt_comments", "label": "Four-column domain/control/prompt/comments matrix", "profile": "default"},
    {"slug": "strict_no_header_two_column", "label": "Strict two-column sheet without headers", "profile": "strict_two_column"},
    {"slug": "domain_type_question_notes", "label": "Four-column domain/type/question/notes sheet", "profile": "default"},
    {"slug": "control_prompt_response_register", "label": "Three-column control/prompt/response register", "profile": "three_column_table"},
]


def count_status(entries) -> tuple[int, int]:
    known = sum(1 for entry in entries if entry.status == "known")
    unknown = sum(1 for entry in entries if entry.status == "unknown")
    return known, unknown


def build_long_label_entries(theme: dict[str, object], *, known_count: int, unknown_count: int, offset: int):
    known_labels = [label for label in list(theme["known_labels"]) if len(label.strip()) >= 10] or list(theme["known_labels"])
    unknown_labels = [label for label in list(theme["unknown_labels"]) if len(label.strip()) >= 10] or list(theme["unknown_labels"])
    known = make_entries(rotate_select(known_labels, known_count, offset), "known")
    unknown = make_entries(rotate_select(unknown_labels, unknown_count, offset), "unknown")
    return weave(known, unknown)


def build_entries(theme: dict[str, object], layout_index: int):
    offset = layout_index - 1

    if layout_index == 1:
        return build_question_entries(theme, known_count=3, unknown_count=3, offset=offset)
    if layout_index == 2:
        return build_question_entries(theme, known_count=2, unknown_count=4, offset=offset + 1)
    if layout_index == 3:
        return build_question_entries(theme, known_count=4, unknown_count=2, offset=offset + 1)
    if layout_index == 4:
        return weave(
            build_long_label_entries(theme, known_count=1, unknown_count=1, offset=offset),
            build_question_entries(theme, known_count=2, unknown_count=3, offset=offset + 2),
        )
    if layout_index == 5:
        return weave(
            build_long_label_entries(theme, known_count=2, unknown_count=1, offset=offset),
            build_question_entries(theme, known_count=2, unknown_count=2, offset=offset + 1),
        )
    if layout_index == 6:
        return weave(
            build_long_label_entries(theme, known_count=1, unknown_count=0, offset=offset),
            build_question_entries(theme, known_count=3, unknown_count=2, offset=offset + 1),
        )
    if layout_index == 7:
        return weave(
            build_long_label_entries(theme, known_count=1, unknown_count=1, offset=offset),
            build_question_entries(theme, known_count=2, unknown_count=3, offset=offset + 2),
        )
    if layout_index == 8:
        return build_question_entries(theme, known_count=3, unknown_count=3, offset=offset + 3)
    if layout_index == 9:
        return weave(
            build_question_entries(theme, known_count=4, unknown_count=2, offset=offset + 2),
        )
    return build_question_entries(theme, known_count=4, unknown_count=2, offset=offset + 2)


def render_rows(theme_key: str, category: str, layout_index: int, entries) -> list[list[str]]:
    if layout_index == 1:
        rows = [["Question", "Answer"]]
        rows.extend([[entry.text, ""] for entry in entries])
        return rows
    if layout_index == 2:
        rows = [["Prompt", "Response"]]
        rows.extend([[entry.text, ""] for entry in entries])
        return rows
    if layout_index == 3:
        rows = [["Domain", "Question", "Response"]]
        rows.extend([[category, entry.text, ""] for entry in entries])
        return rows
    if layout_index == 4:
        rows = [["Domain", "Reference", "Question", "Response"]]
        rows.extend([[theme_key.title(), f"{theme_key[:3].upper()}-{index:02d}", entry.text, ""] for index, entry in enumerate(entries, start=1)])
        return rows
    if layout_index == 5:
        rows = [["Question", "Answer"]]
        rows.extend([[entry.text, ""] for entry in entries])
        return rows
    if layout_index == 6:
        rows = [["ID", "Question", "Answer"]]
        rows.extend([[f"{theme_key[:3].upper()}-{index:02d}", entry.text, ""] for index, entry in enumerate(entries, start=1)])
        return rows
    if layout_index == 7:
        rows = [["Domain", "Reference", "Prompt", "Comments"]]
        rows.extend([[theme_key.title(), f"REF-{index:02d}", entry.text, ""] for index, entry in enumerate(entries, start=1)])
        return rows
    if layout_index == 8:
        return [[entry.text, ""] for entry in entries]
    if layout_index == 9:
        rows = [["Domain", "Type", "Question", "Notes"]]
        rows.extend([[theme_key.title(), entry.status.title(), entry.text, ""] for entry in entries])
        return rows

    rows = [["Reference", "Prompt", "Response"]]
    rows.extend([[f"{theme_key[:3].upper()}-{index:02d}", entry.text, ""] for index, entry in enumerate(entries, start=1)])
    return rows


def write_manifest(rows: list[dict[str, object]]) -> None:
    with MANIFEST_PATH.open("w", newline="", encoding="utf-8") as handle:
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


def write_readme(rows: list[dict[str, object]]) -> None:
    lines = [
        "# CSV Questionnaire Stress-Test Corpus",
        "",
        "This folder contains 50 generated `.csv` questionnaires for TrustReply upload testing.",
        "",
        "What this corpus is designed to test:",
        "- CSV questionnaires that mirror common tabular document layouts",
        "- A mix of prompts that already exist in the sample knowledge base",
        "- A mix of prompts that should still be flagged for review",
        "- Different column/header patterns such as `Question/Answer`, `Prompt/Response`, and wider reference matrices",
        "",
        "Suggested parser profiles:",
        "- `default`: two-column sheets and wider matrices with detectable question/answer headers",
        "- `three_column_table`: files where the question is in the middle column",
        "- `strict_two_column`: headerless two-column sheets",
        "",
        "See `manifest.csv` for expected per-file counts.",
        "",
        "| File | Layout Family | Theme | Suggested Profile | Expected Known | Expected Unknown |",
        "|---|---|---|---|---:|---:|",
    ]

    for row in rows:
        lines.append(
            f"| `{row['file']}` | {row['layout_family']} | {row['theme']} | `{row['suggested_profile']}` | {row['expected_known_matches']} | {row['expected_unknown_flags']} |"
        )

    README_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest_rows: list[dict[str, object]] = []
    theme_order = ["security", "privacy", "operations", "continuity", "vendor"]

    file_number = 1
    for theme_key in theme_order:
        theme = THEMES[theme_key]
        category = str(theme["category"])
        for layout_index, layout in enumerate(LAYOUTS, start=1):
            filename = f"{file_number:02d}_{layout['slug']}_{theme_key}.csv"
            entries = build_entries(theme, layout_index)
            known_count, unknown_count = count_status(entries)
            rows = render_rows(theme_key, category, layout_index, entries)

            with (OUTPUT_DIR / filename).open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerows(rows)

            manifest_rows.append(
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

    write_manifest(manifest_rows)
    write_readme(manifest_rows)
    print(f"Generated {len(manifest_rows)} CSV questionnaires in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
