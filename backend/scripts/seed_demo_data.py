"""Seed the database with realistic GRC demo data.

Populates qa_pairs with ~50 Q&A pairs across Security, Privacy, Compliance,
Infrastructure, Access Control, Incident Response, and BCP categories.
Also seeds a couple of intentional near-duplicates so the Duplicates screen
has something to show.

Usage:
    cd backend && python -m scripts.seed_demo_data
    cd backend && python -m scripts.seed_demo_data --wipe   # clear qa_pairs first
"""

import argparse
import sys
from pathlib import Path

_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import QAPair
from app.utils.embeddings import compute_embeddings, embedding_to_bytes


SEED: list[tuple[str, str, str]] = [
    # Security
    ("Security", "Do you have a formal information security program?",
     "Yes. We maintain a comprehensive information security program aligned with ISO 27001 and SOC 2 Type II, reviewed annually by our CISO and approved by executive leadership."),
    ("Security", "Is your organization SOC 2 Type II certified?",
     "Yes. We hold an active SOC 2 Type II report covering Security, Availability, and Confidentiality. The report is available to customers under NDA."),
    ("Security", "Do you perform regular penetration testing?",
     "Yes. We engage an independent third-party firm to perform full-scope penetration tests at least annually, with targeted retests following any material platform change."),
    ("Security", "How often are vulnerability scans performed?",
     "Authenticated vulnerability scans run weekly on production infrastructure, and container images are scanned on every build in our CI pipeline."),
    ("Security", "Do you use multi-factor authentication for all employees?",
     "Yes. MFA is enforced for 100% of employees across all production systems, SSO, and administrative tooling via hardware security keys or TOTP."),
    ("Security", "Do you have a bug bounty or responsible disclosure program?",
     "Yes. We operate a private bug bounty program and publish a responsible disclosure policy at security.example.com."),
    ("Security", "Are security awareness trainings mandatory?",
     "Yes. All employees complete security awareness training on hire and annually thereafter, with phishing simulations running quarterly."),

    # Privacy
    ("Privacy", "Are you GDPR compliant?",
     "Yes. We are GDPR compliant and act as both a Data Controller and Data Processor depending on the service. We maintain a Data Processing Addendum (DPA) available to all customers."),
    ("Privacy", "Are you CCPA compliant?",
     "Yes. We honor all California Consumer Privacy Act rights including access, deletion, and opt-out of sale. Requests can be submitted via privacy@example.com."),
    ("Privacy", "Do you have a Data Protection Officer?",
     "Yes. We have appointed a Data Protection Officer who can be reached at dpo@example.com."),
    ("Privacy", "How long do you retain customer data?",
     "Customer data is retained for the duration of the active subscription plus 90 days, after which it is permanently deleted. Specific retention periods can be configured per-tenant."),
    ("Privacy", "Do you transfer personal data outside of the EU?",
     "Any transfers of personal data outside the EU are governed by Standard Contractual Clauses (SCCs) and supplementary Transfer Impact Assessments."),
    ("Privacy", "Do you maintain a record of processing activities?",
     "Yes. We maintain a Record of Processing Activities (RoPA) as required under GDPR Article 30, updated quarterly."),

    # Compliance
    ("Compliance", "Are you ISO 27001 certified?",
     "Yes. We are ISO 27001:2022 certified. Our certificate is issued by an accredited certification body and is available on request."),
    ("Compliance", "Do you comply with HIPAA?",
     "Yes. We support HIPAA compliance for healthcare customers and will sign a Business Associate Agreement (BAA) as required."),
    ("Compliance", "Are you PCI-DSS compliant?",
     "We do not store, process, or transmit cardholder data directly. All payment processing is handled by PCI-DSS Level 1 certified providers (Stripe)."),
    ("Compliance", "Do you undergo independent third-party audits?",
     "Yes. Independent auditors assess our controls annually for SOC 2 Type II and ISO 27001, with continuous monitoring via our GRC platform."),

    # Infrastructure
    ("Infrastructure", "Where is customer data hosted?",
     "Customer data is hosted on AWS in the us-east-1 and eu-west-1 regions. EU customer data is stored exclusively in eu-west-1 for data residency compliance."),
    ("Infrastructure", "Is customer data encrypted at rest?",
     "Yes. All customer data is encrypted at rest using AES-256 via AWS KMS with customer-managed key options available for enterprise tiers."),
    ("Infrastructure", "Is customer data encrypted in transit?",
     "Yes. All data in transit is encrypted using TLS 1.2 or higher. We enforce HSTS and score A+ on Qualys SSL Labs."),
    ("Infrastructure", "What is your uptime SLA?",
     "We provide a 99.9% monthly uptime SLA for standard tiers and 99.95% for enterprise tiers, with service credits for any shortfall."),
    ("Infrastructure", "Do you have geographic redundancy?",
     "Yes. Production workloads run across multiple Availability Zones with automated failover. Cross-region disaster recovery is available for enterprise customers."),

    # Access Control
    ("Access Control", "How is access to customer data controlled?",
     "Access to customer data follows least-privilege and zero-trust principles. All access is logged, reviewed quarterly, and requires explicit business justification with manager approval."),
    ("Access Control", "Do you support Single Sign-On (SSO)?",
     "Yes. We support SAML 2.0 and OIDC SSO with identity providers including Okta, Azure AD, Google Workspace, and JumpCloud."),
    ("Access Control", "Do you support role-based access control?",
     "Yes. Our platform provides granular role-based access control (RBAC) with custom roles and fine-grained permissions at the resource level."),
    ("Access Control", "How quickly is access revoked when an employee leaves?",
     "Access is revoked within 4 hours of termination through automated deprovisioning integrated with our HRIS system."),

    # Incident Response
    ("Incident Response", "Do you have an incident response plan?",
     "Yes. We maintain a documented incident response plan aligned with NIST SP 800-61, tested via tabletop exercises at least twice per year."),
    ("Incident Response", "How quickly will you notify customers of a data breach?",
     "In the event of a confirmed security incident affecting customer data, we notify impacted customers without undue delay and no later than 72 hours, in accordance with GDPR Article 33."),
    ("Incident Response", "Do you have a dedicated security operations team?",
     "Yes. Our Security Operations Center (SOC) operates 24x7x365 with staff across multiple time zones."),
    ("Incident Response", "How are security logs collected and monitored?",
     "Security logs from all production systems are aggregated into a centralized SIEM with 24x7 monitoring, alerting, and a minimum 1-year retention period."),

    # Business Continuity
    ("Business Continuity", "Do you have a business continuity plan?",
     "Yes. We maintain a business continuity plan and disaster recovery plan tested at least annually through simulated failover exercises."),
    ("Business Continuity", "What is your RPO and RTO?",
     "Our Recovery Point Objective (RPO) is 1 hour and our Recovery Time Objective (RTO) is 4 hours for production workloads."),
    ("Business Continuity", "Do you perform regular data backups?",
     "Yes. Customer data is backed up continuously with point-in-time recovery. Daily snapshots are retained for 30 days, weekly for 12 weeks, and monthly for 12 months."),
    ("Business Continuity", "Are backups encrypted?",
     "Yes. All backups are encrypted at rest using AES-256 and stored in a separate account with strict access controls."),

    # Vendor Management
    ("Vendor Management", "Do you assess the security of your subprocessors?",
     "Yes. All subprocessors undergo a formal security review prior to onboarding and annually thereafter. Our subprocessor list is published at example.com/subprocessors."),
    ("Vendor Management", "Do you notify customers of new subprocessors?",
     "Yes. We provide at least 30 days advance notice via email and our subprocessors page before engaging any new subprocessor."),

    # HR Security
    ("HR Security", "Do you perform background checks on employees?",
     "Yes. All employees undergo background checks prior to employment, including criminal history, employment verification, and education verification where legally permitted."),
    ("HR Security", "Do employees sign confidentiality agreements?",
     "Yes. All employees and contractors sign confidentiality and intellectual property agreements as part of onboarding."),

    # Product Security
    ("Product Security", "Do you follow a secure development lifecycle?",
     "Yes. We follow an SSDLC aligned with OWASP SAMM, with mandatory code review, automated SAST/DAST scanning, and threat modeling for new features."),
    ("Product Security", "Do you use dependency scanning?",
     "Yes. We scan all dependencies continuously for known vulnerabilities using Snyk and Dependabot, with SLAs based on CVSS severity."),

    # Intentional near-duplicates (so the Duplicates screen has content)
    ("Security", "Do you conduct regular penetration tests?",
     "Yes, we engage a reputable third-party to conduct penetration testing on our production environment at least once per year."),
    ("Privacy", "Are you compliant with the GDPR?",
     "Yes, we comply with the General Data Protection Regulation and offer a Data Processing Addendum to our customers."),
    ("Access Control", "Do you enforce multi-factor authentication?",
     "MFA is required for all staff accessing production systems, enforced via hardware keys or TOTP."),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true", help="Delete existing qa_pairs before seeding")
    args = ap.parse_args()

    db_url = settings.database_url
    if db_url.startswith("postgresql+asyncpg"):
        db_url = db_url.replace("postgresql+asyncpg", "postgresql+psycopg2", 1)
    elif db_url.startswith("sqlite+aiosqlite"):
        db_url = db_url.replace("sqlite+aiosqlite", "sqlite", 1)

    engine = create_engine(db_url)

    print(f"Seeding {len(SEED)} Q&A pairs...")
    print("Computing embeddings (loading model — first run takes ~10s)...")
    embeddings = compute_embeddings([q for _, q, _ in SEED])

    with Session(engine) as session:
        if args.wipe:
            print("Wiping existing qa_pairs...")
            session.execute(text("DELETE FROM qa_pairs"))
            session.commit()

        inserted = 0
        for (category, question, answer), emb in zip(SEED, embeddings):
            pair = QAPair(
                category=category,
                question=question,
                answer=answer,
                embedding=embedding_to_bytes(emb),
            )
            session.add(pair)
            inserted += 1
        session.commit()
        print(f"OK: inserted {inserted} qa_pairs")

        total = session.execute(text("SELECT COUNT(*) FROM qa_pairs WHERE deleted_at IS NULL")).scalar()
        print(f"Active qa_pairs in DB: {total}")


if __name__ == "__main__":
    main()
