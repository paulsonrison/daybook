# Analytics and monthly report definitions

These definitions guide P11 implementation. A definition here does not mean its feature is complete. Every report identifies its selected sales month, generation time and the separate date used for current balances.

## Amounts and consistency

Amounts remain integer paise through aggregation and become decimal rupee strings at the API boundary. PostgreSQL 17 returns `numeric` from `sum(bigint)` and returns null for an empty sum; use explicit zero defaults and text/BigInt conversion, including when the aggregate exceeds a single ledger row's bigint limit. Never aggregate money through JavaScript Number.

Use the existing tenant-scoped `financialRead` configuration lock. All relevant application/worker financial and delivery writes acquire its exclusive counterpart. Keep every source query inside that same transaction/client; do not open nested pool transactions. The selected month does not turn current balances into historical balances.

Official references: [aggregate functions](https://www.postgresql.org/docs/17/functions-aggregate.html), [snapshot consistency and explicit locks](https://www.postgresql.org/docs/17/applevel-consistency.html). Context7 retrieved these PostgreSQL 17 references; the disposable verification database runs 17.11.

## Sales and receipts

| Measure                            | Recorded source and definition                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Resident invoiced sales            | Sum signed `INVOICE` and `INVOICE_REVISION` ledger amounts by `entry_date`. Revisions are deltas, not another full sale. They restate the original issue month. Exclude brought-forward balances, account adjustments, payments and deposits.                            |
| Cash merchandise sales             | Sum `merchandise_charges.amount_paise` for CASH settlement by `charge_date`. Invoice-settled merchandise is already included in resident invoices and must not be added again.                                                                                           |
| Advertiser sales                   | Separately show issued advertiser invoice subtotal and recorded tax by `issued_date`.                                                                                                                                                                                    |
| Recorded sales total               | Resident invoiced sales plus cash merchandise charges plus advertiser subtotal. This operational amount does not assert a missing tax classification or statutory revenue treatment; expose unclassified amounts in tax exports.                                         |
| Confirmed account receipts         | Confirmed ACCOUNT payments by posting date, with original payment method. Pending/failed cheques or transfers do not count.                                                                                                                                              |
| Collected cash from accounts/sales | Confirmed ACCOUNT cash payments plus cash merchandise receipts. Refundable deposits are separate liabilities, not this sales/collection KPI.                                                                                                                             |
| Deposit receipts                   | Confirmed DEPOSIT payments plus opening RECEIVED deposit entries without a corresponding payment. Use the canonical `collection_sources` view to avoid duplication. Opening deposits have UNKNOWN method until supported by recorded evidence; do not relabel them CASH. |
| Handovers and bank deposits        | Custody movements of existing money, not additional customer receipts or sales.                                                                                                                                                                                          |
| Refunds                            | Confirmed clearance refund rows by posting date, split into deposit and account-credit portions and method. Do not subtract them from sales a second time using ledger refund rows.                                                                                      |

Receipts can recover earlier debt. Any receipts-to-sales comparison must disclose that basis and may exceed 100%; a zero or negative denominator gives no percentage. It must not imply that current-month receipts belong exclusively to current-month invoices.

## Current balances and aging

Reuse the financial-resident ledger/settlement rules and include inactive, suspended and closed accounts. Current outstanding is the sum of positive account balances; credit balances are a separate positive total. Do not net one customer's credit against another customer's debt.

Aggregate settlements before joining to debits. Age remaining debits by their due dates, with overdue beginning strictly after the due date. Distinguish not-due, 1–30, 31–60, 61–90 and over-90-day amounts. Reconcile the displayed aging basis with outstanding balances and disclose any unallocated credit rather than silently altering the ledger. These are current figures even when the sales selector shows a previous month. If unapplied legacy credit prevents determining which past-due debits remain, net overdue is unavailable; gross unsettled overdue and the unallocated credit offset remain separately visible. Never guess an allocation.

## Circulation and route contribution

Historical circulation uses recorded delivery dates and snapshots. Count original fulfilled quantities once; REPLACED is a resolution of an original delivery, not an additional original subscription delivery. Separately identify replacement copies, chargeable copies, distinct residents and distinct subscriptions. Replacement counts are attributed to the original delivery date, not an invented replacement issue date. Prepared-day coverage compares recorded preparation with elapsed calendar days; it is not a claim about scheduled working days. Missing prepared days are not asserted zero circulation.

Today's scheduled copies use current scheduling, press holidays and holds and carry that basis/date. They are not mixed with completed recorded copies.

Existing delivery records have no historical procurement-cost snapshot or supply-lot allocation. Do not fill that gap using today's publication cost. Add a forward-only unit-cost snapshot for deliveries first prepared on the current agency date; leave backfilled past deliveries and older rows unrecorded. Preserve the original snapshot across reruns and publication-cost changes. A publication-rate snapshot is a cost estimate, not proof of which supplier lot was consumed.

Route contribution coverage remains partial when original missed, damaged or credited copies lack attributable expense evidence. Their excluded quantity is explicit even if fulfilled-copy procurement and payroll coverage are complete; neither original losses nor replacement costs are assumed zero.

Route output separates recorded chargeable retail value, available procurement estimates, missing-cost coverage, replacement copies, attributable posted payroll accrual and advertiser revenue supported by packed route allocations. Salary/shared adjustments and unallocated procurement returns stay separately disclosed. Advances are financing recovery, and payroll payouts are cash outflows rather than a second labor expense. Do not call a contribution estimate net profit or silently allocate shared costs. Posted payroll coverage concerns the evidence in issued payslips only; route copy coverage separately identifies delivered copies without supported posted payroll cost. Unsupported snapshots withhold full expense totals and expose a known subtotal. Neither payroll advances nor zero-net payslips erase earned accrual.

## Customer history and churn

Closure counts use clearance termination dates. A cancelled subscription alone is not household churn. Temporary inactivity or a credit hold is not a closed account.

If a rate is supported, define its cohort as recorded open customer accounts at the start of the month and disclose registration/termination sources. Creation audits can support a recorded-registration cohort, not an invented historical active-status history. Missing creation/closure evidence or activity predating registration makes historical coverage partial; show the closure count and an unavailable rate instead of guessing its denominator. Zero starting accounts also gives no rate.

## Export integrity

Monthly operations, sales and tax outputs reuse the same snapshot and definitions. Preserve immutable generation-time data and locale in authenticated report artifacts. Tax output contains only recorded treatment/classification, taxable amounts, rates and tax amounts; missing classification remains unavailable. No jurisdictional rate or retrospective tax policy is inferred.

Native labels never change identifiers, dates, weekday indices or amounts. PDF text uses bundled fonts; XLSX cells containing customer text are strings, never formulas. Output limits and missing-source coverage must be visible rather than silently truncating a comprehensive report.
