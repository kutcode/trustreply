"""Tests for QA export and flagged question management endpoints."""

import csv
import io
import json
import pytest
import pytest_asyncio

from app.models import FlaggedQuestion, ProcessingJob, QAPair


# ── Helpers ──────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def seeded_qa_pairs(db_session):
    """Create QA pairs without triggering embedding computation."""
    pairs = [
        QAPair(category="Security", question="Do you encrypt data at rest?", answer="Yes, AES-256"),
        QAPair(category="Security", question="Do you have a SOC 2 report?", answer="Yes, Type II"),
        QAPair(category="General", question="What is your company name?", answer="Acme Corp"),
    ]
    for p in pairs:
        db_session.add(p)
    await db_session.commit()
    return pairs


@pytest_asyncio.fixture
async def seeded_flagged(db_session):
    """Create flagged questions with a processing job."""
    job = ProcessingJob(
        original_filename="vendor_questionnaire.docx",
        stored_filename="stored_vendor.docx",
        status="done",
    )
    db_session.add(job)
    await db_session.flush()

    job2 = ProcessingJob(
        original_filename="security_review.docx",
        stored_filename="stored_security.docx",
        status="done",
    )
    db_session.add(job2)
    await db_session.flush()

    flags = [
        FlaggedQuestion(
            job_id=job.id,
            extracted_question="What is your disaster recovery plan?",
            similarity_score=0.4,
        ),
        FlaggedQuestion(
            job_id=job.id,
            extracted_question="What is your data retention policy?",
            similarity_score=0.35,
        ),
        # Duplicate question across different jobs
        FlaggedQuestion(
            job_id=job2.id,
            extracted_question="What is your disaster recovery plan?",
            similarity_score=0.38,
        ),
        # Exact duplicate within the same job
        FlaggedQuestion(
            job_id=job.id,
            extracted_question="What is your disaster recovery plan?",
            similarity_score=0.41,
        ),
    ]
    for f in flags:
        db_session.add(f)
    await db_session.commit()
    return {"job": job, "job2": job2, "flags": flags}


# ── QA Export ────────────────────────────────────────────────────────


async def test_export_qa_csv(client, seeded_qa_pairs):
    res = await client.get("/api/qa/export?format=csv")
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "knowledge_base.csv" in res.headers.get("content-disposition", "")

    reader = csv.DictReader(io.StringIO(res.text))
    rows = list(reader)
    assert len(rows) == 3
    assert set(reader.fieldnames) == {"category", "question", "answer"}


async def test_export_qa_json(client, seeded_qa_pairs):
    res = await client.get("/api/qa/export?format=json")
    assert res.status_code == 200
    assert "application/json" in res.headers["content-type"]

    data = json.loads(res.text)
    assert len(data) == 3
    assert all({"category", "question", "answer"} <= set(item.keys()) for item in data)


async def test_export_qa_csv_with_category_filter(client, seeded_qa_pairs):
    res = await client.get("/api/qa/export?format=csv&category=Security")
    assert res.status_code == 200

    reader = csv.DictReader(io.StringIO(res.text))
    rows = list(reader)
    assert len(rows) == 2
    assert all(r["category"] == "Security" for r in rows)


async def test_export_qa_json_with_category_filter(client, seeded_qa_pairs):
    res = await client.get("/api/qa/export?format=json&category=General")
    assert res.status_code == 200

    data = json.loads(res.text)
    assert len(data) == 1
    assert data[0]["question"] == "What is your company name?"


async def test_export_qa_empty_kb(client):
    res = await client.get("/api/qa/export?format=csv")
    assert res.status_code == 200

    reader = csv.DictReader(io.StringIO(res.text))
    rows = list(reader)
    assert len(rows) == 0


# ── Get Single Flagged Question ──────────────────────────────────────


async def test_get_flagged_single(client, seeded_flagged):
    flag_id = seeded_flagged["flags"][0].id
    res = await client.get(f"/api/flagged/{flag_id}")
    assert res.status_code == 200
    data = res.json()
    assert "disaster recovery" in data["extracted_question"].lower()
    assert data["resolved"] is False


async def test_get_flagged_not_found(client):
    res = await client.get("/api/flagged/9999")
    assert res.status_code == 404


# ── Dismiss Single Flagged ───────────────────────────────────────────


async def test_dismiss_flagged_single(client, seeded_flagged):
    flag_id = seeded_flagged["flags"][0].id
    res = await client.post(f"/api/flagged/{flag_id}/dismiss")
    assert res.status_code == 200
    data = res.json()
    assert data["resolved"] is True
    assert data["resolved_answer"] == "[Dismissed]"


async def test_dismiss_flagged_resolves_duplicate_group(client, seeded_flagged):
    """Dismissing one question should dismiss all duplicates across jobs."""
    flag_id = seeded_flagged["flags"][0].id  # "disaster recovery plan"
    res = await client.post(f"/api/flagged/{flag_id}/dismiss")
    assert res.status_code == 200

    # The duplicate in job2 (flags[2]) should also be resolved
    dup_id = seeded_flagged["flags"][2].id
    res2 = await client.get(f"/api/flagged/{dup_id}")
    assert res2.status_code == 200
    assert res2.json()["resolved"] is True


async def test_dismiss_flagged_not_found(client):
    res = await client.post("/api/flagged/9999/dismiss")
    assert res.status_code == 404


async def test_dismiss_flagged_already_resolved(client, seeded_flagged, db_session):
    """Dismissing an already-resolved question should return 400."""
    flag = seeded_flagged["flags"][1]
    flag.resolved = True
    await db_session.commit()

    res = await client.post(f"/api/flagged/{flag.id}/dismiss")
    assert res.status_code == 400
    assert "Already resolved" in res.json()["detail"]


# ── Deduplicate Flagged ──────────────────────────────────────────────


async def test_deduplicate_flagged(client, seeded_flagged):
    # We have 4 flags: 2 unique questions + 2 duplicates of "disaster recovery"
    res = await client.post("/api/flagged/deduplicate")
    assert res.status_code == 200
    data = res.json()
    assert data["total_before"] == 4
    assert data["duplicates_removed"] >= 1  # at least the same-job duplicate
    assert data["total_after"] == data["total_before"] - data["duplicates_removed"]


async def test_deduplicate_flagged_no_duplicates(client, db_session):
    """When there are no duplicates, nothing should be removed."""
    job = ProcessingJob(
        original_filename="test.docx",
        stored_filename="stored.docx",
        status="done",
    )
    db_session.add(job)
    await db_session.flush()

    db_session.add(FlaggedQuestion(
        job_id=job.id,
        extracted_question="Unique question A?",
    ))
    db_session.add(FlaggedQuestion(
        job_id=job.id,
        extracted_question="Unique question B?",
    ))
    await db_session.commit()

    res = await client.post("/api/flagged/deduplicate")
    assert res.status_code == 200
    data = res.json()
    assert data["duplicates_removed"] == 0
    assert data["total_before"] == data["total_after"]


async def test_deduplicate_flagged_empty(client):
    """Deduplication on empty table should succeed."""
    res = await client.post("/api/flagged/deduplicate")
    assert res.status_code == 200
    data = res.json()
    assert data["total_before"] == 0
    assert data["duplicates_removed"] == 0
