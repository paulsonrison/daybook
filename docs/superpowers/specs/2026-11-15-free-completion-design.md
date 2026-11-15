# Free-service completion design

Approved by the user on 15 November after researching permanent free database plans, storage, scheduling and inference. This extends the approved complete-Daybook design; it does not reduce its remaining feature acceptance.

## Intent and constraints

Finish the requested application with no paid services or local model hosting. Keep existing PostgreSQL domain rules, authentication, exact money, tenant isolation, audit history and pending-operation identities. Free means usage-limited, not unlimited availability. Stop or queue at quotas; never fall back to paid providers. Do not call an unconfigured integration live or remove the preview banner before whole-project acceptance.

## Approaches

The user approved the recommended Neon-based approach. Neon Free provides non-trial PostgreSQL compatible with the existing pg driver, plus object storage. Supabase Free was considered but pauses inactive projects and would introduce another authentication/storage platform. Keeping Render's free database leaves its 30-day expiration unresolved. SQLite/D1 would require a substantial rewrite of the existing PostgreSQL/RLS/financial transaction implementation and is rejected.

## Selected architecture

- Keep the current free Render web service. Move the database to a new Neon Free project in Singapore, PostgreSQL 17, compute capped at 0.25 CU with idle suspension. Preserve existing custom auth and SQL-created restricted roles. Use direct connections for migration/restore and a supported pooled connection for app transactions after isolation tests.
- First rehearse migration and restore on an isolated Neon branch. Copy existing records and verify table checksums/counts, immutable evidence, exact large amounts and a working authenticated session. Cut over only after verification; retain the old Render database as rollback, without deleting or resetting it. Quiesce writes during final transfer.
- Use private Neon object storage for uploads and one encrypted backup destination, with Backblaze B2 as an independent destination when connected. Enforce retention and free-tier storage/egress budgets; show missing/failed replication honestly. Backup encryption keys remain separate from uploaded ciphertext. Test actual database restoration.
- Use a small Cloudflare Cron Worker to trigger authenticated, bounded application jobs. Existing durable locks, leases and idempotent domain jobs remain authoritative. Avoid always-on polling and artificial keepalive traffic that would consume Neon/Render free allowances. Surface delayed/missed runs; do not promise exact-time free-service execution.
- Keep Groq-hosted Qwen inference as opt-in, bounded and rate-limited. Parse native document formats deterministically first, then use vision for scanned pages. Save source-linked drafts and require explicit field confirmation before calling existing domain mutations. Provider absence/quota retains drafts and supports manual entry. Never fabricate confidence or promise zero extraction errors.
- At zero provider spend, provide manual WhatsApp sharing, in-app reminders and downloadable documents. Existing automated SMS/WhatsApp adapters remain opt-in and disabled unless the user separately approves their provider costs; this limitation must remain visible rather than being represented as delivered messages.
- Finish P11 reports, translations and layouts using existing shared UI; retain the original Figma acceptance criteria, independent review loop and main-merge gate.

## Execution and external access

Neon connector is connected; the PAULSON organization is Free and initially has no projects. Existing Render workspace/service identities remain those recorded in `docs/pwa-preview.md`. Account connection is not a license to modify unrelated projects. Cloudflare, Backblaze and Groq credentials will be needed for their live checks; complete local implementations while access is pending, then verify each actual integration. No secret enters tracked source, logs or browser bundles.

## Success criteria

Non-expiring free database live with preserved data and tested rollback; encrypted backups restored and quota-controlled; real scheduled bounded jobs; source-reviewed document intake; complete reports/languages/layouts; full applicable tests and Figma review; clean independent reviews; verified main merge and public deployment. Any provider-only limit or unavailable credential remains explicit.

## Builder-review resolutions

- Migration maintenance covers every existing writer: web mutations/auth, workers, cron triggers and callbacks. Persistently revoke the source runtime role's table/function privileges under owner control, wait for in-flight transactions using table locks, and only then take the transfer snapshot. Capture exact original grants before changing them. Failure before verified cutover restores those grants; restart resumes the recorded migration phase. Client pending actions retain their original UUIDs. New storage destinations are empty isolated targets, never arbitrary existing databases.
- Keep target application writes disabled until fidelity, permissions and public smoke verification pass. The cutover checkpoint declares Neon authoritative before enabling target writes. After that point, never automatically switch to the stale Render source. Rollback then requires another maintenance window and verified reverse transfer of all new Neon records, or forward recovery. The old copy alone is only a pre-write rollback.
- The user-approved zero-spend plan explicitly replaces unrestricted automated SMS/WhatsApp delivery with manual sharing, in-app reminders and downloads. The original paid-provider adapter capability remains implemented and tested; real paid delivery is an approved free-scope exception, not a claimed live success.
- Two independently verified encrypted backup destinations remain required. A disconnected B2 destination is unfinished replication acceptance. Missing Cloudflare, Groq or B2 credentials leave their live checks pending and cannot satisfy release or preview-removal gates. All remaining code/tests proceed independently of those credentials.
