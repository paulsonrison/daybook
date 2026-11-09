# Daybook implementation task board

Branch: `codex/complete-daybook` · Design: approved · Implementation plan: approved.

Lifecycle: **Not started → To do → In review → Done**. Move to To do immediately before implementing; move to In review after code and checks; review fixes return to To do. Done requires clean independent review and verified merge to main. No live-service gate passes without actual evidence.

See [implementation plan](superpowers/plans/2026-11-09-complete-daybook.md), [approved design](superpowers/specs/2026-11-09-complete-daybook-design.md), [structured tasks and history](tasks.json), and [acceptance evidence](acceptance-matrix.md).

| Task   | Work                                          | Plan | Priority | Status      |
| ------ | --------------------------------------------- | ---- | -------- | ----------- |
| P00    | Preserve UI foundation, baseline and tracking | P00  | Gate     | In review   |
| US-001 | Area Jurisdiction                             | P02  | High     | Not started |
| US-002 | Staff Management                              | P02  | High     | Not started |
| US-003 | Route Division                                | P02  | High     | Not started |
| US-004 | Catalog & Inventory                           | P03  | Medium   | Not started |
| US-005 | Resident Management                           | P03  | High     | Not started |
| US-006 | Multi-Subscription Master                     | P04  | High     | Not started |
| US-007 | Custom Cadence & Schedules                    | P04  | High     | Not started |
| US-008 | Agent Subscription Assignment                 | P04  | Medium   | Not started |
| US-009 | Daily Dispatch & Manifest                     | P05  | High     | Not started |
| US-010 | Schedule-Aware Billing                        | P07  | Medium   | Not started |
| US-011 | Automated Delivery                            | P05  | High     | Not started |
| US-012 | Dynamic Pricing Engine                        | P04  | High     | Not started |
| US-013 | Flexible Billing & Arrears                    | P07  | High     | Not started |
| US-014 | Trilingual UI Localization                    | P11  | Medium   | Not started |
| US-015 | Vacation & Temporary Holds                    | P04  | High     | Not started |
| US-016 | Payment & Reconciliation                      | P08  | High     | Not started |
| US-017 | Publisher Indents & Returns                   | P06  | Medium   | Not started |
| US-018 | Staff Payroll & Commission                    | P09  | High     | Not started |
| US-019 | WhatsApp & SMS Dispatch                       | P10  | High     | Not started |
| US-020 | Agency Analytics & Reporting                  | P11  | Medium   | Not started |
| US-021 | Delivery Exceptions & Grievances              | P05  | Medium   | Not started |
| US-022 | Daily Cash Register & Closing                 | P09  | High     | Not started |
| US-023 | Pamphlet & Insert Operations                  | P06  | High     | Not started |
| US-024 | Automated Ledger Closing                      | P07  | High     | Not started |
| US-025 | Automated Payment Alerts                      | P10  | Medium   | Not started |
| US-026 | Automated Daily Manifest Cron                 | P05  | High     | Not started |
| US-027 | Field Delivery UI                             | P05  | High     | Not started |
| US-028 | Offline Delivery Sync                         | P12  | High     | Not started |
| US-029 | Rapid Cash Handover UI                        | P09  | Medium   | Not started |
| US-030 | UI Customization                              | P11  | Medium   | Not started |
| US-031 | Multi-Tenant Architecture                     | P01  | High     | Not started |
| US-032 | Direct Communications                         | P10  | Medium   | Not started |
| US-033 | Regional Publications                         | P03  | Medium   | Not started |
| US-034 | Seasonal Merchandise                          | P06  | Medium   | Not started |
| US-035 | Credit Control & Suspension                   | P08  | High     | Not started |
| US-036 | AI Assistant & Support                        | P13  | High     | Not started |
| US-037 | Emergency & Route Reallocation                | P05  | High     | Not started |
| US-038 | Resident Settlement & Clearance               | P08  | High     | Not started |
| US-039 | Field Collection Run-Sheets                   | P08  | High     | Not started |
| US-040 | Automated Cloud Backup                        | P13  | High     | Not started |
| P14    | Whole-project acceptance review and merge     | P14  | Gate     | Not started |

## Current state

The owner approved the detailed plan. P00 is In review: both independent findings resolved and browser regressions passed; no story is labeled implemented, reviewed or merged. Existing UI work is preserved, awaiting current baseline verification and independent review in P00.

## Review policy

Each completed task receives a fresh-context subagent review against source criteria and its diff. Fix valid comments with regression checks and repeat review. Reviewer findings and resolutions are retained in the structured board. Main receives the branch only after the whole-project review and verification gate.
