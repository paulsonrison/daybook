# Free-service completion implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the approved inline execution and independent review loop. Continue all authorized tasks; do not stop at a partial checkpoint.

**Goal:** Complete Daybook using free, quota-controlled services and replace its expiring database without losing data.

**Architecture:** Preserve the existing Next.js/GraphQL/PostgreSQL application. Introduce narrowly scoped free-service adapters and bounded jobs; complete existing unfinished features rather than replacing them.

**Tech Stack:** Existing TypeScript/pg/shared UI; Neon PostgreSQL 17/object storage; Cloudflare Cron; Backblaze B2; existing Groq transport.

**Spec:** `docs/superpowers/specs/2026-11-15-free-completion-design.md` and original approved complete-Daybook design.

## Global constraints

No paid resources or local models; no loss of existing records; no changed financial posting rules; restricted runtime DB role; immutable original migrations; no secrets in source/logs; queue/stop at quota; no fabricated live-provider success. Preserve task lifecycle and independent review; main merge only after full acceptance.

## Review focus

- Migration must preserve bigint/bytea/timestamps, dependencies, function ownership and restrictive tenant permissions.
- Source writes during copying must not be silently lost; failed migration leaves the current service usable.
- Health checks and job polling must not keep Neon compute awake unnecessarily.
- Source documents/prompt injection cannot authorize financial writes or cross-tenant tools.
- Free quotas, missing credentials and backup restore failures must be visible and recoverable.

### Task 1: Durable free PostgreSQL

Files: database connection/bootstrap helpers; migration/verification scripts; Render configuration/launcher; real DB tests; deployment docs.

- [x] Record approved scope and create an isolated `codex/free-completion` branch.
- [x] Add failing tests for migration fidelity, runtime restrictions, cold wakeup and quota-friendly health.
- [x] Create only a new Free Neon project; rehearse existing migrations and preserved-data restore on an isolated branch.
- [x] Verify migration checksums/session/financial evidence; quiesce and transfer the live source; switch only after successful checks. Retain rollback database.
- [x] Independent review, fixes and public HTTPS/browser verification.

### Task 2: Encrypted storage and backups

Files: `modules/backups/*`, storage adapters, migration for scoped backup/jobs metadata, worker/status UI and tests.

- [ ] Test AES-GCM tamper rejection, prefix/tenant boundaries, retention/quota, absent keys and failures.
- [ ] Implement private upload storage and encrypted backup replication using scoped credentials and bounded streaming.
- [ ] Verify actual dump/restore and connected destinations; expose independent destination health.

### Task 3: Free bounded scheduling

Files: authenticated internal job endpoint, Cloudflare scheduler package/config, existing domain worker entry points and tests.

- [ ] Test secret/origin/replay limits, leases, clock boundaries and unavailable service recovery.
- [ ] Reuse existing durable agency jobs and communications cycles in bounded invocations, with budget-aware scheduling and no paid fallback.
- [ ] Deploy and verify actual scheduled execution when account access is connected.

### Task 4: Document intake and assistant completion

Files: `modules/ai/*`, draft/job migration, authenticated upload routes, source-review UI and tests.

- [ ] Test native PDF/CSV/XLSX/DOCX extraction, image/scanned-page jobs, bounded input, exact strings/amounts and tenant isolation.
- [ ] Implement source-linked draft fields, validation/correction and explicit idempotent confirmation through existing domain services.
- [ ] Verify quota/missing provider/manual recovery, then representative live samples with connected inference credentials.

### Task 5: P11 completion

Use the existing detailed P11 plan and its implemented primitives. Files: reports API/export/download/screen, translation catalogues/business screens, operational layouts and tests.

- [ ] Complete the existing failing monthly-report acceptance with real PDF/XLSX downloads.
- [ ] Complete all remaining owned Malayalam/Hindi messages and operational layout/persistence behavior.
- [ ] Run the translation gate, report content/authorization tests, browser/layout/native glyph checks and independent reviews.

### Task 6: Whole-project acceptance and release

- [ ] Compare original Figma screens/states against the implementation and fix differences.
- [ ] Run full applicable types/lint/format/build/unit/PostgreSQL/browser/Storybook/security/restore checks. Review all original stories.
- [ ] Obtain fresh independent reviews, fix findings, repeat until clear, merge to main and verify the actual public release.
- [ ] Remove preview wording only after the implemented feature set and disclosed free-service constraints meet acceptance.

## Evidence and rulings

User explicitly approved this free-service plan after connecting Neon. Current baseline is `85d12b9`, a verified PWA/free preview with known unfinished P11/P13/P14. Exact provider limits were checked from primary sources on 15 November; Neon pricing currently lists 1 GB Postgres, 100 CU-hours/month/project and 5 GB object storage; quota exhaustion suspends compute rather than deleting data. These are limits, not an uptime guarantee. Cloudflare/Backblaze/Groq live access remains to be confirmed.

Builder review found three design gaps; resolutions are recorded in the spec: durable all-writer maintenance, an explicit authoritative cutover before new writes and reverse-transfer-only rollback afterward, plus explicit free messaging exception and unfinished disconnected-provider gates. The initial Neon creation request was rejected because Free does not allow setting an idle timeout, even to its fixed default; no project was created. Retry omits that immutable setting and retains the free plan/0.25-CU cap. Current health is liveness-only and does not query the DB; preserve that existing behavior.

Task1 checkpoint: the non-superuser transfer test now covers two agencies, per-agent preferences, exact9007199254740993paise, a10MiB stored document and generated length, target BYPASSRLS, failed-copy source restoration, nonempty target refusal, lost-COMMIT acknowledgement reconciled on a fresh session, preserved sessions and no replay over new target receipts. Actual production launcher target selection passes after observed RED. Independent helper and wrapper reviews are clear.100 workspace unit checks, types/lint and backend build pass; current official Render schema validates. Public source/cutover verification is next; no live-source migration has occurred yet.

Task1 live evidence: transfer render-neon-20261115 committed79tables/47rows with SHA25666bf85cd4fc030036be279e671fd24df5ff4b3b777e4d675a68cce0e8541f763. Pre-cutover Chrome session/offline payment recovered with one confirmed receipt and no duplicate; direct-owner restart live. Original source retained/fenced. Direct-connection guard has3passing unit cases including reviewer-found uppercase/trailing-dot bypass, observed RED then fixed. Final real DB/production launcher regression passes in .cache/database-transfer-final.log. Private storage availability confirmed, Task2 starting.
