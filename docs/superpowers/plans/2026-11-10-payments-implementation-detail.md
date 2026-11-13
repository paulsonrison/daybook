# P08 implementation detail

This expands the approved payments, clearance, credit-control and collection-sheet package. P07 commit: 31fca14.

1. Add forced-RLS payment intents with immutable amount/resident/purpose/channel identity, durable request keys, one unresolved operation per resident/purpose, external-reference uniqueness, explicit pending/confirmed/failed states and versioned reconciliation. Only confirmed funds create a receipt and ledger/deposit effect.
2. Cash, UPI and bank receipts require agent attestation. Cheques always start pending and need an explicit clearing decision. A QR scan or app return is not confirmation. Reconciliation resolves the original operation and cannot create a second charge/receipt. Receipt views state their manual confirmation source.
3. Reuse the signed ledger and exact oldest-due allocation, with optional explicit invoice targeting; confirmed overpayments remain account credit. Deposit receipts remain a separate liability. Keep historical deposits usable without inventing missing channel/reference data.
4. Clearance previews include unbilled recorded final deliveries and merchandise through the effective termination date. Require a current fingerprint and completeness acknowledgement before final posting; issue any final bill, offset only available deposit against actual positive debt, retain refund due/account credit or collection notice, cancel future service and archive without deleting history. Record confirmed refunds separately.
5. Add configurable exact amount/overdue-day thresholds, measured dashboard alerts and explicit suspension. Queue a notification intent rather than claim a message was sent; real provider dispatch and its status are P10.
6. Build route/drop-ordered collection sheets from current confirmed balances and oldest open due date. Exclude suspended/inactive/closed service from field collection runs. Generate genuine PNG QR images only from a configured agency UPI identity and positive exact amount; missing identity is an explicit unavailable state. Use the official Node QRCode server API and documented UPI URI fields.
7. Add agent payment/reconciliation, deposit, clearance and field/batch collection controls from shared UI. Keep the original request body across an uncertain outcome and check/retry that operation. Partial receipts retain the unpaid balance; pending or failed operations never display Paid.
8. Observe RED tests, implement each slice, verify actual PostgreSQL/Chrome behavior, obtain independent review, fix/rereview, update the task board and commit. Merge waits for P14.

Ruling: recording and reconciling receipts are agency-agent attestations, not a bank/provider verification claim. No configured payment gateway exists. Digital funds remain pending until the agent records confirmation evidence; cheques require clearing evidence. QR payload generation alone cannot settle an invoice.

Ruling: use separate receipt dates and open-period ledger posting dates so a newly confirmed payment cannot rewrite a closed cycle. Clearance cannot confirm termination after today; scheduled future vacation/termination preparation remains a hold until its effective date.

References: [Node QRCode server API](https://github.com/soldair/node-qrcode#tostringtext-options-cberror-string), [Google Pay UPI intent parameters](https://developers.google.com/pay/india/api/android/in-app-payments). Context7 retrieved the Node QRCode server SVG/PNG APIs before implementation.
