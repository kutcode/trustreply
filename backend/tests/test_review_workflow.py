"""Tests for the review-approve-finalize workflow (upload router endpoints)."""

import pytest
import pytest_asyncio
from app.models import ProcessingJob, QuestionResult


@pytest_asyncio.fixture
async def job_with_questions(db_session, tmp_path):
    """Create a completed job with question results for review testing."""
    from app.config import settings

    # Ensure output dir exists
    settings.output_dir.mkdir(parents=True, exist_ok=True)

    job = ProcessingJob(
        original_filename="test.docx",
        stored_filename="stored_test.docx",
        status="done",
        total_questions=3,
        matched_questions=2,
        flagged_questions_count=1,
        review_status="pending",
    )
    db_session.add(job)
    await db_session.flush()

    questions = [
        QuestionResult(
            job_id=job.id,
            question_index=0,
            question_text="What is your company name?",
            answer_text="Acme Corp",
            confidence_score=0.95,
            source="kb_match",
            item_type="table_cell",
            location_info={"table_idx": 0, "row_idx": 0, "col_idx": 0, "answer_col_idx": 1},
            reviewed=False,
        ),
        QuestionResult(
            job_id=job.id,
            question_index=1,
            question_text="Describe your security policy",
            answer_text="We follow ISO 27001",
            confidence_score=0.82,
            source="kb_match",
            item_type="table_cell",
            location_info={"table_idx": 0, "row_idx": 1, "col_idx": 0, "answer_col_idx": 1},
            reviewed=False,
        ),
        QuestionResult(
            job_id=job.id,
            question_index=2,
            question_text="What certifications do you hold?",
            answer_text=None,
            confidence_score=0.3,
            source="unmatched",
            item_type="table_cell",
            location_info={"table_idx": 0, "row_idx": 2, "col_idx": 0, "answer_col_idx": 1},
            reviewed=False,
        ),
    ]
    for q in questions:
        db_session.add(q)
    await db_session.commit()

    return job


# ── List Question Results ────────────────────────────────────────────


async def test_list_question_results(client, job_with_questions):
    job = job_with_questions
    res = await client.get(f"/api/jobs/{job.id}/questions")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 3
    assert data["reviewed_count"] == 0
    assert data["unreviewed_count"] == 3
    assert len(data["items"]) == 3
    # Should be ordered by question_index
    assert data["items"][0]["question_text"] == "What is your company name?"
    assert data["items"][2]["question_text"] == "What certifications do you hold?"


async def test_list_question_results_job_not_found(client):
    res = await client.get("/api/jobs/9999/questions")
    assert res.status_code == 404


# ── Update Question Result ───────────────────────────────────────────


async def test_update_question_result(client, job_with_questions):
    job = job_with_questions
    # Get the question results
    res = await client.get(f"/api/jobs/{job.id}/questions")
    q_id = res.json()["items"][2]["id"]  # the unmatched one

    # Edit the answer
    res = await client.put(
        f"/api/jobs/{job.id}/questions/{q_id}",
        json={"answer_text": "SOC 2 Type II"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["edited_answer_text"] == "SOC 2 Type II"
    assert data["reviewed"] is True


async def test_update_question_result_sets_review_status(client, job_with_questions, db_session):
    job = job_with_questions
    res = await client.get(f"/api/jobs/{job.id}/questions")
    q_id = res.json()["items"][0]["id"]

    await client.put(
        f"/api/jobs/{job.id}/questions/{q_id}",
        json={"answer_text": "Updated answer"},
    )

    # Refresh job from DB
    await db_session.refresh(job)
    assert job.review_status == "in_review"


async def test_update_question_result_not_found(client, job_with_questions):
    job = job_with_questions
    res = await client.put(
        f"/api/jobs/{job.id}/questions/9999",
        json={"answer_text": "test"},
    )
    assert res.status_code == 404


async def test_update_question_result_wrong_job(client, job_with_questions, db_session):
    """Updating a question that belongs to a different job should 404."""
    job = job_with_questions
    res = await client.get(f"/api/jobs/{job.id}/questions")
    q_id = res.json()["items"][0]["id"]

    # Try with a non-existent job ID
    res = await client.put(
        f"/api/jobs/9999/questions/{q_id}",
        json={"answer_text": "test"},
    )
    assert res.status_code == 404


# ── Approve Question Result ──────────────────────────────────────────


async def test_approve_question_result(client, job_with_questions):
    job = job_with_questions
    res = await client.get(f"/api/jobs/{job.id}/questions")
    q_id = res.json()["items"][0]["id"]

    res = await client.post(f"/api/jobs/{job.id}/questions/{q_id}/approve")
    assert res.status_code == 200
    data = res.json()
    assert data["reviewed"] is True


async def test_approve_question_result_not_found(client, job_with_questions):
    job = job_with_questions
    res = await client.post(f"/api/jobs/{job.id}/questions/9999/approve")
    assert res.status_code == 404


# ── Approve All Question Results ─────────────────────────────────────


async def test_approve_all_question_results(client, job_with_questions):
    job = job_with_questions
    res = await client.post(f"/api/jobs/{job.id}/questions/approve-all")
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] == 3

    # Verify all are now reviewed
    res = await client.get(f"/api/jobs/{job.id}/questions")
    assert res.json()["reviewed_count"] == 3
    assert res.json()["unreviewed_count"] == 0


async def test_approve_all_skips_already_reviewed(client, job_with_questions):
    job = job_with_questions

    # Approve one first
    res = await client.get(f"/api/jobs/{job.id}/questions")
    q_id = res.json()["items"][0]["id"]
    await client.post(f"/api/jobs/{job.id}/questions/{q_id}/approve")

    # Approve all remaining
    res = await client.post(f"/api/jobs/{job.id}/questions/approve-all")
    assert res.json()["approved"] == 2  # only the 2 unreviewed ones


async def test_approve_all_job_not_found(client):
    res = await client.post("/api/jobs/9999/questions/approve-all")
    assert res.status_code == 404


# ── Download Result ──────────────────────────────────────────────────


async def test_download_result_job_not_found(client):
    res = await client.get("/api/jobs/9999/download")
    assert res.status_code == 404


async def test_download_result_job_not_done(client, db_session):
    job = ProcessingJob(
        original_filename="test.docx",
        stored_filename="stored.docx",
        status="processing",
    )
    db_session.add(job)
    await db_session.commit()

    res = await client.get(f"/api/jobs/{job.id}/download")
    assert res.status_code == 400
    assert "not complete" in res.json()["detail"]


async def test_download_result_no_output_file(client, db_session):
    job = ProcessingJob(
        original_filename="test.docx",
        stored_filename="stored.docx",
        status="done",
        output_filename=None,
    )
    db_session.add(job)
    await db_session.commit()

    res = await client.get(f"/api/jobs/{job.id}/download")
    assert res.status_code == 404
    assert "No output file" in res.json()["detail"]


# ── Finalize Job ─────────────────────────────────────────────────────


async def test_finalize_job_not_found(client):
    res = await client.post("/api/jobs/9999/finalize")
    assert res.status_code == 404


async def test_finalize_job_not_done(client, db_session):
    job = ProcessingJob(
        original_filename="test.docx",
        stored_filename="stored.docx",
        status="processing",
    )
    db_session.add(job)
    await db_session.commit()

    res = await client.post(f"/api/jobs/{job.id}/finalize")
    assert res.status_code == 400


async def test_finalize_job_no_questions(client, db_session):
    job = ProcessingJob(
        original_filename="test.docx",
        stored_filename="stored.docx",
        status="done",
    )
    db_session.add(job)
    await db_session.commit()

    res = await client.post(f"/api/jobs/{job.id}/finalize")
    assert res.status_code == 400
    assert "No question results" in res.json()["detail"]


async def test_finalize_job_with_docx(client, job_with_questions, make_docx):
    """Finalize a DOCX job — should regenerate the output document."""
    from app.config import settings

    job = job_with_questions

    # Create the source file that finalize needs to read
    source_path = settings.upload_dir / job.stored_filename
    source_path.parent.mkdir(parents=True, exist_ok=True)
    docx_path = make_docx([
        ("What is your company name?", ""),
        ("Describe your security policy", ""),
        ("What certifications do you hold?", ""),
    ])
    import shutil
    shutil.copy(str(docx_path), str(source_path))

    # Edit one answer before finalizing
    res = await client.get(f"/api/jobs/{job.id}/questions")
    q_id = res.json()["items"][2]["id"]
    await client.put(
        f"/api/jobs/{job.id}/questions/{q_id}",
        json={"answer_text": "SOC 2 Type II"},
    )

    res = await client.post(f"/api/jobs/{job.id}/finalize")
    assert res.status_code == 200
    data = res.json()
    assert data["review_status"] == "finalized"
    assert data["total_edited"] == 1
    assert data["output_filename"] is not None
