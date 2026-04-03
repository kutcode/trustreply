"""API integration tests."""

import csv
import io
import json
import zipfile
from docx import Document as DocxDocument

from app.config import settings
from app.models import FlaggedQuestion, ProcessingJob


async def test_health_check(client):
    res = await client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"


async def test_get_settings(client):
    res = await client.get("/api/settings")
    assert res.status_code == 200
    data = res.json()
    assert "similarity_threshold" in data
    assert "embedding_model" in data
    assert "default_parser_profile" in data
    assert data["max_bulk_files"] == 50
    assert isinstance(data["parser_profiles"], list)
    assert "agent_available" in data
    assert "agent_modes" in data
    assert isinstance(data["agent_modes"], list)


async def test_list_agent_models_requires_api_key(client):
    res = await client.post(
        "/api/settings/models",
        json={
            "provider": "openai",
            "api_base": "https://api.openai.com/v1",
        },
    )
    assert res.status_code == 400
    assert "API key is required" in res.json()["detail"]


async def test_list_agent_models_rejects_unknown_provider(client):
    res = await client.post(
        "/api/settings/models",
        json={
            "provider": "unknown-provider",
            "api_base": "https://example.com",
            "api_key": "dummy",
        },
    )
    assert res.status_code == 400
    assert "Unsupported provider" in res.json()["detail"]


# ── Q&A CRUD ──────────────────────────────────────────────────────

async def test_list_qa_pairs_empty(client):
    res = await client.get("/api/qa")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []
    assert data["total"] == 0


async def test_create_qa_pair(client):
    res = await client.post("/api/qa", json={
        "question": "What is your company name?",
        "answer": "Acme Corporation",
        "category": "General",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["question"] == "What is your company name?"
    assert data["answer"] == "Acme Corporation"
    assert data["category"] == "General"
    assert "id" in data


async def test_list_qa_pairs_with_data(client):
    # Create two pairs
    await client.post("/api/qa", json={"category": "General", "question": "Q1?", "answer": "A1"})
    await client.post("/api/qa", json={"category": "Security", "question": "Q2?", "answer": "A2"})

    res = await client.get("/api/qa")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2


async def test_update_qa_pair(client):
    # Create
    create_res = await client.post("/api/qa", json={
        "category": "General",
        "question": "Original question?",
        "answer": "Original answer",
    })
    qa_id = create_res.json()["id"]

    # Update
    res = await client.put(f"/api/qa/{qa_id}", json={
        "answer": "Updated answer",
    })
    assert res.status_code == 200
    assert res.json()["answer"] == "Updated answer"


async def test_delete_qa_pair(client):
    create_res = await client.post("/api/qa", json={
        "category": "General",
        "question": "To be deleted?",
        "answer": "Temporary",
    })
    qa_id = create_res.json()["id"]

    res = await client.delete(f"/api/qa/{qa_id}")
    assert res.status_code == 200

    # Verify it's gone
    list_res = await client.get("/api/qa")
    ids = [item["id"] for item in list_res.json()["items"]]
    assert qa_id not in ids


async def test_search_qa_pairs(client):
    await client.post("/api/qa", json={"category": "Security", "question": "What is encryption?", "answer": "AES-256"})
    await client.post("/api/qa", json={"category": "General", "question": "Company address?", "answer": "123 Main St"})

    res = await client.get("/api/qa", params={"search": "encryption"})
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert "encryption" in data["items"][0]["question"].lower()


async def test_list_categories(client):
    await client.post("/api/qa", json={
        "question": "Q1?", "answer": "A1", "category": "Security",
    })
    await client.post("/api/qa", json={
        "question": "Q2?", "answer": "A2", "category": "Compliance",
    })

    res = await client.get("/api/qa/categories")
    assert res.status_code == 200
    categories = res.json()["categories"]
    assert "Security" in categories
    assert "Compliance" in categories


async def test_create_qa_pair_requires_category(client):
    res = await client.post("/api/qa", json={
        "question": "Missing category?",
        "answer": "Nope",
    })
    assert res.status_code == 422


# ── Import ────────────────────────────────────────────────────────

async def test_import_csv(client):
    csv_content = "category,question,answer\nGeneral,What is your name?,Acme\nSecurity,Do you encrypt?,Yes"
    files = {"file": ("import.csv", csv_content.encode(), "text/csv")}
    res = await client.post("/api/qa/import", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["imported"] == 2
    assert data["total_rows"] == 2


async def test_import_json(client):
    json_content = json.dumps([
        {"category": "General", "question": "Who are you?", "answer": "Acme"},
    ])
    files = {"file": ("import.json", json_content.encode(), "application/json")}
    res = await client.post("/api/qa/import", files=files)
    assert res.status_code == 200
    assert res.json()["imported"] == 1


async def test_import_csv_with_errors(client):
    csv_content = "category,question,answer\n,missing question,\nGeneral,Valid?,Valid"
    files = {"file": ("import.csv", csv_content.encode(), "text/csv")}
    res = await client.post("/api/qa/import", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["imported"] == 1
    assert len(data["errors"]) == 1
    assert "missing category, question, or answer" in data["errors"][0]


async def test_import_csv_accepts_bom_and_header_case_variants(client):
    csv_content = "\ufeffCategory,Question,Answer\nSecurity,Do you encrypt data at rest?,Yes"
    files = {"file": ("import.csv", csv_content.encode("utf-8"), "text/csv")}
    res = await client.post("/api/qa/import", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["imported"] == 1
    assert data["total_rows"] == 1


async def test_import_json_skips_null_fields(client):
    json_content = json.dumps(
        [
            {"category": "General", "question": "Valid question?", "answer": "Valid answer"},
            {"category": "General", "question": "Missing answer?", "answer": None},
        ]
    )
    files = {"file": ("import.json", json_content.encode(), "application/json")}
    res = await client.post("/api/qa/import", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["imported"] == 1
    assert data["total_rows"] == 2
    assert len(data["errors"]) == 1
    assert "missing category, question, or answer" in data["errors"][0]


# ── Upload & Jobs ─────────────────────────────────────────────────

async def test_upload_invalid_type(client):
    files = {"file": ("test.txt", b"hello world", "text/plain")}
    res = await client.post("/api/upload", files=files)
    assert res.status_code == 400
    assert "Unsupported" in res.json()["detail"]


async def test_upload_invalid_parser_profile(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("questionnaire.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post("/api/upload", files=files, data={"parser_profile": "does-not-exist"})
    assert res.status_code == 400
    assert "Unknown parser profile" in res.json()["detail"]


async def test_upload_invalid_agent_mode(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("questionnaire.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post("/api/upload", files=files, data={"agent_mode": "invalid-mode"})
    assert res.status_code == 400
    assert "Unknown agent mode" in res.json()["detail"]


async def test_upload_agent_mode_requires_config(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("questionnaire.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post("/api/upload", files=files, data={"agent_mode": "agent"})
    assert res.status_code == 200
    # Agent mode is stored as requested; availability is checked during background processing.
    assert res.json()["agent_mode"] == "agent"


async def test_upload_agent_mode_backward_compat_assist(client, make_docx):
    """Old 'assist' mode is aliased to 'agent' for backward compatibility."""
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("questionnaire.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post("/api/upload", files=files, data={"agent_mode": "assist"})
    assert res.status_code == 200
    assert res.json()["agent_mode"] == "agent"


async def test_upload_agent_mode_accepts_custom_runtime_config(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("questionnaire.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post(
            "/api/upload",
            files=files,
            data={
                "agent_mode": "agent",
                "agent_provider": "ollama",
                "agent_api_base": "http://127.0.0.1:11434/v1",
                "agent_api_key": "local",
                "agent_model": "qwen2.5:7b",
            },
        )
    assert res.status_code == 200
    data = res.json()
    assert data["agent_mode"] == "agent"


async def test_upload_docx_creates_job(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("questionnaire.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post("/api/upload", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "pending"
    assert data["original_filename"] == "questionnaire.docx"
    assert data["parser_profile_name"] == "default"
    assert data["agent_mode"] == "agent"
    assert data["batch_id"] is None
    assert "id" in data


async def test_upload_csv_creates_job(client, make_csv):
    path = make_csv([
        ["Question", "Answer"],
        ["What is your company name?", ""],
    ])
    with open(path, "rb") as f:
        files = {"file": ("questionnaire.csv", f, "text/csv")}
        res = await client.post("/api/upload", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "pending"
    assert data["original_filename"] == "questionnaire.csv"


async def test_troubleshoot_docx_returns_profile_diagnostics(client, tmp_path):
    doc = DocxDocument()
    table = doc.add_table(rows=2, cols=4)
    table.rows[0].cells[0].text = "Domain"
    table.rows[0].cells[1].text = "Ref"
    table.rows[0].cells[2].text = "Question"
    table.rows[0].cells[3].text = "Response"
    table.rows[1].cells[0].text = "Security"
    table.rows[1].cells[1].text = "R01"
    table.rows[1].cells[2].text = "Describe your incident response process."
    table.rows[1].cells[3].text = ""

    path = tmp_path / "troubleshoot.docx"
    doc.save(str(path))

    with open(path, "rb") as f:
        files = {"file": ("troubleshoot.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post("/api/troubleshoot", files=files)

    assert res.status_code == 200
    data = res.json()
    assert data["filename"] == "troubleshoot.docx"
    assert data["recommended_profile"] == "default"
    assert "best fit" in data["recommendation_reason"].lower()
    profiles = {profile["profile_name"]: profile for profile in data["profiles"]}
    assert profiles["default"]["question_count"] == 1
    assert profiles["default"]["sample_questions"] == ["Describe your incident response process."]


async def test_troubleshoot_docx_reports_no_questions_found(client, make_docx):
    path = make_docx([])
    with open(path, "rb") as f:
        files = {"file": ("empty.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        res = await client.post("/api/troubleshoot", files=files)

    assert res.status_code == 200
    data = res.json()
    assert data["recommended_profile"] is None
    assert "no parser profile" in data["recommendation_reason"].lower()
    assert any("no parser profile found any questions" in hint.lower() for hint in data["hints"])


async def test_troubleshoot_csv_returns_profile_diagnostics(client, make_csv):
    path = make_csv([
        ["Domain", "Question", "Response"],
        ["Security", "Describe your incident response process.", ""],
    ], filename="troubleshoot.csv")

    with open(path, "rb") as f:
        files = {"file": ("troubleshoot.csv", f, "text/csv")}
        res = await client.post("/api/troubleshoot", files=files)

    assert res.status_code == 200
    data = res.json()
    assert data["filename"] == "troubleshoot.csv"
    assert data["file_type"] == "csv"
    profiles = {profile["profile_name"]: profile for profile in data["profiles"]}
    assert profiles["default"]["question_count"] == 1


async def test_troubleshoot_agent_analysis_skipped_when_unconfigured(client, make_csv):
    path = make_csv(
        [
            ["Domain", "Question", "Response"],
            ["Security", "Describe your incident response process.", ""],
        ],
        filename="agent_troubleshoot.csv",
    )
    with open(path, "rb") as f:
        files = {"file": ("agent_troubleshoot.csv", f, "text/csv")}
        res = await client.post(
            "/api/troubleshoot",
            files=files,
            data={"analyze_with_agent": "true"},
        )

    assert res.status_code == 200
    data = res.json()
    assert isinstance(data["agent_analysis"], dict)
    assert data["agent_analysis"]["status"] == "skipped"
    fix_plan = data["agent_analysis"].get("fix_plan")
    assert isinstance(fix_plan, dict)
    assert fix_plan["can_auto_apply"] is False
    assert fix_plan["action"] == "manual_follow_up"


async def test_bulk_upload_creates_grouped_jobs(client, make_docx):
    first_path = make_docx([("What is your company name?", "")])
    second_path = make_docx([("Describe your security policy.", "")])

    with open(first_path, "rb") as first_file, open(second_path, "rb") as second_file:
        files = [
            ("files", ("first.docx", first_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
            ("files", ("second.docx", second_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ]
        res = await client.post("/api/upload/bulk", files=files)

    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2
    assert data["batch_id"]
    assert {item["original_filename"] for item in data["items"]} == {"first.docx", "second.docx"}
    assert all(item["batch_id"] == data["batch_id"] for item in data["items"])


async def test_bulk_upload_rejects_more_than_max_files(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    payload = path.read_bytes()
    files = [
        (
            "files",
            (f"questionnaire_{index}.docx", payload, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        )
        for index in range(51)
    ]

    res = await client.post("/api/upload/bulk", files=files)
    assert res.status_code == 400
    assert "up to 50 files" in res.json()["detail"]


async def test_get_job_batch_returns_matching_jobs(client, make_docx):
    first_path = make_docx([("What is your company name?", "")])
    second_path = make_docx([("Describe your security policy.", "")])

    with open(first_path, "rb") as first_file, open(second_path, "rb") as second_file:
        files = [
            ("files", ("first.docx", first_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
            ("files", ("second.docx", second_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ]
        upload_res = await client.post("/api/upload/bulk", files=files)

    batch_id = upload_res.json()["batch_id"]
    res = await client.get(f"/api/jobs/batch/{batch_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["batch_id"] == batch_id
    assert data["total"] == 2
    assert len(data["items"]) == 2


async def test_download_job_batch_returns_zip(client, db_session, make_docx):
    first_path = make_docx([("What is your company name?", "")], filename="first.docx")
    second_path = make_docx([("Describe your security policy.", "")], filename="second.docx")

    with open(first_path, "rb") as first_file, open(second_path, "rb") as second_file:
        files = [
            ("files", ("first.docx", first_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
            ("files", ("second.docx", second_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ]
        upload_res = await client.post("/api/upload/bulk", files=files)

    batch = upload_res.json()
    for item in batch["items"]:
        output_filename = f"test_output_{item['id']}.docx"
        output_path = settings.output_dir / output_filename
        output_path.write_bytes(b"fake docx bytes")

        job = await db_session.get(ProcessingJob, item["id"])
        job.status = "done"
        job.output_filename = output_filename

    await db_session.commit()

    res = await client.get(f"/api/jobs/batch/{batch['batch_id']}/download")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/zip")

    archive = zipfile.ZipFile(io.BytesIO(res.content))
    assert sorted(archive.namelist()) == ["filled_first.docx", "filled_second.docx"]

    for item in batch["items"]:
        output_path = settings.output_dir / f"test_output_{item['id']}.docx"
        if output_path.exists():
            output_path.unlink()


async def test_list_jobs(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("q.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        await client.post("/api/upload", files=files)

    res = await client.get("/api/jobs")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 1


async def test_get_job(client, make_docx):
    path = make_docx([("What is your company name?", "")])
    with open(path, "rb") as f:
        files = {"file": ("q.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        upload_res = await client.post("/api/upload", files=files)
    job_id = upload_res.json()["id"]

    res = await client.get(f"/api/jobs/{job_id}")
    assert res.status_code == 200
    assert res.json()["id"] == job_id


async def test_get_job_not_found(client):
    res = await client.get("/api/jobs/9999")
    assert res.status_code == 404


# ── Flagged Questions ─────────────────────────────────────────────

async def test_list_flagged_empty(client):
    res = await client.get("/api/flagged")
    assert res.status_code == 200
    assert res.json()["total"] == 0


async def test_list_flagged_groups_duplicate_questions(client, db_session):
    first_job = ProcessingJob(
        original_filename="first.docx",
        stored_filename="first_stored.docx",
        status="done",
    )
    second_job = ProcessingJob(
        original_filename="second.docx",
        stored_filename="second_stored.docx",
        status="done",
    )
    db_session.add_all([first_job, second_job])
    await db_session.commit()
    await db_session.refresh(first_job)
    await db_session.refresh(second_job)

    db_session.add_all([
        FlaggedQuestion(
            job_id=first_job.id,
            extracted_question="1. Describe your disaster recovery plan.",
            similarity_score=0.42,
            best_match_question="Describe your disaster recovery plan.",
            resolved=False,
        ),
        FlaggedQuestion(
            job_id=second_job.id,
            extracted_question="Describe your disaster recovery plan.",
            similarity_score=0.41,
            best_match_question="Describe your disaster recovery plan.",
            resolved=False,
        ),
    ])
    await db_session.commit()

    res = await client.get("/api/flagged", params={"resolved": False})
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["occurrence_count"] == 2
    assert item["extracted_question"] == "Describe your disaster recovery plan."
    assert set(item["filenames"]) == {"first.docx", "second.docx"}


async def test_resolve_flagged_resolves_duplicate_group(client, db_session):
    first_job = ProcessingJob(
        original_filename="first.docx",
        stored_filename="first_stored.docx",
        status="done",
    )
    second_job = ProcessingJob(
        original_filename="second.docx",
        stored_filename="second_stored.docx",
        status="done",
    )
    db_session.add_all([first_job, second_job])
    await db_session.commit()
    await db_session.refresh(first_job)
    await db_session.refresh(second_job)

    first_flag = FlaggedQuestion(
        job_id=first_job.id,
        extracted_question="1. Describe your disaster recovery plan.",
        similarity_score=0.42,
        best_match_question="Describe your disaster recovery plan.",
        resolved=False,
    )
    second_flag = FlaggedQuestion(
        job_id=second_job.id,
        extracted_question="Describe your disaster recovery plan.",
        similarity_score=0.41,
        best_match_question="Describe your disaster recovery plan.",
        resolved=False,
    )
    db_session.add_all([first_flag, second_flag])
    await db_session.commit()
    await db_session.refresh(first_flag)
    await db_session.refresh(second_flag)

    res = await client.post(
        f"/api/flagged/{first_flag.id}/resolve",
        json={
            "answer": "We maintain a documented recovery plan.",
            "add_to_knowledge_base": False,
            "category": None,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["occurrence_count"] == 2

    await db_session.refresh(first_flag)
    await db_session.refresh(second_flag)
    assert first_flag.resolved is True
    assert second_flag.resolved is True
    assert first_flag.resolved_answer == "We maintain a documented recovery plan."
    assert second_flag.resolved_answer == "We maintain a documented recovery plan."


async def test_bulk_dismiss_flagged_resolves_selected_groups(client, db_session):
    first_job = ProcessingJob(
        original_filename="first.docx",
        stored_filename="first_stored.docx",
        status="done",
    )
    second_job = ProcessingJob(
        original_filename="second.docx",
        stored_filename="second_stored.docx",
        status="done",
    )
    third_job = ProcessingJob(
        original_filename="third.docx",
        stored_filename="third_stored.docx",
        status="done",
    )
    db_session.add_all([first_job, second_job, third_job])
    await db_session.commit()
    await db_session.refresh(first_job)
    await db_session.refresh(second_job)
    await db_session.refresh(third_job)

    group_a_first = FlaggedQuestion(
        job_id=first_job.id,
        extracted_question="Describe your disaster recovery plan.",
        resolved=False,
    )
    group_a_second = FlaggedQuestion(
        job_id=second_job.id,
        extracted_question="1. Describe your disaster recovery plan.",
        resolved=False,
    )
    group_b = FlaggedQuestion(
        job_id=third_job.id,
        extracted_question="Do you encrypt data in transit?",
        resolved=False,
    )
    db_session.add_all([group_a_first, group_a_second, group_b])
    await db_session.commit()
    await db_session.refresh(group_a_first)
    await db_session.refresh(group_a_second)
    await db_session.refresh(group_b)

    res = await client.post(
        "/api/flagged/dismiss-bulk",
        json={"ids": [group_a_first.id, group_b.id, 999999]},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["requested_ids"] == 3
    assert data["dismissed_groups"] == 2
    assert data["dismissed_occurrences"] == 3
    assert data["already_resolved_groups"] == 0
    assert 999999 in data["not_found_ids"]

    await db_session.refresh(group_a_first)
    await db_session.refresh(group_a_second)
    await db_session.refresh(group_b)
    assert group_a_first.resolved is True
    assert group_a_second.resolved is True
    assert group_b.resolved is True
    assert group_a_first.resolved_answer == "[Dismissed]"
    assert group_a_second.resolved_answer == "[Dismissed]"
    assert group_b.resolved_answer == "[Dismissed]"


async def test_sync_flagged_resolves_questions_now_in_knowledge_base(client, db_session):
    qa_res = await client.post("/api/qa", json={
        "category": "Business Continuity",
        "question": "Describe your disaster recovery plan.",
        "answer": "We maintain a documented recovery plan.",
    })
    assert qa_res.status_code == 200

    first_job = ProcessingJob(
        original_filename="first.docx",
        stored_filename="first_stored.docx",
        status="done",
    )
    second_job = ProcessingJob(
        original_filename="second.docx",
        stored_filename="second_stored.docx",
        status="done",
    )
    db_session.add_all([first_job, second_job])
    await db_session.commit()
    await db_session.refresh(first_job)
    await db_session.refresh(second_job)

    first_flag = FlaggedQuestion(
        job_id=first_job.id,
        extracted_question="1. Describe your disaster recovery plan.",
        similarity_score=0.42,
        best_match_question="Describe your disaster recovery plan.",
        resolved=False,
    )
    second_flag = FlaggedQuestion(
        job_id=second_job.id,
        extracted_question="Describe your disaster recovery plan.",
        similarity_score=0.41,
        best_match_question="Describe your disaster recovery plan.",
        resolved=False,
    )
    third_flag = FlaggedQuestion(
        job_id=second_job.id,
        extracted_question="How do you evaluate fourth-party risk disclosures?",
        similarity_score=0.35,
        best_match_question="Describe your third-party risk management process.",
        resolved=False,
    )
    db_session.add_all([first_flag, second_flag, third_flag])
    await db_session.commit()

    res = await client.post("/api/flagged/sync")
    assert res.status_code == 200
    data = res.json()
    assert data["scanned_occurrences"] == 3
    assert data["synced_occurrences"] == 2
    assert data["synced_groups"] == 1
    assert data["remaining_unresolved"] == 1

    await db_session.refresh(first_flag)
    await db_session.refresh(second_flag)
    await db_session.refresh(third_flag)
    assert first_flag.resolved is True
    assert second_flag.resolved is True
    assert third_flag.resolved is False
    assert first_flag.resolved_answer == "We maintain a documented recovery plan."
    assert second_flag.resolved_answer == "We maintain a documented recovery plan."


async def test_export_flagged_csv_returns_import_ready_template(client, db_session):
    qa_res = await client.post("/api/qa", json={
        "category": "Business Continuity",
        "question": "Describe your disaster recovery plan.",
        "answer": "We maintain a documented recovery plan.",
    })
    assert qa_res.status_code == 200

    first_job = ProcessingJob(
        original_filename="first.docx",
        stored_filename="first_stored.docx",
        status="done",
    )
    second_job = ProcessingJob(
        original_filename="second.docx",
        stored_filename="second_stored.docx",
        status="done",
    )
    db_session.add_all([first_job, second_job])
    await db_session.commit()
    await db_session.refresh(first_job)
    await db_session.refresh(second_job)

    db_session.add_all([
        FlaggedQuestion(
            job_id=first_job.id,
            extracted_question="1. Describe your disaster recovery plan.",
            similarity_score=0.42,
            best_match_question="Describe your disaster recovery plan.",
            resolved=False,
        ),
        FlaggedQuestion(
            job_id=second_job.id,
            extracted_question="Describe your disaster recovery plan.",
            similarity_score=0.41,
            best_match_question="Describe your disaster recovery plan.",
            resolved=False,
        ),
    ])
    await db_session.commit()

    res = await client.get("/api/flagged/export")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")

    rows = list(csv.DictReader(io.StringIO(res.text)))
    assert len(rows) == 1
    row = rows[0]
    assert list(row.keys()) == ["category", "question", "answer"]
    assert row["category"] == ""
    assert row["question"] == "Describe your disaster recovery plan."
    assert row["answer"] == ""
