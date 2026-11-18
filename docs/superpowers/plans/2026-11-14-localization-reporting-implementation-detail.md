# P11 Localization, Reporting and Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Continue the approved inline implementation and independent review loop.

**Goal:** Complete US-014, US-020 and US-030 with translated operational screens, reconciled analytics, real exports and scoped persisted preferences.

**Architecture:** Extend the existing tenant-scoped GraphQL modules and shared UI. Reports read recorded financial and delivery sources; exports reuse immutable snapshot presentation and the bounded PDF renderer. Preferences belong to an authenticated agent, with a separately scoped device layout override. Translation is explicit at component/API boundaries rather than post-processing rendered DOM.

**Tech Stack:** Existing Next/React/MobX, GraphQL Yoga, PostgreSQL, TypeScript and shared UI; embedded Inter/Noto Malayalam/Devanagari fonts. Select an XLSX writer only after verifying its official documentation, installed version and dependency/security impact.

**Spec:** `docs/superpowers/specs/2026-11-09-complete-daybook-design.md`; approved P11 in `docs/superpowers/plans/2026-11-09-complete-daybook.md`; US-014/020/030 in `docs/user-stories-source.json`.

**Documentation research:** Context7 retrieved the official [`write-excel-file` API](https://gitlab.com/catamphetamine/write-excel-file/-/blob/main/_autodocs/api-reference/writeXlsxFile.md) and [cell types](https://gitlab.com/catamphetamine/write-excel-file/-/blob/main/_autodocs/types.md): Node output supports a buffer/stream and explicit String cells differ from Formula cells. This is a candidate, not an installed or version-verified dependency. It also retrieved Yoga's [result-processing hook types](https://github.com/graphql-hive/graphql-yoga/blob/main/packages/graphql-yoga/src/plugins/types.ts), which expose the request, server context and replacement result. Check the installed Yoga types and selected writer release before adopting either API; test concurrent locale isolation and actual XLSX string/formula behavior.

## Execution ruling — 15 November

The translation foundation and catalogue flows are verified. Keep Task 2 open while implementing Tasks 3–5: its acceptance includes report screens and export templates that those tasks create. Add their dictionary entries with the implementation, then return to complete all remaining business-screen translations and run the full translation gate before closing P11. This changes the order of the closing translation pass, not its scope or acceptance. P12 still depends on a completed P11.

## Global constraints

- “Dictionary keys cover all screens, validation, reports and templates; do not treat untranslated fallback as localization completion.”
- “Appearance/fonts/layout/language persist per agent and device.”
- “Additional Malayalam/Hindi font coverage must be bundled and verified.”
- Keep exact paise arithmetic, existing financial posting rules, immutable issued snapshots and forced tenant RLS. Display preferences never change authorization or financial calculation.
- No real messaging, payment, deployment or cloud changes during verification. Main merge remains P14 after all work packages.

## Review focus

- An agency switch, expired session or late response must not display or save another agent's preferences or reports.
- Historical report corrections must retain their recorded date and classification; cash receipt, invoice revenue, deposits, salary accrual and actual payouts remain distinct.
- Route contribution cannot silently allocate agency-wide costs or claim that missing procurement/earnings data means zero cost.
- Translation must cover variable validation messages and recovery states without translating identifiers, customer-entered names or protocol values.
- Spreadsheet formulas, escaped PDF text, large monetary values, empty months and partial source data need explicit output checks.

## Files and interfaces

- `packages/ui/src/i18n/{en,ml,hi}.ts`, translation types/helper/provider and shared component label contracts: catalogues and explicit formatted messages.
- `apps/backend/db/migrations/012_agent_preferences_reports.sql`, `modules/preferences/{service,schema}.ts`: `agentPreferences` and optimistic/idempotent `saveAgentPreferences`, with forced agent/tenant scope and audit.
- `apps/frontend/src/features/preferences/*`, auth workspace/header, shared Theme and operational layout hosts: language switcher, persisted appearance and table/card/route views. Scope device storage by agency and agent.
- `modules/analytics/{model,service,schema}.ts`: `agencyAnalytics(input)` with validated month/date boundaries, source definitions and exact reconciliations.
- `modules/reports/{model,service,export,http}.ts`, protected frontend report proxy and analytics/report screen: authenticated `exportReport` and narrow PDF/XLSX downloads. Use bounded snapshots/artifacts rather than returning bulk binary data in GraphQL.
- Existing business screens, shared recovery components, validation boundaries and document templates: explicit dictionary use and translation coverage.
- Integration/unit/browser tests, setup/report definitions, acceptance matrix and task ledger.

## Task 1 — Scoped preferences and language boundary

- [x] Move P11 and US-014/020/030 from Not started to To do after P10 is checkpointed.
- [x] Write and run failing preference tests: two tenants/agents, invalid typography/locale/layout, stale versions, original-request replay, logout/session change and retained device choice.
- [x] Implement only supported locale/theme/font/layout values, forced RLS, agent identity from the session, immutable audit and current-value replay. Reuse shared theme validators.
- [x] Add the visible workspace language switcher and appearance route; keep unsaved form drafts and pending operations independent of preference saves.
- [x] Run targeted database/browser checks; review and correct this deliverable before proceeding.

## Task 2 — Complete translation inventory and catalogues

- [ ] Inventory executable UI labels/table headers/hints/recovery messages and backend/auth validation, separating user data, paths and protocol enums. Add a checked inventory/coverage test first and observe missing translations fail.
- [ ] Implement en/ml/hi catalogues with identical nonempty keys, typed interpolation/plural rules, shared labels and request-scoped error formatting. Preserve machine error codes and original-operation behavior.
- [ ] Convert every operational/auth screen, shared control and dynamic validation/template/report message. Do not satisfy coverage with English fallback or DOM text replacement.
- [x] Verify installed framework/Yoga localization boundaries against official Context7 documentation before choosing request hooks. Concurrent requests with different locales must remain isolated.
- [ ] Test English/Malayalam/Hindi navigation, validation, pending/error/success/missing states and actual PDF text/fonts. Persist the selected agent locale across refresh/sign-in without leakage.

## Task 3 — Reconciled analytics

- [x] Write failing exact-source tests for monthly invoiced sales, confirmed collections by method, current outstanding/overdue debt, active circulation, publication readership, trends and churn. Include revisions, partial payments, refunds, deposits, cancelled subscriptions and amounts beyond floating-point precision.
- [x] Define revenue, cash collections, accrual costs, actual payouts and agency balances separately in a report contract. Reuse ledger/settlement and financial-resident rules rather than summing issued invoice totals twice.
- [x] Implement tenant/date-bound aggregation; use recorded delivery retail/procurement snapshots and attributable payroll/route costs for route contribution. Show unallocated shared costs and missing cost coverage explicitly. Do not invent a cost allocation or historic customer status.
- [x] Add arrears aging from unpaid debit due dates and settlements; expose source dates, denominators and unavailable/partial classifications. Reconcile chart totals to their KPI source figures.
- [x] Compose the overview and analytics screens from shared metrics/chart/table/card states; verify empty/loading/error/partial behavior and keyboard/mobile use.

## Task 4 — Authenticated monthly PDF and XLSX reports

- [x] Verify the installed `write-excel-file` 4.1.1 API/dependency impact; test genuine XLSX roundtrip, authenticated export and tenant isolation.
- [x] Build bounded monthly operations, sales and recorded-tax snapshots from the same locked analytics sources. Tax rows include only recorded no-tax confirmation or tax amounts; empty source data is disclosed and no jurisdictional rate is invented.
- [x] Reuse escaped shared report presentation, bundled fonts and the existing bounded, sandboxed PDF renderer. Dedicated report/artifact tables preserve immutable snapshots and issued output.
- [x] Reject formula injection, unsafe filename input, foreign artifact IDs and invalid/oversized periods. Test exact values beyond floating point, localized labels, real PDF/XLSX content, authenticated GET/HEAD and immutable snapshots.
- [x] Provide preparing/ready/error/retry/download states and retain original preparation/generation identities across lost responses. Owner downloads are authenticated and do not use resident bearer links.

Task 4 verification: 75 backend unit tests pass; focused report PostgreSQL acceptance passes with a real Malayalam PDF, embedded font, genuine Hindi XLSX bank-method label, formula-string cells, precise snapshot replay, and cross-tenant denial. Existing financial-document PDF integration passes 5/5. The report retry/download browser test passes with both preparation and generation responses deliberately lost and safely retried. Independent report and renderer rereviews are clear. P11 remains To do because localization coverage and Task 5 appearance/layout/whole-P11 gates are still open.

## Task 5 — Layout, appearance and whole-P11 acceptance

- [ ] Write failing table/card/route-view and scoped persistence tests. Use route sequence when no recorded coordinates exist; do not invent a map.
- [ ] Apply the persisted layout through shared list hosts, retain filters/selection/drafts, and compose responsive desktop/tablet/compact states from existing UI tokens.
- [ ] Compare overview/appearance against local Figma references and the already-open Chrome design; retain exact whole-project visual review for P14.
- [ ] Run translation inventory, unit/type/lint/build/format, real database, export and browser checks. Obtain independent security/financial/UI reviews, fix findings and rereview.
- [ ] Record actual evidence, move P11/story tasks to In review and commit the verified feature-branch checkpoint. Keep all tasks out of Done until the final main merge.
