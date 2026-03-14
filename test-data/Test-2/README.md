# Mixed Coverage Stress-Test Corpus

This folder contains 50 generated `.docx` questionnaire files for upload testing.

What this corpus is designed to test:
- A mix of prompts that already exist in the sample knowledge base from `test-data/Test-1`
- A mix of prompts that are intentionally missing and should be flagged for review
- Multiple supported document layouts to stress parser selection and write-back behavior

Important note:
- The `expected_known_matches` counts assume you still have the `Test-1` sample knowledge base loaded into the app.
- The `expected_unknown_flags` counts are deliberate gaps and should remain unresolved unless you add more Q&A pairs.

Suggested parser profiles:
- `default`: standard two-column, paragraph, and mixed layouts
- `strict_two_column`: compact two-column layouts with no extra metadata columns
- `three_column_table`: three-column tables where the question is in the middle column
- `row_block_questionnaire`: merged question rows with blank answer rows below

See `manifest.csv` for a machine-readable summary.

| File | Layout Family | Theme | Suggested Profile | Expected Known | Expected Unknown |
|---|---|---|---|---:|---:|
| `01_balanced_two_column_mix_security.docx` | Balanced two-column table | Security | `default` | 3 | 3 |
| `02_two_column_header_mix_security.docx` | Two-column table with header row | Security | `default` | 3 | 3 |
| `03_multi_section_unknown_heavy_security.docx` | Multiple section tables with heavier unknown mix | Security | `default` | 2 | 4 |
| `04_strict_two_column_known_heavy_security.docx` | Compact two-column table with heavier known mix | Security | `strict_two_column` | 4 | 2 |
| `05_three_column_middle_mix_security.docx` | Three-column table with question in the middle column | Security | `three_column_table` | 4 | 2 |
| `06_four_column_metadata_mix_security.docx` | Four-column metadata table | Security | `default` | 3 | 4 |
| `07_merged_row_block_mix_security.docx` | Merged row-block questionnaire | Security | `row_block_questionnaire` | 3 | 3 |
| `08_sectioned_row_block_unknown_heavy_security.docx` | Sectioned row-block questionnaire with more unknown prompts | Security | `row_block_questionnaire` | 2 | 4 |
| `09_numbered_paragraph_unknown_heavy_security.docx` | Numbered paragraph questionnaire | Security | `default` | 2 | 4 |
| `10_mixed_layout_partial_kb_security.docx` | Mixed table, paragraph, and row-block layout | Security | `default` | 4 | 4 |
| `11_balanced_two_column_mix_privacy.docx` | Balanced two-column table | Privacy | `default` | 3 | 3 |
| `12_two_column_header_mix_privacy.docx` | Two-column table with header row | Privacy | `default` | 3 | 3 |
| `13_multi_section_unknown_heavy_privacy.docx` | Multiple section tables with heavier unknown mix | Privacy | `default` | 2 | 4 |
| `14_strict_two_column_known_heavy_privacy.docx` | Compact two-column table with heavier known mix | Privacy | `strict_two_column` | 4 | 2 |
| `15_three_column_middle_mix_privacy.docx` | Three-column table with question in the middle column | Privacy | `three_column_table` | 4 | 2 |
| `16_four_column_metadata_mix_privacy.docx` | Four-column metadata table | Privacy | `default` | 3 | 4 |
| `17_merged_row_block_mix_privacy.docx` | Merged row-block questionnaire | Privacy | `row_block_questionnaire` | 3 | 3 |
| `18_sectioned_row_block_unknown_heavy_privacy.docx` | Sectioned row-block questionnaire with more unknown prompts | Privacy | `row_block_questionnaire` | 2 | 4 |
| `19_numbered_paragraph_unknown_heavy_privacy.docx` | Numbered paragraph questionnaire | Privacy | `default` | 2 | 4 |
| `20_mixed_layout_partial_kb_privacy.docx` | Mixed table, paragraph, and row-block layout | Privacy | `default` | 4 | 4 |
| `21_balanced_two_column_mix_operations.docx` | Balanced two-column table | Operations | `default` | 3 | 3 |
| `22_two_column_header_mix_operations.docx` | Two-column table with header row | Operations | `default` | 3 | 3 |
| `23_multi_section_unknown_heavy_operations.docx` | Multiple section tables with heavier unknown mix | Operations | `default` | 2 | 4 |
| `24_strict_two_column_known_heavy_operations.docx` | Compact two-column table with heavier known mix | Operations | `strict_two_column` | 4 | 2 |
| `25_three_column_middle_mix_operations.docx` | Three-column table with question in the middle column | Operations | `three_column_table` | 4 | 2 |
| `26_four_column_metadata_mix_operations.docx` | Four-column metadata table | Operations | `default` | 3 | 4 |
| `27_merged_row_block_mix_operations.docx` | Merged row-block questionnaire | Operations | `row_block_questionnaire` | 3 | 3 |
| `28_sectioned_row_block_unknown_heavy_operations.docx` | Sectioned row-block questionnaire with more unknown prompts | Operations | `row_block_questionnaire` | 2 | 4 |
| `29_numbered_paragraph_unknown_heavy_operations.docx` | Numbered paragraph questionnaire | Operations | `default` | 2 | 4 |
| `30_mixed_layout_partial_kb_operations.docx` | Mixed table, paragraph, and row-block layout | Operations | `default` | 4 | 4 |
| `31_balanced_two_column_mix_continuity.docx` | Balanced two-column table | Business Continuity | `default` | 3 | 3 |
| `32_two_column_header_mix_continuity.docx` | Two-column table with header row | Business Continuity | `default` | 3 | 3 |
| `33_multi_section_unknown_heavy_continuity.docx` | Multiple section tables with heavier unknown mix | Business Continuity | `default` | 2 | 4 |
| `34_strict_two_column_known_heavy_continuity.docx` | Compact two-column table with heavier known mix | Business Continuity | `strict_two_column` | 4 | 2 |
| `35_three_column_middle_mix_continuity.docx` | Three-column table with question in the middle column | Business Continuity | `three_column_table` | 4 | 2 |
| `36_four_column_metadata_mix_continuity.docx` | Four-column metadata table | Business Continuity | `default` | 3 | 4 |
| `37_merged_row_block_mix_continuity.docx` | Merged row-block questionnaire | Business Continuity | `row_block_questionnaire` | 3 | 3 |
| `38_sectioned_row_block_unknown_heavy_continuity.docx` | Sectioned row-block questionnaire with more unknown prompts | Business Continuity | `row_block_questionnaire` | 2 | 4 |
| `39_numbered_paragraph_unknown_heavy_continuity.docx` | Numbered paragraph questionnaire | Business Continuity | `default` | 2 | 4 |
| `40_mixed_layout_partial_kb_continuity.docx` | Mixed table, paragraph, and row-block layout | Business Continuity | `default` | 4 | 4 |
| `41_balanced_two_column_mix_vendor.docx` | Balanced two-column table | Vendor Management | `default` | 3 | 3 |
| `42_two_column_header_mix_vendor.docx` | Two-column table with header row | Vendor Management | `default` | 3 | 3 |
| `43_multi_section_unknown_heavy_vendor.docx` | Multiple section tables with heavier unknown mix | Vendor Management | `default` | 2 | 4 |
| `44_strict_two_column_known_heavy_vendor.docx` | Compact two-column table with heavier known mix | Vendor Management | `strict_two_column` | 4 | 2 |
| `45_three_column_middle_mix_vendor.docx` | Three-column table with question in the middle column | Vendor Management | `three_column_table` | 4 | 2 |
| `46_four_column_metadata_mix_vendor.docx` | Four-column metadata table | Vendor Management | `default` | 3 | 4 |
| `47_merged_row_block_mix_vendor.docx` | Merged row-block questionnaire | Vendor Management | `row_block_questionnaire` | 3 | 3 |
| `48_sectioned_row_block_unknown_heavy_vendor.docx` | Sectioned row-block questionnaire with more unknown prompts | Vendor Management | `row_block_questionnaire` | 2 | 4 |
| `49_numbered_paragraph_unknown_heavy_vendor.docx` | Numbered paragraph questionnaire | Vendor Management | `default` | 2 | 4 |
| `50_mixed_layout_partial_kb_vendor.docx` | Mixed table, paragraph, and row-block layout | Vendor Management | `default` | 4 | 4 |
