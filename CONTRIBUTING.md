# Contributing to TrustReply

Thanks for helping improve TrustReply.

## What We Welcome

Contributions are especially useful in these areas:

- parser support for additional document layouts (DOCX, PDF, XLSX, CSV)
- PDF extraction and OCR improvements
- Excel format preservation and edge-case handling
- knowledge-base management improvements
- contradiction detection and duplicate classification enhancements
- SME routing and workflow improvements
- batch workflow and review UX
- tests, fixtures, and reproducible bug cases
- documentation and onboarding improvements

## Before You Start

- Open an issue for substantial features or architecture changes.
- For parser bugs, include a minimal example document whenever possible.
- For document samples, remove sensitive customer data before sharing.

## Development Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pytest
```

### Frontend

```bash
cd frontend
npm install
npm run build
```

### Quick Start (Both Services)

```bash
./start-backend.sh
```

## Pull Requests

Please keep pull requests focused and include:

- a short explanation of the problem
- the approach you took
- test coverage or manual verification notes
- screenshots for UI changes when useful

## Official Project vs. Public Forks

This repository is open source, so developers may use and modify it under the project license. However, only maintainers can approve and merge changes into the official TrustReply repository.

## Coding Expectations

- Preserve existing behavior unless the change intentionally modifies it.
- Add tests for parser, matcher, generator, or API behavior when possible.
- Keep user-facing changes clear and practical.
- Prefer deterministic behavior for sensitive document workflows.
- When adding Excel support, ensure format preservation (dropdowns, merged cells, data validation, styles).

## Reporting Security Issues

Please avoid opening public issues for sensitive security disclosures. Contact the maintainers privately first if you discover a vulnerability that could affect deployed users.
