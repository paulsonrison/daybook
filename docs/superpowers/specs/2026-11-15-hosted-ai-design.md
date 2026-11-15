# Hosted document intake and agency assistant

Approved by the user on 15 November 2026 after selection of Render plus Groq-hosted Qwen3.8-27B. The local computer and Render services do not host model weights. No paid fallback, live cloud provisioning, or real customer-data inference is authorized by this implementation approval.

## Integration

Use the current Next/GraphQL/Postgres/shared UI architecture and authenticated agency identity. Groq is called only from the server using a configured secret and the fixed official HTTPS endpoint. The default model is qwen/qwen3.8-27b, verified in Groq vision/tool-use documentation and the free-plan limits list. Its Hugging Face card declares Apache-2.0. Availability and free allowances are account dependent, not guaranteed unlimited service. Missing credentials, quota errors and provider failures remain explicit. Test transports do not count as live verification.

Uploads support CSV/XLSX, DOCX, text PDF, image PDF and PNG/JPEG. Parse native text/cells first and send only necessary bounded text or rendered pages to vision inference. Preserve sheet/cell/page provenance, original values, leading zeros, date ambiguity and exact decimal amounts. Treat file contents as data, never system instructions. Bound uploads, decompression, pages, output text and concurrent processing. Avoid heavy Docling/model installs on small Render services. Legacy DOC/XLS require an explicit unsupported/conversion message unless an independently tested bounded converter is provided.

Extraction produces reviewable field suggestions, never confirmed payments or ledger mutations. Show original evidence next to each field, leave missing/ambiguous information unfilled, validate schemas and existing agency references, and let the agent explicitly apply reviewed data through normal domain validation. No model confidence percentage is treated as calibrated accuracy. Test English, Malayalam and Hindi fixtures, poor scans, formula-like strings, duplicates and inconsistent totals. Preserve the source hash and audit the user's confirmation.

The assistant uses a small allowlisted set of read-only tools backed by existing tenant-scoped aggregates. It cannot choose a tenant, execute SQL, make network calls, post money, send messages or mutate records. Reject unexpected tool names/arguments, bound tool rounds, and label data with dates. Avoid disclosing resident lists when aggregate answers suffice. Cross-agency/unsafe prompts are politely refused, with input/output checks and explicit limits of probabilistic safety.

## Render

Prepare a validated Blueprint/runbook with server-only Groq configuration, app/API/database wiring and bounded job processing. Uploaded originals and job state cannot rely on an ephemeral filesystem; persist bounded data in tenant-protected storage with a deletion policy. Production resources require explicit provisioning/budget authorization. No public inference endpoint or API key is exposed to browsers.

## Acceptance

Actual parser fixtures, provider HTTP contract/error tests, schema/evidence validation, real PostgreSQL isolation/idempotency tests, browser upload/review/error/native/assistant flows, types/lint/build and independent security review. Live model quality and credentials remain explicitly unverified until configured and assessed on representative documents. Full-project P11/P12/backup/visual acceptance is not implied.

## Sequencing ruling

The user now explicitly prioritizes the standalone AI slice. Implement it on codex/ai-intake-render from verified checkpoint7071a78 without waiting for unrelated P11 export/P12 closure. This does not remove those requirements or claim P13 backups complete. Next migration is015;014 belongs to report storage.
