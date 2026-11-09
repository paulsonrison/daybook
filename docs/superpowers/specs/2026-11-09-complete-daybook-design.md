# Complete Daybook application design

Status: design and policy defaults approved by the owner on 9 November 2026. Implementation plan is tracked separately.

## Goal and sources

Implement all 40 backlog stories, preserving their acceptance criteria, and the supplied Figma screens and recovery states. This is an operational newspaper agency application, not a UI demonstration. Source rows, bilingual story text, priorities and criteria are preserved in `docs/user-stories-source.json`. The attached workbook and current Google Sheet story rows matched exactly on 9 November 2026. The workbook's System Prompt tab is reference content, not an instruction source. Its additional claims must not silently expand the 40 accepted stories.

Current code supplies a Next.js/React/MobX frontend, GraphQL Yoga backend, node-postgres migration runner and shared UI library. Backend currently implements health only; database contains a namespace only. Existing uncommitted UI extraction work must be preserved and included in the feature branch.

Figma file 86N455oNGTMupW2wYsIXkb is open in the user's existing Chrome. Three pages: Page 1, Edge cases & recovery, Page states — complete. The checked-in 187 SVG references and native token inventory support implementation. Main screens cover agency overview, residents/subscriptions, routes/delivery, publications/pricing, billing/route collection, bill editing/recalculation/saving/payment/next resident, payments ledger and appearance. Additional story screens must compose the same design language; they have no full reference frame. Connector-only extraction was replaced with Chrome at the user's request.

## Approach

Extend the existing stack and packages. Keep thin GraphQL resolvers, domain services, SQL repositories and reusable UI presentation. A replacement stack is unnecessary; a frontend-only implementation cannot satisfy persistence, tenant isolation or scheduled jobs. Preserve source IDs in a traceability matrix linking each criterion to implementation, tests and any operational prerequisites.

Only the agent authenticates. Staff and residents are managed records. US-006 mentions Resident/Agent assignment, but does not require a resident login; agent administration satisfies the current application scope. Default currency INR, money stored as integer paise; agency time zone Asia/Kolkata is configurable. Date-only delivery and billing dates must not shift through UTC conversion. No financial arithmetic uses floating point rupee values.

## Tenancy and authentication: US-031

Agency onboarding creates an owner agent and agency atomically. Use password hashing with Node scrypt, opaque random session tokens stored hashed in PostgreSQL, HttpOnly SameSite cookies, secure cookies in production, login throttling, logout and expiration. Same-origin frontend API proxy avoids cross-origin cookie ambiguity. Mutations require trusted origin/CSRF protection. Tenant identity is resolved from the authenticated session, never supplied as an authoritative client argument.

All tenant tables carry agency_id and composite foreign keys to prevent cross-tenant relationships. Repositories run inside transactions with SET LOCAL application tenant context. Enable and FORCE RLS with explicit tenant policies; application database role must not be superuser or BYPASSRLS. Migration/maintenance privileges are separate. Tests use two agencies and a restricted runtime role, including forged identifiers, direct SQL and background jobs. Logs, search, exports, offline queues, AI and files obey the same boundary.

## Domain schema and responsibilities

Versioned SQL migrations define agencies, agents, sessions, territories/sectors, staff, routes, resident drop points, residents, publications/editions/publishing weekdays, effective price rules, subscriptions and recurrence, pause windows, press holidays, route substitutions and split allocations, delivery logs, complaints/resolutions, invoices and immutable invoice lines, ledger entries, payments/allocations/receipts, deposits and clearance settlements, publisher supplies/returns/settlements, payroll rules/attendance/advances/reimbursements/payslips, cash closings/handovers, advertisers/insert orders/proof, merchandise/stock/orders, communication outbox/attempts, preferences, audit events, job runs and backup records. Index tenant/date/status lookups; unique keys enforce idempotency and cycle locks. Use explicit typed APIs rather than arbitrary table-name or JSON CRUD exposed to the browser.

Canonical territory identifiers combine normalized locality, PIN and sector codes. Reject duplicate/overlapping sector assignment; owner-approved override records reason and audit. This is sector jurisdiction validation, not polygon intersection: source has no GIS polygon requirement. Route order is explicit and stable; substitute allocations cannot double-assign a stop on a date and automatically expire without changing permanent assignment.

## Feature coverage

| Stories           | Implementation scope                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001–005           | Territory CRUD/overlap authorization, staff lifecycle, routes/ordered drops/substitutes, multi-publication catalog/procurement counts, residents/deposits                          |
| 006–009, 015      | Multiple subscriptions; all eight cadences; publication-frequency validation; agent assignment/cancellation; bounded holds/resumption; route and depot manifests                   |
| 010–013, 024      | Delivery ledger, automatic marking and exceptions, effective date/weekday pricing, flexible invoice periods, arrears presentation and cycle closing                                |
| 014, 027–030, 032 | Complete English/Malayalam/Hindi UI/reports, mobile field interactions, offline manifests/actions, rapid handover, persisted views and direct contact audit                        |
| 016–018, 021–023  | Full/partial payments, publisher returns/credits, payroll/advances/reimbursements, complaints/replacements/credits, cash reconciliation and advertiser inserts                     |
| 019–020, 025–026  | Localized WhatsApp/SMS outbox, reminders/cooldowns, analytics/Excel/PDF, scheduled morning manifests and deviation alerts                                                          |
| 033–035, 037–039  | Regional/evening publications, merchandise inventory/preorders/charges, credit risk/suspension, multi-staff substitutions, clearance/deposit offset and field QR collection sheets |
| 036, 040          | Tenant-scoped AI operations assistant, safety controls, nightly encrypted cloud backup/retention/verification/alerts                                                               |

## Scheduling, pricing and billing correctness

Expand recurrence in agency local dates: daily, selected weekdays, Sunday, once, weekly, fortnightly anchored to start, monthly and yearly. For absent month dates use last valid day; yearly February 29 uses February 28 in non-leap years. Require selected delivery dates to match publication availability. Holds use inclusive start and exclusive resume date; permanent suspension excludes all subsequent deliveries until resumed. Closed residents receive none after termination. Press holidays exclude deliveries, manifests and billing. One log per subscription/date prevents duplicate automated marking.

Price precedence: explicit date override, bounded weekday override, permanent weekday override, edition weekend/weekday base. Reject overlapping rules at equal precedence. Snapshot actual delivery quantities and rate in invoice lines. Damaged/missed items are charged only when delivered replacement or explicit resolution warrants it; credits post once through linked ledger adjustments. Do not rewrite paid invoices.

Invoice periods cannot double-bill delivery logs. Selected past months include only unbilled eligible logs. Previous debt is displayed as brought-forward balance, never booked again as a new charge. Payments allocate oldest due invoice first unless explicitly targeted, with transactional locking, idempotency keys and no duplicate receipt. Pending/unknown payment outcomes never show success or allow blind retry; reconciliation resolves the same operation. Cheques remain pending until cleared. Confirmed overpayments become account credit; refunds and deposit offsets are separate auditable transactions. A closed cycle is immutable; corrections use adjustment entries in an open cycle. Clearance computes unpaid final deliveries first, then offsets deposit and produces a refund due or collection notice; account closure does not erase history.

Publisher returns are bounded by received stock and configured local cutoff, and use procurement rates/trade margins separately from resident retail rates. Inventory and returns cannot become negative. Payroll uses actual delivery/attendance and rule effective dates; advances cannot be deducted twice. Cash closing separates cash from digital payments, records expenses and sign-off; discrepancies require a reason and retain history.

## Background processing and integrations

Use a separate worker command and PostgreSQL durable jobs/outbox with advisory locking, unique job keys, bounded retries and recoverable lease expiry. Local-time midnight delivery marking, monthly ledger close, configured reminders, 04:00 manifest and nightly backup jobs are catch-up safe. Each tenant runs in its own scoped transaction. No scheduler inside a browser or every web request.

Messaging uses a configurable official provider adapter and localized templates, consent/recipient validation, cooldown deduplication and delivery status callbacks. Implement a test transport for automated tests; production without credentials reports not configured and cannot claim sent. Generate invoice PDFs and real UPI QR payloads server-side with agency payment identity; protect report download authorization and expiry. Direct tel:/WhatsApp links are separate from automated dispatch and log an attempt rather than claim delivery. Do not send real customer communications during development verification.

AI uses a configurable provider behind an authenticated server boundary. Build a limited read-only operational tool set from tenant SQL aggregates; never accept model-generated SQL or tenant identifiers. Handle cross-agency and unsafe requests with polite deflection; minimize resident data sent to the provider. Add adversarial input/output tests and explicit limitations: no general probabilistic model can guarantee zero offensive output. Production AI remains unavailable until provider credentials and data handling choices are configured; deterministic canned responses do not count as completed AI integration.

Backup worker invokes pg_dump with constrained arguments, encrypts using authenticated AES-256-GCM and random nonce with externally configured key, and uploads to configured S3-compatible storage. Multi-region protection requires two configured destinations or verified replication. Record checksum, upload/restore verification, retention tiers and failure alerts; keep encryption keys out of backup objects/logs. Retention only deletes objects owned by this application's backup prefix and verified retention policy. Test encrypted roundtrip/restore in disposable data; never restore into an existing user database during development. No cloud account provisioning or live uploads implied by implementation permission.

## Frontend, offline and fidelity

Implement route-driven app screens composed from @daybook/ui with per-feature MobX state and typed GraphQL calls. Each screen has loading, empty, partial, missing, failure, success and permission/session-expired behavior appropriate to its actions. Forms retain drafts on recoverable error. Billing tracks dirty/recalculated/saved/paid states and prevents stale saves with version checks. Appearance/fonts/layout/language persist per agent and device. Dictionary keys cover all screens, validation, reports and templates; do not treat untranslated fallback as localization completion. Additional Malayalam/Hindi font coverage must be bundled and verified.

IndexedDB caches are scoped by authenticated agency/agent and cleared on logout/account switch. Never display previous tenant data before a new session is verified. Queue only approved delivery/exception/cash operations using stable UUIDs, expected versions and original timestamps. Server validates both tenancy and entity version on sync; older conflicting changes are surfaced for resolution rather than overwriting ledger state. Payments remain pending until acknowledged. Service worker caches static app shell separately from authenticated responses; mobile reconnection and refresh preserve queued work. Swipe has accessible equivalent buttons; touch targets and themes support early morning use.

Verify Figma main frames at reference desktop dimensions and compact widths, plus actual keyboard/mobile interactions. Compare geometry, original assets, typography, palettes, tables and billing states using screenshots. Do not claim pixel equivalence for untested frames or invent Figma designs for the additional story screens.

## Build order and acceptance gates

1. Preserve existing UI work on codex/complete-daybook; record baseline, source inventory, story-to-test matrix and Figma coverage.
2. Auth/session/agency schema, runtime RLS and typed GraphQL foundation. Gate: real PostgreSQL two-tenant isolation and auth tests.
3. Territories, staff, routes, residents/deposits, catalog, subscriptions/cadences/holds and real management screens. Gate: CRUD, invalid dates/relationships and scheduling tests plus browser CRUD.
4. Delivery automation/manifests/substitution/complaints/inserts/merchandise/publisher supply and returns. Gate: holiday/absence/split-route/idempotent jobs and stock tests.
5. Immutable billing/arrears/payments/clearance/payroll/cash closing and billing Figma flow. Gate: concurrency, partial payment, unknown result, duplicate retry, lock and settlement tests.
6. Trilingual reports/analytics, contact/outbox/reminders, field/offline UX, appearance and keyboard/responsive states. Gate: exports, translation completeness, offline/reconnection/conflict and visual checks.
7. Configurable AI and backup integrations with local contract tests and operational setup documentation. Gate: tenant adversarial cases, encryption/upload/retention/restore tests and accurate configuration status.
8. Independent subagent review against all 40 stories and Figma matrix. Fix actionable findings, add regression tests and request fresh review of fixes until no actionable findings remain. Run typecheck/lint/tests/build/Storybook, database integration suite and browser workflows. Merge to main only after clean review and checks; report any credential-dependent acceptance not exercised live. No deployment or remote push is assumed.

## Review and completion evidence

Independent reviewers receive requirements, diff/base/head and test commands, without the implementer's conversational history. Review includes security, financial invariants, race/conflict cases, reference fidelity and operational claims. Disputed findings require reproducible evidence and reviewer resolution; findings cannot be discarded just to reach zero. A clean review means no identified unresolved issue, not a guarantee of zero bugs. Required credentials/infrastructure cannot be disguised as passing live acceptance tests. Completion matrix distinguishes implemented/tested, integration contract tested, and live configuration/verification pending.

## Risks and builder decisions

### Independent builder check: proposed policy defaults for owner approval

A fresh reviewer identified five material policy gaps. The following are proposed implementation defaults, not source requirements or previously approved owner decisions:

- Cash discrepancies create an agency suspense/discrepancy memo, never an automatic staff liability or payroll deduction. The agent must explicitly resolve liability, with reason and audit, before a separately recorded payroll adjustment.
- Staff pay rules explicitly choose unprorated monthly salary or calendar-day proration for effective employment dates and unpaid leave; default is calendar-day proration with paid leave preserved. Per-copy commission is credited once per original fulfilled delivery to the staff actually assigned on that date, including a substitute; replacement copies earn no extra commission by default. Earnings preview exposes the inputs and requires confirmation before posting. Rules are effective-dated and snapshotted.
- Monthly closing locks and summarizes the cycle; it does not silently issue invoices. Automatic invoice issuance is an explicit agency setting, off initially. Invoice payment terms default to seven calendar days from issue and are configurable; only positive outstanding balances past the due date are overdue. Closed delivery records may be invoiced once afterward, without rewriting delivery facts.
- Tax summaries export explicitly configured and recorded tax codes, rates, taxable amounts and tax amounts by item class. Defaults impose no inferred tax rates or claims of statutory compliance. An agency must configure its tax treatment before tax-bearing invoices are finalized; a no-tax agency choice is explicit. Reports separate newspaper, merchandise and advertiser insert activity.
- Publisher procurement unit rate is net cost after trade margin; the UI accepts either net cost directly or list price plus margin to derive it, never both cumulatively. Validated returns credit the original supplied lot's snapshotted net cost. Returns reference a supply lot, cannot exceed remaining eligible quantity and preserve that cost when later prices change.

The design approval includes these defaults; the owner can change any before implementation. Context7's GraphQL Yoga documentation was consulted for authenticated per-request context, cookie integration and default error masking; implementation must preserve masked unexpected errors rather than expose database internals.

Full scope spans 40 stories/246 points. Build incrementally without reducing criteria to mock screens. Preserve existing UI work; do not stage unrelated changes. Use real disposable PostgreSQL for financial/RLS integration tests. If local database tooling is unavailable, implement portable setup and report the gate blocked rather than substitute in-memory tests. Dependency additions should be narrow (QR/PDF/XLSX, validated schemas, cloud SDK and required fonts). Existing libraries remain authoritative unless a documented capability gap requires an addition.

Implementation details such as component file boundaries, exact index names, worker polling interval and supported provider adapters are builder choices, documented and tested. Product-level unresolved interpretation is raised before building a conflicting workflow. The user has authorized the final local merge, but not bypassing failing checks, modifying protected remote branches, or claiming unconfigured integrations work.
