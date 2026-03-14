# Generated Layout Corpus

This folder contains 50 generated `.docx` questionnaire files for manual upload testing.

Companion knowledge base data:
- `knowledge_base_generated_layout_corpus.csv`: 75 Q&A rows that match the prompts used across this corpus
- The same 75 rows can also be seeded into the local app database with `backend/scripts/seed_generated_layout_corpus_kb.py`

Suggested parser profiles:
- `default`: standard two-column, paragraph, and mixed layouts
- `strict_two_column`: compact strict two-column tables
- `three_column_table`: three-column tables where the question is in column 2 and the answer is in column 3
- `row_block_questionnaire`: merged question rows with blank answer rows below

Note: the default parser now auto-detects common `Question` / `Answer` or `Question` / `Response` header pairs in wider tables, so the `*_three_column_middle_question_*` and `*_four_column_metadata_*` files can be used as normal regression fixtures rather than only stress cases.

| File | Layout Family | Theme | Suggested Profile |
|---|---|---|---|
| `01_basic_two_column_security.docx` | Basic two-column table | Security | `default` |
| `02_two_column_with_header_security.docx` | Two-column table with header row | Security | `default` |
| `03_multi_table_sections_security.docx` | Multiple two-column tables split by sections | Security | `default` |
| `04_strict_two_column_compact_security.docx` | Compact strict two-column table | Security | `strict_two_column` |
| `05_three_column_middle_question_security.docx` | Three-column table with question in middle column | Security | `three_column_table` |
| `06_four_column_metadata_security.docx` | Four-column metadata table with response in last column | Security | `default` |
| `07_merged_row_block_security.docx` | Merged full-width question row with answer row below | Security | `row_block_questionnaire` |
| `08_sectioned_row_block_security.docx` | Sectioned merged row-block questionnaire | Security | `row_block_questionnaire` |
| `09_paragraph_numbered_security.docx` | Numbered paragraph questionnaire | Security | `default` |
| `10_mixed_layout_security.docx` | Mixed table, paragraph, and row-block layout | Security | `default` |
| `11_basic_two_column_privacy.docx` | Basic two-column table | Privacy | `default` |
| `12_two_column_with_header_privacy.docx` | Two-column table with header row | Privacy | `default` |
| `13_multi_table_sections_privacy.docx` | Multiple two-column tables split by sections | Privacy | `default` |
| `14_strict_two_column_compact_privacy.docx` | Compact strict two-column table | Privacy | `strict_two_column` |
| `15_three_column_middle_question_privacy.docx` | Three-column table with question in middle column | Privacy | `three_column_table` |
| `16_four_column_metadata_privacy.docx` | Four-column metadata table with response in last column | Privacy | `default` |
| `17_merged_row_block_privacy.docx` | Merged full-width question row with answer row below | Privacy | `row_block_questionnaire` |
| `18_sectioned_row_block_privacy.docx` | Sectioned merged row-block questionnaire | Privacy | `row_block_questionnaire` |
| `19_paragraph_numbered_privacy.docx` | Numbered paragraph questionnaire | Privacy | `default` |
| `20_mixed_layout_privacy.docx` | Mixed table, paragraph, and row-block layout | Privacy | `default` |
| `21_basic_two_column_operations.docx` | Basic two-column table | Operations | `default` |
| `22_two_column_with_header_operations.docx` | Two-column table with header row | Operations | `default` |
| `23_multi_table_sections_operations.docx` | Multiple two-column tables split by sections | Operations | `default` |
| `24_strict_two_column_compact_operations.docx` | Compact strict two-column table | Operations | `strict_two_column` |
| `25_three_column_middle_question_operations.docx` | Three-column table with question in middle column | Operations | `three_column_table` |
| `26_four_column_metadata_operations.docx` | Four-column metadata table with response in last column | Operations | `default` |
| `27_merged_row_block_operations.docx` | Merged full-width question row with answer row below | Operations | `row_block_questionnaire` |
| `28_sectioned_row_block_operations.docx` | Sectioned merged row-block questionnaire | Operations | `row_block_questionnaire` |
| `29_paragraph_numbered_operations.docx` | Numbered paragraph questionnaire | Operations | `default` |
| `30_mixed_layout_operations.docx` | Mixed table, paragraph, and row-block layout | Operations | `default` |
| `31_basic_two_column_continuity.docx` | Basic two-column table | Business Continuity | `default` |
| `32_two_column_with_header_continuity.docx` | Two-column table with header row | Business Continuity | `default` |
| `33_multi_table_sections_continuity.docx` | Multiple two-column tables split by sections | Business Continuity | `default` |
| `34_strict_two_column_compact_continuity.docx` | Compact strict two-column table | Business Continuity | `strict_two_column` |
| `35_three_column_middle_question_continuity.docx` | Three-column table with question in middle column | Business Continuity | `three_column_table` |
| `36_four_column_metadata_continuity.docx` | Four-column metadata table with response in last column | Business Continuity | `default` |
| `37_merged_row_block_continuity.docx` | Merged full-width question row with answer row below | Business Continuity | `row_block_questionnaire` |
| `38_sectioned_row_block_continuity.docx` | Sectioned merged row-block questionnaire | Business Continuity | `row_block_questionnaire` |
| `39_paragraph_numbered_continuity.docx` | Numbered paragraph questionnaire | Business Continuity | `default` |
| `40_mixed_layout_continuity.docx` | Mixed table, paragraph, and row-block layout | Business Continuity | `default` |
| `41_basic_two_column_vendor.docx` | Basic two-column table | Vendor Management | `default` |
| `42_two_column_with_header_vendor.docx` | Two-column table with header row | Vendor Management | `default` |
| `43_multi_table_sections_vendor.docx` | Multiple two-column tables split by sections | Vendor Management | `default` |
| `44_strict_two_column_compact_vendor.docx` | Compact strict two-column table | Vendor Management | `strict_two_column` |
| `45_three_column_middle_question_vendor.docx` | Three-column table with question in middle column | Vendor Management | `three_column_table` |
| `46_four_column_metadata_vendor.docx` | Four-column metadata table with response in last column | Vendor Management | `default` |
| `47_merged_row_block_vendor.docx` | Merged full-width question row with answer row below | Vendor Management | `row_block_questionnaire` |
| `48_sectioned_row_block_vendor.docx` | Sectioned merged row-block questionnaire | Vendor Management | `row_block_questionnaire` |
| `49_paragraph_numbered_vendor.docx` | Numbered paragraph questionnaire | Vendor Management | `default` |
| `50_mixed_layout_vendor.docx` | Mixed table, paragraph, and row-block layout | Vendor Management | `default` |
