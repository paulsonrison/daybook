# P07 implementation detail

This expands the approved P07 work package; it does not replace its scope or review/merge gates.

1. Validate and normalize date-only monthly, weekly, custom and selected-month periods. Preview only recorded delivery and fulfilled merchandise sources, and expose missing preparation days.
2. Add forced-RLS invoices, immutable revisions/lines, unique source claims, signed resident ledger entries and immutable debit/credit settlements. New invoices post current charges; previous debt is displayed from its original entries.
3. Use explicit bill correction reasons for editable quantities/rates shown in the Figma editor. Preserve source quantities/rates in the invoice snapshot and retain original delivery logs. Closed source periods stay unchanged; posted financial revisions record their delta in the open issue period.
4. Require a matching preview fingerprint and expected invoice version on save. Stable request keys prevent duplicate invoices; source claims prevent charging the same delivery/item twice across overlapping periods.
5. Reuse the ledger settlement layer for confirmed payments in P08. Allocate available credits against real debit entries in due-date order; allocating funds must never create another debt or credit posting.
6. Lock paid invoices and closed financial periods, while allowing later payments to settle their existing debit entries. Complaint corrections after invoicing become separately audited current-period adjustments. A delivery receives one replacement-or-credit benefit; additional goodwill is an explicit account adjustment.
7. Close monthly source cycles with immutable summaries. Automatic issuing stays off by default. When explicitly enabled, closing queues one durable issuing job per resident rather than one unbounded transaction.
8. Compose the collection run-sheet and editor/recalculated/saved/next-resident states from shared UI, using decimal strings throughout. P08 supplies the paid/receipt workflow.
9. Observe meaningful failing tests, implement, run financial/concurrency and browser regressions, obtain independent review, fix and rereview, then checkpoint. Merge remains gated on the complete project.

Ruling: Figma quantity/rate edits are explicit audited billing corrections; they do not rewrite frozen delivery history. A saved invoice retains source and charged values. This preserves closed-cycle auditability while supporting the approved editor behavior; an incorrect correction requires a further explicit adjustment.

Ruling: absent delivery preparation is unknown, not zero. Saving a reviewed partial record requires an explicit completeness acknowledgement; automatic issuing cannot silently accept missing preparation days.
