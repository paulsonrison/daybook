# PWA and free preview implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task, with independent review before publication.

**Goal:** Install Daybook on a phone, retain pending field actions across interruptions, and publish a separate free Render preview.

**Architecture:** A public, static field shell uses IndexedDB for explicitly downloaded route data and queued actions. Authenticated APIs are never service-worker cached. Server replay reuses the existing delivery/payment transactions, checks the authenticated agency and agent, and checks downloaded versions under the agency mutation lock.

**Tech Stack:** Next.js 16.4.5, service worker, IndexedDB, GraphQL, PostgreSQL, Render free web service and free PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-11-09-complete-daybook-design.md`, P12; user-approved PWA/free-preview scope on 15 November.

## Global constraints

- Branch `codex/pwa-render`; main stays unchanged pending whole-project acceptance.
- Prioritize P12 independently of unfinished P11 exports; do not claim P11 or the full project complete.
- Free resources only, in the user-approved Paulson workspace. Leave existing services untouched. Free database expiration is a preview limitation.
- A cold load must verify the online session before displaying cached personal data. During an already verified open field session, downloaded data remains usable offline. Offline reload retains pending entries but locks their display until reconnection. This deliberately prioritizes the original account-isolation requirement over unattended offline reopening.
- Logout/account change clears local field data. Session expiry pauses replay. Pending cash is never shown as a receipt until acknowledged by the server.
- Only delivery overrides and confirmed actual cash to ACCOUNT are queued. No offline cheque, deposit, invoice, payroll or arbitrary mutation.
- Conflicts preserve the queued proposal and require explicit discard and a new downloaded version before re-entry; no automatic overwrite.

## Review focus

Duplicate replay after a lost acknowledgement must return the original receipt.
Another agent/agency must never replay the old queue.
Concurrent financial writes must invalidate stale cash snapshots atomically.
Offline reload and multiple tabs must preserve pending data without revealing a previous account.
Worker upgrades must not erase queues or cache private responses.

### Task 1: Atomic field synchronization

Files: `apps/backend/src/modules/field/{service,schema}.ts`, existing payment/delivery transaction helpers, `apps/backend/tests/integration/field.test.ts`, `apps/backend/src/app.ts`.

- [x] Add failing real PostgreSQL tests for snapshot, replay, stale cash/delivery and actor/tenant rejection.
- [x] Run the tests and observe missing field API failures.
- [x] Extract transaction helpers without changing existing public operations. Add bounded field snapshot and replay API, immutable request fingerprints and source timestamps in audit.
- [x] Pass field and existing payment/delivery regressions.

### Task 2: Installable offline field workspace

Files: frontend manifest, public field shell/modules/styles/icons/service worker, root registration, authentication invalidation, navigation; `tests/application/pwa.spec.ts`.

- [x] Add and run failing browser checks for installation metadata and offline queue/reload/reconnect/account behavior.
- [x] Implement static allowlisted caching, safe DOM rendering, scoped IndexedDB, pending/conflict controls, explicit download/sync and mobile install guidance.
- [x] Run real Chrome checks, inspect mobile layout and confirm no private API entries in Cache Storage.

### Task 3: Free preview

Files: Render deployment configuration, combined service launcher, migration/bootstrap script and deployment guide.

- [x] Validate a single-service build/start and restricted runtime DB role with synthetic local data.
- [x] Run workspace verification and independent review; fix findings and repeat review.
- [x] Push the isolated branch. Prepare concrete free Render configuration, review/apply under the user's approval, and verify HTTPS, health, manifest and offline shell on the public URL.
- [x] Record evidence, URL and free preview limits. Keep task In review until final main merge.

## Evidence ledger

Governance: user approved the unchanged PWA implementation/free-preview plan and Paulson's workspace. Active selection: skill-governor, Superpowers implementation/verification/review, Karpathy guidelines, verify-before-done, Render deployment. Next.js bundled PWA/manifest guides and version-specific Context7 documentation read before frontend edits. No new paid resources authorized.

Local evidence: 100 workspace unit/tooling/UI checks, workspace types/lint, production build, 15 field/payment/delivery PostgreSQL checks, restricted-owner bootstrap/restart and combined production health/auth check, and five Chrome acceptance checks pass. Both P1 privacy findings and the startup signal finding are fixed; independent rereviews are clear. Browser checks include offline delivery, cash lost acknowledgement (one receipt), expiry lock with retained queue, reload, conflict preservation, account isolation, Cache Storage allowlist and mobile layout. Current official Render schema validation passes; CLI unavailable, Render planning remains the platform validation.

Publication verified: Render deployment `dep-dbsqbve7bikc73c6jfmg` is live at https://daybook-paulson-preview-o1c8.onrender.com. Public HTTP probes and real Chrome signup/offline/reload/reconnect/one-receipt/cache/sign-out checks pass. Free private DB expires 15 December 2026. Existing PressTrack unchanged. Main is unchanged; P12/US-028 remain In review under the project lifecycle.

| Active skill        | Audit | Evidence                                                                                                                                               |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| skill-governor      | PASS  | Approved scope/selection retained; separate free resources reviewed before application; evidence ledger and final audit.                               |
| Superpowers         | PASS  | Written approved-scope plan, observed field/privacy RED→GREEN checks, separate branch, independent reviews and fixes, real verification before commit. |
| Karpathy guidelines | PASS  | Explicit cold-reload privacy assumption; existing domain transactions reused; no unrelated feature expansion.                                          |
| Context7            | PASS  | Next.js 16.4.5 PWA headers/manifest documentation queried, plus installed version's guides read before edits.                                          |
| verify-before-done  | PASS  | Actual types/lint, 100 checks, production build/start, PostgreSQL and Chrome outputs inspected; unfinished monthly-report acceptance disclosed.        |
| Render deployment   | PASS  | Current schema/platform plan validation, create-new free resources only, approved workspace, live deployment and public HTTPS/browser verification.    |
