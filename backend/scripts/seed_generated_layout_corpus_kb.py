#!/usr/bin/env python3
"""Create and seed a knowledge-base file for the generated layout corpus."""

from __future__ import annotations

import csv
import datetime as dt
import sqlite3
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
CORPUS_DIR = PROJECT_ROOT / "test-data" / "generated-layout-corpus"
CSV_PATH = CORPUS_DIR / "knowledge_base_generated_layout_corpus.csv"

sys.path.insert(0, str(BACKEND_DIR))

from app.config import settings
from app.utils.embeddings import compute_embeddings, embedding_to_bytes


THEMES: dict[str, dict[str, object]] = {
    "security": {
        "category": "Security",
        "questions": [
            (
                "Describe your endpoint protection program.",
                "All corporate endpoints run centrally managed EDR, full-disk encryption, host firewalls, and weekly compliance checks. Noncompliant devices are quarantined until remediated.",
            ),
            (
                "How do you manage privileged access across production systems?",
                "Privileged access is granted through role-based groups, protected by MFA, and limited to approved administrators. Administrative sessions are logged and reviewed, and elevated access is removed promptly when no longer needed.",
            ),
            (
                "Describe your vulnerability management lifecycle.",
                "We scan internal and external assets continuously, triage findings by severity and exploitability, and track remediation to closure in a ticketing workflow. Critical issues are prioritized for immediate action and verified after patching.",
            ),
            (
                "How do you monitor for suspicious activity in your environment?",
                "Centralized logging from endpoints, cloud services, and infrastructure is analyzed in our security monitoring platform with alerting for anomalous behavior. Alerts are triaged by the security team and investigated according to runbooks.",
            ),
            (
                "Describe your incident response process.",
                "Our incident response process covers detection, triage, containment, eradication, recovery, and post-incident review. Roles, escalation paths, communication steps, and evidence-handling requirements are documented and exercised.",
            ),
            (
                "How do you secure laptops and mobile devices used by employees?",
                "Employee laptops and mobile devices are enrolled in device management, require encryption and screen-lock policies, and use centrally managed endpoint protection. Lost or noncompliant devices can be remotely locked or wiped.",
            ),
        ],
        "labels": [
            ("Company Name:", "Northwind Security Labs"),
            ("Security Contact Name:", "Jordan Patel"),
            ("Security Contact Email:", "security@northwind.example"),
        ],
    },
    "privacy": {
        "category": "Privacy",
        "questions": [
            (
                "Describe your personal data retention policy.",
                "We maintain a documented retention schedule that maps data categories to business purpose, legal requirements, and deletion timelines. Personal data is deleted or anonymized when retention periods expire unless a lawful hold applies.",
            ),
            (
                "How do you respond to data subject access requests?",
                "Data subject requests are logged in a central workflow, verified for identity, reviewed by the privacy team, and completed within defined service-level targets. We track request type, due date, and fulfillment evidence for audit purposes.",
            ),
            (
                "Describe your lawful basis review process for processing personal data.",
                "Each processing activity is assessed for lawful basis during onboarding and material changes. The privacy team reviews the basis, records the decision in our data inventory, and confirms required notices and controls are in place.",
            ),
            (
                "How do you manage subprocessors that access customer data?",
                "Subprocessors are reviewed through security and privacy due diligence, approved contractually before use, and tracked in an internal register. We require data protection commitments, monitor changes, and reassess higher-risk providers periodically.",
            ),
            (
                "Describe your deletion workflow for customer records.",
                "Deletion requests flow through a documented process that identifies affected systems, executes deletion or anonymization tasks, and records completion evidence. Exceptions such as legal holds are reviewed and communicated before closure.",
            ),
            (
                "How do you monitor compliance with privacy obligations?",
                "We review privacy obligations through periodic control checks, data inventory updates, training completion, and issue tracking. Findings are assigned owners, remediated through the governance program, and reported to leadership.",
            ),
        ],
        "labels": [
            ("Legal Entity Name:", "Northwind Data Services LLC"),
            ("Privacy Contact Name:", "Maya Chen"),
            ("Privacy Contact Email:", "privacy@northwind.example"),
        ],
    },
    "operations": {
        "category": "Operations",
        "questions": [
            (
                "Describe your change management process.",
                "Production changes are requested through a ticketed workflow, reviewed for risk, approved by designated owners, and scheduled with rollback steps documented in advance. Emergency changes are logged separately and reviewed after implementation.",
            ),
            (
                "How do you manage production deployments?",
                "Deployments are executed through a CI/CD pipeline with automated testing, peer approval, and controlled promotion into production. Release status, deployment logs, and rollback procedures are captured for each change window.",
            ),
            (
                "Describe your service monitoring approach.",
                "We monitor service health with metrics, logs, synthetics, and alert thresholds for availability, latency, and error rates. On-call responders use dashboards and runbooks to investigate and restore degraded services quickly.",
            ),
            (
                "How do you track and resolve service incidents?",
                "Incidents are logged in an incident management platform, assigned severity, and coordinated through an on-call process until resolution. Root cause, customer impact, and follow-up actions are documented in post-incident reviews.",
            ),
            (
                "Describe your backup verification process.",
                "Backups are monitored for successful completion and verified through scheduled restore testing against representative systems. Exceptions are tracked to closure and restore results are reviewed by operations leadership.",
            ),
            (
                "How do you manage access for third-party support personnel?",
                "Third-party support access is approved by service owners, limited to the minimum necessary scope, and protected by MFA and logging. Temporary access is time-bounded and removed once the support activity is complete.",
            ),
        ],
        "labels": [
            ("Operating Entity Name:", "Northwind Cloud Operations"),
            ("Operations Contact Name:", "Riley Morgan"),
            ("Operations Contact Email:", "operations@northwind.example"),
        ],
    },
    "continuity": {
        "category": "Business Continuity",
        "questions": [
            (
                "Describe your disaster recovery plan.",
                "Our disaster recovery plan defines critical services, recovery owners, backup dependencies, and step-by-step restoration procedures for major outage scenarios. The plan is version-controlled and reviewed at least annually.",
            ),
            (
                "How do you test business continuity procedures?",
                "Business continuity procedures are tested through tabletop exercises and scenario-based recovery drills. Outcomes, gaps, and corrective actions are documented and tracked through the resilience program.",
            ),
            (
                "Describe your recovery time and recovery point objectives.",
                "Recovery time and recovery point objectives are defined for critical services based on business impact analysis and technical architecture. These targets are reviewed during continuity planning and validated during testing.",
            ),
            (
                "How do you ensure availability during infrastructure failures?",
                "Availability is supported through redundancy across critical components, failover procedures, and capacity monitoring. Infrastructure incidents trigger escalation workflows to restore service within continuity targets.",
            ),
            (
                "Describe your crisis communication process.",
                "The crisis communication process defines internal responders, executive escalation, customer communications, and approved notification channels. Templates and contact trees are maintained so updates can be issued quickly during disruptive events.",
            ),
            (
                "How do you restore critical services after a disruptive event?",
                "Critical services are restored using documented recovery runbooks that prioritize dependencies, validate data integrity, and confirm service readiness before returning to normal operations. Recovery progress is coordinated by the incident or continuity lead.",
            ),
        ],
        "labels": [
            ("Entity Name:", "Northwind Resilience Group"),
            ("Continuity Contact Name:", "Sam Rivera"),
            ("Continuity Contact Email:", "continuity@northwind.example"),
        ],
    },
    "vendor": {
        "category": "Vendor Management",
        "questions": [
            (
                "Describe your third-party risk management process.",
                "Third-party vendors are classified by risk, assessed before onboarding, and re-evaluated on a recurring schedule based on service criticality. Findings are tracked with owners until required remediation is complete.",
            ),
            (
                "How do you review and onboard critical vendors?",
                "Critical vendors complete security, privacy, and legal review before they are approved for production use. Required controls, contract terms, and stakeholder approvals are documented in the onboarding record.",
            ),
            (
                "Describe your vendor contract security review workflow.",
                "Vendor contracts are reviewed for security and privacy requirements, including confidentiality, breach notification, and subcontractor obligations. Exceptions are escalated for risk acceptance before execution.",
            ),
            (
                "How do you monitor vendor performance and compliance?",
                "Vendor performance is monitored through service reviews, issue tracking, renewal checkpoints, and evidence updates for critical controls. Material concerns are escalated to the vendor owner and procurement stakeholders.",
            ),
            (
                "Describe your offboarding process for third-party service providers.",
                "Offboarding requires access removal, asset or credential revocation, data return or deletion confirmation, and updates to the vendor inventory. Completion evidence is captured before the provider record is closed.",
            ),
            (
                "How do you assess vendor incidents that affect customer services?",
                "Vendor incidents are triaged for customer impact, contractual notification requirements, and compensating controls. We coordinate with the vendor, track remediation steps, and communicate status updates through the incident management process.",
            ),
        ],
        "labels": [
            ("Vendor Legal Name:", "Northwind Vendor Management LLC"),
            ("Primary Contact Name:", "Alex Gomez"),
            ("Primary Contact Email:", "vendors@northwind.example"),
        ],
    },
}


def build_rows() -> list[dict[str, str]]:
    """Build flat CSV/import rows for the generated corpus prompts."""

    rows: list[dict[str, str]] = []
    for theme in THEMES.values():
        category = str(theme["category"])
        questions = theme["questions"]
        labels = theme["labels"]

        for index, (question, answer) in enumerate(questions, start=1):
            rows.append({"category": category, "question": question, "answer": answer})
            rows.append(
                {
                    "category": category,
                    "question": f"{index}. {question}",
                    "answer": answer,
                }
            )

        for question, answer in labels:
            rows.append({"category": category, "question": question, "answer": answer})

    return rows


def write_csv(rows: list[dict[str, str]]) -> None:
    """Write a reusable CSV import file next to the generated documents."""

    with CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["category", "question", "answer"])
        writer.writeheader()
        writer.writerows(rows)


def seed_database(rows: list[dict[str, str]]) -> int:
    """Insert missing generated-corpus questions into the local SQLite database."""

    db_path = Path(settings.base_dir) / "questionnaire_filler.db"
    connection = sqlite3.connect(db_path)
    try:
        existing = {row[0] for row in connection.execute("select question from qa_pairs")}
        missing_rows = [row for row in rows if row["question"] not in existing]
        if not missing_rows:
            return 0

        embeddings = compute_embeddings([row["question"] for row in missing_rows])
        now = dt.datetime.utcnow().isoformat()
        payload = [
            (
                row["category"],
                row["question"],
                row["answer"],
                sqlite3.Binary(embedding_to_bytes(embedding)),
                now,
                now,
            )
            for row, embedding in zip(missing_rows, embeddings)
        ]
        connection.executemany(
            """
            insert into qa_pairs (category, question, answer, embedding, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?)
            """,
            payload,
        )
        connection.commit()
        return len(missing_rows)
    finally:
        connection.close()


def main() -> None:
    rows = build_rows()
    write_csv(rows)
    inserted = seed_database(rows)
    print(f"Wrote {len(rows)} knowledge-base rows to {CSV_PATH}")
    print(f"Inserted {inserted} new rows into {Path(settings.base_dir) / 'questionnaire_filler.db'}")


if __name__ == "__main__":
    main()
