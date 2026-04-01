# Test Coverage Analysis

## Current State

The project has **278 backend test cases** across 13 test files using pytest (93 original + 185 new). The frontend (Next.js/React) has **zero tests** — no test framework is even configured.

### Backend Test Inventory

| Test File | Module Tested | Test Cases | Type | Status |
|-----------|--------------|------------|------|--------|
| `test_api.py` | FastAPI endpoints | 42 | Integration | Original |
| `test_parser.py` | Document parsing | 29 | Unit | Original |
| `test_generator.py` | Document generation | 10 | Unit | Original |
| `test_matcher.py` | Semantic matching | 6 | Integration | Original |
| `test_embeddings.py` | Embedding utilities | 6 | Unit | Original |
| `test_questions.py` | Question normalization | 22 | Unit | **New** |
| `test_csv_files.py` | CSV format handling | 14 | Unit | **New** |
| `test_agent_unit.py` | Agent pure functions | 66 | Unit | **New** |
| `test_review_workflow.py` | Review/approve/finalize | 17 | Integration | **New** |
| `test_export_and_flagged.py` | QA export, flagged mgmt | 14 | Integration | **New** |
| `test_upload_helpers.py` | Upload helper functions | 17 | Unit | **New** |
| `test_parser_helpers.py` | Parser heuristic helpers | 31 | Unit | **New** |
| `test_database.py` | Schema migration | 4 | Integration | **New** |

---

## Coverage Gaps (Backend)

### 1. Agent Service — 0% Coverage (Critical)

**File:** `app/services/agent.py` (1,074 lines)

This is the largest and most complex service with **zero test coverage**. Key untested functions:

- `run_contextual_fill_agent()` — Core AI orchestration (~325 lines). Handles question batching, LLM calls, answer extraction, and trace logging.
- `run_troubleshoot_agent()` — Diagnostic agent for parser profile analysis (~150 lines).
- `_call_anthropic_json()` / `_call_openai_compatible_json()` — Provider-specific API integrations with retry logic.
- `_extract_json_object()` — Parses JSON from freeform LLM output (fragile, high bug surface).
- `_post_json_with_retries()` — Retry logic with exponential backoff.
- `is_agent_available()` — Checks if agent is properly configured.
- `normalize_agent_mode()` / `list_agent_modes()` — Mode validation.

**Recommended tests:**
- Unit tests for pure functions: `normalize_agent_mode`, `list_agent_modes`, `is_agent_available`, `append_trace`, `_extract_json_object`, `_retry_delay_seconds`, `_is_retriable_response`.
- Integration tests with mocked HTTP for `_call_anthropic_json` and `_call_openai_compatible_json` — verify request construction, error handling, and retry behavior.
- End-to-end test of `run_contextual_fill_agent` with mocked LLM responses to verify the full pipeline (batching, matching, answer assignment, trace generation).

### 2. Upload Router — Question Result Endpoints Not Tested

**File:** `app/routers/upload.py`

Six route handlers have no test coverage:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/upload/{job_id}/download` | Download filled document |
| `GET /api/upload/{job_id}/questions` | List per-question results |
| `PUT /api/upload/questions/{id}` | Edit a question result |
| `POST /api/upload/questions/{id}/approve` | Approve a single result |
| `POST /api/upload/{job_id}/approve-all` | Bulk approve all results |
| `POST /api/upload/{job_id}/finalize` | Finalize job and generate output |

These represent the **review-and-approve workflow** — one of the core user-facing flows. A user uploads a document, reviews matched answers, edits/approves them, then finalizes.

**Recommended tests:**
- Full lifecycle test: upload → process → list questions → edit answer → approve → finalize → download.
- Edge cases: approve with no questions, finalize an already-finalized job, edit a non-existent result.

### 3. Utility Modules — 0% Coverage

**`app/utils/questions.py`** (2 functions, 0 tests):
- `clean_display_question()` — Strips numbering prefixes (e.g., "1. ", "a) "). Used throughout the codebase.
- `normalize_question_key()` — Creates deduplication keys. Critical for flagged question grouping.

**`app/utils/csv_files.py`** (3 functions, 0 tests):
- `detect_csv_format()` — Sniffs CSV dialect (delimiter, quoting style).
- `read_csv_rows()` / `write_csv_rows()` — Read/write with format preservation.

These are small, pure functions — easy to test and high value since bugs here silently corrupt data.

**Recommended tests:**
- `clean_display_question`: numbered items ("1. Question"), lettered items ("a) Question"), no prefix, edge cases (empty string, only whitespace).
- `normalize_question_key`: case folding, punctuation stripping, whitespace normalization.
- `detect_csv_format`: comma-delimited, semicolon-delimited, tab-delimited, quoted fields.
- `read_csv_rows`/`write_csv_rows`: round-trip test (write then read back), BOM handling, special characters.

### 4. QA Export Endpoint — Not Tested

`GET /api/qa/export` is the only QA endpoint without a direct test. Should verify CSV output format, header row, encoding, and empty-KB behavior.

### 5. Flagged Questions — Partial Gaps

- `deduplicate_flagged()` endpoint — no direct test.
- `get_flagged()` (single item) — not directly tested (only the list endpoint is tested).
- Several internal helpers (`_load_duplicate_group`, `_query_grouped_flagged`, etc.) are only indirectly exercised.

---

## Coverage Gaps (Frontend)

### No Testing Framework Configured

The frontend has no test runner, no test files, and no testing dependencies. The `package.json` contains only `next`, `react`, and `react-dom`.

### Recommended Setup

Add Jest + React Testing Library (or Vitest) and MSW (Mock Service Worker) for API mocking.

### Priority Components for Frontend Testing

#### Tier 1 — High Value

**`src/lib/api.js`** (525 lines) — The API client layer:
- `resolveApiBase()`: Multi-port discovery with health check probing and memoization.
- `apiFetch()`: Retry logic, timeout handling (1200ms), JSON error extraction.
- `uploadDocument()` / `uploadDocuments()`: FormData construction with optional fields.
- All CRUD wrappers: verify correct URL construction and parameter passing.

**`src/app/page.js`** (700+ lines) — Main upload page:
- 20+ useState hooks managing a complex multi-step workflow.
- Job polling (1.5s interval) with automatic cleanup.
- Session persistence via sessionStorage (job IDs survive page refresh).
- Question review queue with filtering, editing, and approval.
- Agent preset management via localStorage.

#### Tier 2 — Medium Value

**`src/app/admin/page.js`** (506 lines) — Knowledge base management:
- Q&A CRUD with modal forms and validation.
- CSV/JSON import with drag-and-drop.
- Search + category filtering with pagination.

**`src/app/admin/flagged/page.js`** (595 lines) — Flagged questions:
- Multi-select checkbox with select-all toggle.
- Bulk dismiss workflow.
- Filter tabs (unresolved/resolved/all) with search.

**`src/app/settings/page.js`** (520 lines) — Settings:
- Provider preset switching with cascading field updates.
- Dynamic model loading with static fallback.
- Connection testing and API key management.

#### Tier 3 — Low Value

**`src/components/Navbar.js`** (50 lines) — Simple navigation, low risk.

---

## Prioritized Recommendations

### Immediate (High Impact, Low Effort)

1. **Add unit tests for `utils/questions.py`** — Pure functions, easy to test, used everywhere.
2. **Add unit tests for `utils/csv_files.py`** — Pure functions, data integrity risk.
3. **Add unit tests for agent pure functions** — `normalize_agent_mode`, `list_agent_modes`, `is_agent_available`, `_extract_json_object`.

### Short-Term (High Impact, Medium Effort)

4. **Test the review-approve-finalize workflow** — Upload router's untested endpoints represent a core user flow.
5. **Add agent integration tests with mocked HTTP** — Test LLM call construction, retry behavior, and error handling without real API calls.
6. **Test QA export and flagged deduplication endpoints** — Close remaining API gaps.

### Medium-Term (High Impact, High Effort)

7. **Set up frontend test infrastructure** — Add Jest/Vitest + React Testing Library + MSW.
8. **Test `api.js`** — API discovery, retry logic, error handling. This is the highest-value frontend target.
9. **Test the upload page workflow** — Polling, session persistence, and review queue are complex and bug-prone.

### Long-Term

10. **Component tests for admin pages** — CRUD workflows, import/export, filtering.
11. **E2E tests** — Consider Playwright or Cypress for critical user flows (upload → review → download).
