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

P00–P10 are implemented and independently reviewed; P11–P14 remain. P10 now includes configured, consent-aware service-hold notices. No merge or remote push has occurred. Provider credentials and live-service acceptance are distinct from local contract tests and must not be reported as verified without evidence.

## P03 — reviewed catalog, residents and deposits

Catalog supports regional editions, dispatch and calendars with exact decimal prices. Resident profiles synchronize protected route points; onboarding deposits are immutable, tenant-scoped and idempotent. Shared money formatting preserves decimal strings above floating-point precision.

- RED → GREEN: missing catalog/resident APIs, exact deposit receipt retry, route linkage protection, and Chrome catalog/resident CRUD.
- Independent review found stale resident versions after route reorder, incompatible territory sector edits, and missing UI linking of existing points. Regression assertions reproduced stale overwrite and missing linking control; all three fixed and rereview clear.
- Final P03 checks: 23 unit/SSR tests, 23 PostgreSQL tests, 5 Chrome app tests, lint/typecheck, production and Storybook builds passed. P03/US-005 In review until merge. US-004 counts/indents and US-033 manifests/reconciliation remain P05/P06 dependencies. Full visual fidelity remains P14.
- P04 started: all eight recurrence/calendar and price-precedence tests observed RED, then all three GREEN. Subscription persistence, holds and screens still in progress.

## P04 — reviewed subscriptions, holds and effective pricing

All eight date-only cadences, anchored month/year clamping, bounded and indefinite vacation holds, concurrent publication subscriptions and price-rule precedence are persisted behind tenant-scoped APIs and shared UI forms. Equal-priority overlapping prices are rejected.

- RED → GREEN: four calendar/hold/price tests, missing subscription/hold/price APIs, and Chrome management controls. Compatibility checks cover the Gregorian/fortnight 800-year cycle; validating once per schedule reduced the slowest initial integration from about 20 seconds to about two seconds.
- Independent auth_review found duplicate subscription creation after an unconfirmed save and publication calendar edits bypassing subscription compatibility. Both reproduced, fixed using durable scoped request fingerprints and an active-subscription calendar guard; rereview clear.
- Final checks passed: 27 unit/SSR, 29 PostgreSQL integration, 6 Chrome app tests, lint, typecheck, production build and formatting. Shared UI package was unchanged since its successful P03 Storybook build. P04/US-006–008 In review until merge. US-012 billing and US-015 manifest/billing criteria retain P05/P07 dependencies.
- Ruling: calendar edits require pausing/cancelling active subscriptions before an explicit validated schedule update/reactivation. This avoids silently changing household delivery commitments; it costs the owner an explicit reassignment step even for compatible calendar additions.
- P05 started with delivery/manifest/substitution/complaint regression contracts.

## P05 — reviewed delivery operations and worker foundation

Daily logs and packing manifests partition dispatches, expand active calendars and skip holds/press holidays. Dated substitute ranges cover each drop once and revert to recorded permanent assignments. Field UI includes search, ordered cards, 48px actions, swipe-to-flag and light/dark themes. Complaints retain distinct request fingerprints, durable one-per-delivery benefit guards and optional recorded feedback. Measured staff issue rates and unknown-until-recorded satisfaction appear on the overview.

- RED → GREEN: missing delivery APIs, missing midnight/04:00 work, post-midnight staff attribution, missing field screen, historical cancellation erasing logs, duplicate complaint benefits, stale job completion, narrowing/cancelling substitutes and missing measured metrics.
- Independent operations_review identified three defects (benefit history guard, lease fencing and changed substitution ranges). All reproduced/fixed; final rereview clear. Historical permanent staff and past packing snapshots remain intact; explicit dated correction reconciles old/new assignment ranges.
- Durable separate worker has scoped jobs, SKIP LOCKED claims, owned lease/attempt checks, row locks through execution, bounded retry/backoff and catch-up. Context7 retrieved PostgreSQL 17 locking documentation supporting queue and transaction lock behavior. No persistent customer worker was started. See background-worker.md.
- Final checks: 39 PostgreSQL tests, 27 unit/SSR, 7 Chrome application tests, lint/typecheck/build/format passed. Chrome checks cover field exception/resolution, gesture, dark mode, refresh and mobile action dimensions. Full Figma parity remains P14.
- Ruling: dispatch warning uses at least three prior prepared dispatches, at most seven, with a 30% absolute deviation threshold. Empty history is unknown, not zero.
- Ruling: historical dates with recorded marking/manifests are preserved; a first backfill uses available configuration and cannot reconstruct absent lifecycle history. Future marking is rejected.
- US-021 ledger posting remains P07; resolved replacements and approved credits are recorded without claiming a posted paid-invoice correction. P06 begins supply/returns, inventory and insertion work.

## P06 — reviewed publisher supply, seasonal stock and inserts

Publisher receipts snapshot net procurement rates, optional list/margin inputs, edition/dispatch and local return deadlines. Returns credit original lots; monthly statements keep regional/evening costs distinct. Seasonal preorders reserve bounded stock, preserve agreed prices and create one charge or confirmed cash receipt on fulfilment. Advertiser campaigns allocate one leaflet per scheduled household and require recorded proof plus explicit tax treatment before invoicing. Shared UI screens cover all three workflows and manifest extras.

- RED → GREEN: missing supply/stock/insert APIs and pages, exact single-margin cost calculation, original-lot returns, concurrent stock bounds, cancellation release, exact cash confirmation, completion proof and immutable completed allocations.
- Independent foundation_review found completed insert recipients recomputed from live schedules and obsolete route allocations accepted as proof. Both reproduced and fixed; final rereview clear. An analogous confirmed merchandise address snapshot regression was also fixed.
- Additional integration regression found that existing temporary cover could be made unavailable through staff edits. Current/upcoming cover must now be reassigned first; the observed failure is fixed and covered.
- Final checks passed: 49 PostgreSQL tests, 28 unit/SSR, 10 Chrome app tests, lint/typecheck/build/format. All P06 browser workflows use synthetic agencies; no real payments, messages or external invoices were sent.
- Ruling: each targeted household receives one leaflet per insertion order; route quantities cannot exceed eligible scheduled households. Multiple copies per household would require an explicit future order option.
- Completion preserves immutable recipient/address/route snapshots. Earlier packing proof must match the campaign title, distinct recipients and exact route quantities; revised allocations cannot reuse unrelated historic proof.
- Supply records stay immutable; their reads do not request row-update locks, which would require update rights. The shared agency transaction lock serializes return bounds.
- US-034 invoice append remains P07. Taxed invoice configuration/reporting remains P11; P06 invoices require an explicit no-tax confirmation and make no statutory compliance claim. Full Figma comparison remains P14.

## P07 — reviewed invoices, resident ledger and closing

Monthly, weekly, custom and selected-month previews use recorded delivery rates and fulfilled invoice merchandise. Exact decimal strings flow through the shared bill component. Saved revisions retain source quantities/rates and post only their financial delta; unique source claims prevent overlapping invoices from billing a delivery or item twice. Arrears and receipts appear on the bill without creating another debt posting.

- Observed RED → GREEN: missing billing APIs; stale save; duplicate and overlapping sources; settled/closed record guards; invoiced complaint credit; downward revision allocated to the wrong invoice; merged selected months rejected on edit; automatic cycle closing; partial first month; daily reconciliation attempting to rewrite an invoiced delivery; next-day monthly edits; first form correction lost; credit editor absent; print exposing the collection directory.
- Independent auth_review and operations_review found five defects across their review passes. Each was reproduced and fixed; both final code rereviews are clear. The separate test-runner review independently executed all 15 shared-UI assertions successfully.
- Final verification: 64 real PostgreSQL regressions, 30 unit/SSR assertions, 11 Chrome application tests, typecheck, lint and production build passed. Chrome covers rate/reason editing, a goodwill credit, recalculation, save, reload/edit retention and print-only selected bill.
- Automatic closing runs at the agency-local month boundary and records immutable source counts and per-resident balances. Issuing stays off by default; explicit opt-in queues durable per-resident jobs. Automatic completeness starts at agency creation, and missing eligible preparation blocks issuing.
- Confirmed seasonal cash sales post a matching, directly settled debit/receipt pair. Invoice merchandise is appended once; later overlapping previews exclude claimed charges. Complaint credits after invoicing use the actual billed rate/quantity and post in the current open period without changing the source delivery.
- Windows Application Control blocked Rollup's native library during the previous SSR test runner. The same assertions now run through the existing TypeScript runner with an explicit test JSX configuration. No operating-system policy or blocked binary was changed. Production bundling was checked separately.
- Ruling: a downward invoice revision settles its own debit first. Other account credit retains oldest-due allocation. A delivery receives one replacement-or-credit benefit; additional goodwill is a separate audited adjustment.
- Ruling: a late hold does not erase an already invoiced delivery. Its financial correction is explicit, preserving recorded history. An unpaid monthly invoice retains its original coverage when edited on a later day.
- Full frame-by-frame Figma comparison remains P14. Payment confirmation, clearance, credit control and collection reports are P08; no real customer payments or messages were sent.

## P08 — reviewed payments, clearance, credit and collection sheets

Exact full/partial payments and separate deposits have durable request recovery, explicit funds confirmation, immutable receipt balances and audit history. Pending confirmations never show paid. Clearance offsets deposits, archives service and separately confirms actual refunds. Credit alerts and suspension preserve truthful unconfigured notification intents. Route sheets include genuine independently decoded UPI QR codes and recoverable batch entry.

- RED to GREEN: missing APIs, targeted allocation, historical balances, combined deposit/account-credit refund effects, tenant/refund guards, genuine QR, pending confirmation and stale clearance.
- Independent review found empty-selection lock, lost unsent batch drafts, outdated QR printing and mixed payment/refund printing. Each reproduced and fixed; final rereviews clear. Additional observed regressions covered storage write/read failures, refresh recovery, stale paid state and credit-button reactivity.
- Verification: 74 PostgreSQL tests, 30 unit/SSR checks, 19 Chrome application tests, lint and typecheck passed. Production build and formatting results recorded below.
- Confirmation is agent attestation, not bank verification. QR is a payment intent. No actual payments or messages occurred.
- US-035 stays To do until P10 configured/consent-aware WhatsApp delivery; current intents are NOT_CONFIGURED. Other P08 tasks remain In review until final merge. Full Figma comparison remains P14.
  P08 checkpoint: production build exited 0; repository formatting passed (end-of-line auto).

## P09 — reviewed staff pay, cash custody and signed closing

Effective salary, per-copy and blended rules include employment dates, attendance, route allowances, approved unpaid expense claims and confirmed advances. Payslip previews use exact paise, actual substitute delivery snapshots and one original-copy commission; advances are capped against earnings and carry forward. Posting preserves source claims and remains separate from a confirmed payout. Explicit current-period corrections can pay former staff without inventing new employment.

- Observed RED to GREEN included missing APIs/screens, reimbursement double-disbursement semantics, open-ended rule transitions, missing preparation, contradictory or incomplete employment boundaries, future posting, stale previews, receipt/payout state replay, cash custody, signed-day guards, digital deposits after cash close, cross-entry return deduplication and one-handover return claims.
- Independent payroll/cash/UI review findings were reproduced and fixed; final focused rereviews are clear. UI regressions cover lost-response advance/return handover recovery, staff selection during calculation, retained drafts after failed writes and failed cash-date changes.
- Verification passed: 85 real PostgreSQL regressions, 30 unit/SSR checks, 25 Chrome application tests, typecheck, lint and production build. A final 8-test payroll run also verifies stale attendance fingerprints and immutable posted attendance. Repository formatting is recorded below.
- Cash custody is explicit and historical unknown custody stays unknown. Actual handovers enter the drawer once; a short handover's signed variance is an agency suspense memo, not staff debt. Late remittances are bounded, deduplicated actual inflows. Petty cash, bank deposits, cash advances, payroll payouts and refunds remain separate outflows. Signed-day snapshots do not change when later cash arrives.
- Rules sharing the same employment start use one confirmed final boundary. Fixed monthly salary supports a final midmonth departure without automatic proration; ordinary fixed-rate changes remain constrained to month boundaries. Conflicting recorded boundaries are rejected rather than silently selecting one.
- New pages compose shared UI, money formatting and theme styles; original-request recovery is shared with existing payments. Readable source/attendance/claim/handover/close histories replace raw implementation data. The synthetic rapid workflow completed within its browser test; this does not establish a measured production service target.
- No actual salary, customer funds, provider messages or cloud changes occurred. P09/story tasks remain In review until the final merge. Exact Figma acceptance remains P14. P10 will reuse immutable document snapshots, notification intents and the existing worker.
  P09 checkpoint: repository formatting and final unit/lint checks passed; all independent review comments resolved.

## P10 — documents and communications implemented

Immutable invoice, receipt, refund, payslip and account-notice PDFs reuse shared presentation, exact money and embedded Indic fonts. Owners select financial sources, generate/download PDFs, manage expiring/revocable links and prepare invoice batches. Dispatch history exposes each recorded PDF and its generation state. Missing configuration, consent or approved templates remains visibly blocked.

- Official Meta/Twilio transports distinguish acceptance, delivery, definite rejection and uncertainty. Signed callbacks retain the exact signature inputs and configured agency identity. A durable inbox handles early/out-of-order events; uncertain submissions never resend blindly. Audited owner decisions remain distinct from provider evidence, and later authoritative acceptance takes precedence.
- Current-local-date reminders evaluate at most 25 residents per durable cursor batch, render at most three documents and process at most five messages per cycle. Restart catch-up skips missed dates, expires obsolete unsent notices and preserves uncertain sends. Frequency/cooldown, current debt/consent/phone, source date, payment identity, PDF and link are checked before submission. Explicit manual reminders can run while automatic scheduling remains disabled. Exhausted PDF retries become failed notices.
- Credit suspension prepares a real configured, consented WhatsApp hold notice; its original request returns the current status. Native call/WhatsApp controls are reused in resident records, delivery views and collection sheets. Each explicit click records an attempt with original-ID recovery, never a claimed connection or delivery.
- English/Malayalam/Hindi messages and documents, explicit template approval attestation, current-phone consent, immediate opt-out cancellation, complete paged contact/dispatch histories and safe request recovery are implemented. Manual reminders preserve unsaved consent drafts.
- Final verification: **109 PostgreSQL tests, 43 unit/shared-UI checks and 37 Chrome application tests passed**. Typecheck, lint, production build and formatting passed. Production dependency audit reports **zero advisories**. A full-browser run's only stale suspension-wording assertion was corrected, followed by a clean 37/37 rerun. Tests use disposable data and synthetic transports; no live provider acceptance is claimed.
- Independent security, financial/operations and frontend/shared-UI final reviews are clear. Earlier findings have reproduced regressions, passing fixes and rereviews: callback visibility, late acceptance, recovery overwrite, unsaved drafts, stale scheduler backlog and bounded evaluation. Full Figma visual acceptance remains P14.
- P10/US-019/025/032/035 move to In review until the final main merge. No real provider sends, funds transfers, deployments or merges occurred. P11's detailed localization/reporting/appearance plan is prepared; P11–P14 still require implementation.
