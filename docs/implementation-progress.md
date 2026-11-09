# Implementation progress and review evidence

Approved design and plan: `docs/superpowers/specs/2026-11-09-complete-daybook-design.md` and `docs/superpowers/plans/2026-11-09-complete-daybook.md`. Branch `codex/complete-daybook`, initial base `0f11c03`. Owner requires independent review, fixes, rereview and final local merge. Nothing is Done until merged.

## P00 — reviewed foundation

Commit `2f21b02` preserves the reusable UI extraction, 187 Figma references, approved design, 40 source stories/121 acceptance criteria and initial task board. Baseline 18 tests, typecheck, lint, application/Storybook builds passed. Restricted generated-output permission required a build retry with appropriate execution permission; this was not a code defect.

Independent reviewer `foundation_review` found two P2 bugs: dark notification descriptions inherited pale foregrounds against pale backgrounds; tooltip pointer transitions dismissed the bubble. Both were reproduced with actual Chrome regressions (contrast 1.651:1 and disappearing tooltip), fixed, and all three browser tests passed. Reviewer rereview reported no remaining actionable findings. Subsequent production and Storybook builds passed.

## P01 — authentication and tenant foundation

Current work covers agent registration/login/logout/me, hashed opaque sessions, same-origin proxies, scrypt passwords, three forced-RLS tenant tables, composite foreign keys and a startup role guard. Future domain migrations must preserve the boundary and are rechecked at P14; this is not completion of the other operational stories.

- RED: four actual HTTP assertions returned missing endpoints (404), observed against disposable PostgreSQL 17 before auth implementation. GREEN: registration/session/login/logout and protected GraphQL identity passed.
- Additional real SQL tests cover two tenants, forbidden cross-tenant writes, forged composite relationships, transaction-local scope cleanup and restricted roles. Expired/tampered sessions deny access.
- RED → GREEN: backend auth input consumed an oversized stream fully; bounded read now cancels it before completion.
- RED → GREEN: missing browser account creation workflow and proxy origin protection. Actual Chrome creation, refresh, logout, failed/successful login and cookie HttpOnly checks passed.
- Independent reviewer `auth_review` found P2 public frontend buffering before size validation. Actual chunked HTTP regression reproduced all 101 chunks consumed before rejection. Fix bounds auth/GraphQL reads before buffering; all three application tests passed, including early rejection.
- RED → GREEN: runtime role inherited authentication-owner privilege but startup accepted it. Guard now rejects auth-owner membership and administrative attributes. All nine PostgreSQL integration tests passed.
- Reviewer rereview: no remaining actionable P01 findings. Final post-fix checks passed: 19 unit/SSR tests, typecheck, lint, production build and repository formatting with end-of-line auto. P01 is In review until merge.

## P02 — territory, staff and routes

Configuration now uses typed GraphQL inputs, per-agency serialized mutation transactions, SQL repositories, forced-RLS tables and immutable audit events. UI pages cover territory boundaries/overlap authorization, staff lifecycle and assigned sectors, route division/assignment and ordered delivery points. Overview summaries derive from stored records.

- RED → GREEN: missing configuration schema; normalized overlap rejection/authorization, scoped counts, staff eligibility, ordered stops, stale concurrent updates, cross-agency links and mutation origin checks now pass.
- RED → GREEN: editing inactive records silently reactivated them; omitted active flags now preserve status.
- Independent operations_review found an on-leave staff reference blocked route deactivation and archived edits. Added real regression; safe deactivation/archived metadata now retains existing references while new assignments/activation validate availability. Rereview clear.
- Expanded browser check exposed custom empty-table copy appearing for filtered/failed datasets. Shared DataTable now reserves empty copy/actions for actual empty states; SSR regression covers both no-results and failure.
- Actual application workflow covers creation, refresh, keyboard traversal, stop reordering, route editing, name/code/address search, no-results recovery, guarded deactivation/reassignment, status filtering and preserved failed-save drafts. A transport abort now produces a clear unconfirmed-request message rather than exposing Axios internals; cancel does not claim a save.
- Route-address search regression found nested stops were stringified as objects; explicit visible search fields now include stop names/addresses and exclude UUID/version metadata. RED → GREEN verified in Chrome.
- Current evidence: 20 unit/SSR tests, 16 real PostgreSQL integration tests and 4 application/browser/HTTP tests passed; lint/typecheck and application/Storybook builds passed. The final frontend build after the search fix also passed.
- Task reviewer explicitly did not judge future P05 daily substitutions or P14 whole-application visual fidelity. Those remain requirements and are not waived. US-003 stays To do until its temporary substitution criterion is implemented in P05; US-001/002 and P02 move to In review after passing final checks.

## Execution rulings

- Native Windows execution uses the tracked task board and an ignored per-plan ledger instead of POSIX-only skill helper scripts; evidence and checkpoints remain explicit.
- Work uses the user's requested feature branch in the existing checkout. No extra worktree or destructive transfer of the dirty UI foundation was performed.
- The user's repeated task-level review requirement overrides executing-plans' single-review and no-rereview defaults. All valid actionable findings are fixed rather than deferred by severity alone.
- Git identity was absent; the foundation commit used the exact author name and public noreply address already present on the repository's prior commit through per-command options. Global Git configuration was not changed.
- No Docker/PostgreSQL command was installed on PATH. A test-only npm-distributed PostgreSQL 17.11 runtime supplies real disposable databases; tests do not substitute an in-memory database for RLS/financial checks.
- Next.js application tests now use per-run loopback ports and per-run ignored build directories, one browser worker and explicit Windows child-process tree cleanup to prevent shared-server interference. Generated cache output is excluded from lint/format/type discovery. No customer communications, live payments or cloud actions were performed.

## Outstanding

P03 is verified and independently reviewed; P04 is in progress and P05–P14 remain unimplemented. No merge or remote push has occurred. Provider credentials and live-service acceptance are distinct from local contract tests and must not be reported as verified without evidence.

## P03 — reviewed catalog, residents and deposits

Catalog supports regional editions, dispatch and calendars with exact decimal prices. Resident profiles synchronize protected route points; onboarding deposits are immutable, tenant-scoped and idempotent. Shared money formatting preserves decimal strings above floating-point precision.

- RED → GREEN: missing catalog/resident APIs, exact deposit receipt retry, route linkage protection, and Chrome catalog/resident CRUD.
- Independent review found stale resident versions after route reorder, incompatible territory sector edits, and missing UI linking of existing points. Regression assertions reproduced stale overwrite and missing linking control; all three fixed and rereview clear.
- Final P03 checks: 23 unit/SSR tests, 23 PostgreSQL tests, 5 Chrome app tests, lint/typecheck, production and Storybook builds passed. P03/US-005 In review until merge. US-004 counts/indents and US-033 manifests/reconciliation remain P05/P06 dependencies. Full visual fidelity remains P14.
- P04 started: all eight recurrence/calendar and price-precedence tests observed RED, then all three GREEN. Subscription persistence, holds and screens still in progress.
