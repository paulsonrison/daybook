# Daybook implementation task board

Branch: `codex/complete-daybook` · Design and implementation plan: approved.

Lifecycle: **Not started → To do → In review → Done**. Review findings return work to To do; Done requires clean independent review and verified merge to main.

[Plan](superpowers/plans/2026-11-09-complete-daybook.md) · [Design](superpowers/specs/2026-11-09-complete-daybook-design.md) · [Task history](tasks.json) · [Acceptance evidence](acceptance-matrix.md) · [Review ledger](implementation-progress.md)

## Implementation work packages

| Task | Work                                                        | Status      |
| ---- | ----------------------------------------------------------- | ----------- |
| P00  | Preserve UI foundation, baseline and tracking               | In review   |
| P01  | Agent authentication and tenant database boundary           | In review   |
| P02  | Territory, staff and ordered route management               | In review   |
| P03  | Publications, residents and refundable deposits             | In review   |
| P04  | Subscription recurrence, holds and effective pricing        | In review   |
| P05  | Delivery operations, substitutions and exceptions           | In review   |
| P06  | Supply, returns, seasonal stock and inserts                 | In review   |
| P07  | Invoice engine, arrears and immutable closing               | In review   |
| P08  | Payments, clearance, credit limits and collection sheets    | In review   |
| P09  | Staff pay, attendance, handover and cash closing            | In review   |
| P10  | Durable worker, localized communications and direct contact | Not started |
| P11  | Complete localization, reporting, analytics and appearance  | Not started |
| P12  | Offline field sync and installable app shell                | Not started |
| P13  | Tenant AI assistant and encrypted cloud backup              | Not started |
| P14  | Whole-project acceptance review and merge                   | Not started |

## Source user stories

| Story  | Work                             | Plan | Priority | Status      |
| ------ | -------------------------------- | ---- | -------- | ----------- |
| US-001 | Area Jurisdiction                | P02  | High     | In review   |
| US-002 | Staff Management                 | P02  | High     | In review   |
| US-003 | Route Division                   | P02  | High     | In review   |
| US-004 | Catalog & Inventory              | P03  | Medium   | In review   |
| US-005 | Resident Management              | P03  | High     | In review   |
| US-006 | Multi-Subscription Master        | P04  | High     | In review   |
| US-007 | Custom Cadence & Schedules       | P04  | High     | In review   |
| US-008 | Agent Subscription Assignment    | P04  | Medium   | In review   |
| US-009 | Daily Dispatch & Manifest        | P05  | High     | In review   |
| US-010 | Schedule-Aware Billing           | P07  | Medium   | In review   |
| US-011 | Automated Delivery               | P05  | High     | In review   |
| US-012 | Dynamic Pricing Engine           | P04  | High     | In review   |
| US-013 | Flexible Billing & Arrears       | P07  | High     | In review   |
| US-014 | Trilingual UI Localization       | P11  | Medium   | Not started |
| US-015 | Vacation & Temporary Holds       | P04  | High     | In review   |
| US-016 | Payment & Reconciliation         | P08  | High     | In review   |
| US-017 | Publisher Indents & Returns      | P06  | Medium   | In review   |
| US-018 | Staff Payroll & Commission       | P09  | High     | In review   |
| US-019 | WhatsApp & SMS Dispatch          | P10  | High     | Not started |
| US-020 | Agency Analytics & Reporting     | P11  | Medium   | Not started |
| US-021 | Delivery Exceptions & Grievances | P05  | Medium   | In review   |
| US-022 | Daily Cash Register & Closing    | P09  | High     | In review   |
| US-023 | Pamphlet & Insert Operations     | P06  | High     | In review   |
| US-024 | Automated Ledger Closing         | P07  | High     | In review   |
| US-025 | Automated Payment Alerts         | P10  | Medium   | Not started |
| US-026 | Automated Daily Manifest Cron    | P05  | High     | In review   |
| US-027 | Field Delivery UI                | P05  | High     | In review   |
| US-028 | Offline Delivery Sync            | P12  | High     | Not started |
| US-029 | Rapid Cash Handover UI           | P09  | Medium   | In review   |
| US-030 | UI Customization                 | P11  | Medium   | Not started |
| US-031 | Multi-Tenant Architecture        | P01  | High     | In review   |
| US-032 | Direct Communications            | P10  | Medium   | Not started |
| US-033 | Regional Publications            | P03  | Medium   | In review   |
| US-034 | Seasonal Merchandise             | P06  | Medium   | In review   |
| US-035 | Credit Control & Suspension      | P08  | High     | To do       |
| US-036 | AI Assistant & Support           | P13  | High     | Not started |
| US-037 | Emergency & Route Reallocation   | P05  | High     | In review   |
| US-038 | Resident Settlement & Clearance  | P08  | High     | In review   |
| US-039 | Field Collection Run-Sheets      | P08  | High     | In review   |
| US-040 | Automated Cloud Backup           | P13  | High     | Not started |
