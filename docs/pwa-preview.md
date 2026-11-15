# Daybook PWA and free preview

Install Daybook from Chrome's menu or the field screen's Install button when offered. On iPhone, use Safari's Share → Add to Home Screen. The same website runs in a standalone window; no app-store installation is needed.

Open **Field workspace** from the agency navigation. While connected, choose a route/date and download it. Delivery rows must already be prepared in the daily delivery log. The field workspace downloads at most 500 residents and 2,000 delivery rows for one route. It uses the shared local Daybook brand, Inter font and theme styles.

While the verified screen remains open, downloaded details, delivery updates and actual cash entries work offline. Entries stay on this device as **pending**, without a receipt or ledger change. Use **Sync pending entries** when connected. A confirmed cash entry displays its server receipt code. Lost acknowledgements retry the original identifier and do not create another receipt.

An offline reload opens a locked shell. Reconnect and select **Verify account** before viewing saved details. This preserves pending entries while preventing a previous account's data from appearing without a current session check. Session expiry pauses replay. Signing out or verifying a different account clears downloaded details and queued proposals; the sign-out control asks before clearing. If device storage cannot be cleared, the screen locks and tells you to clear Daybook site data in the browser before sharing the device.

Changed records remain **Needs review** with the original proposal. Compare against current server records before discarding a reviewed proposal. Discarding does not reverse server activity. Download fresh details before re-entering it. Offline cash only supports actual received cash against an account, not deposits, cheques, invoices or payroll.

## Hosting configuration

`render.yaml` defines a separate free preview in Singapore: one combined Node web service and one private free PostgreSQL 17 database. The launcher prepares migrations with the database owner, then starts the API using a separate restricted login. The frontend receives no database or provider credentials. The health check verifies frontend, API and database availability.

The Blueprint must use **create new resources**, not adopt the existing PressTrack service. Automatic sync/deploy is disabled for controlled preview publication. Generated passwords and the document-signing secret stay in Render environment storage. AI and messaging providers are disabled by default.

This is a **test-data preview**, not whole-project acceptance. P11 exports, full translation coverage, AI document intake, backups and final Figma acceptance remain open. This deployment does not run an always-on scheduler or communications worker. Free services sleep when idle; free PostgreSQL expires after 30 days and has no managed backups. No paid resource, persistent disk or custom purchased domain is configured. See [Render's free limits](https://render.com/docs/free).

## Maintenance

Frontend `prebuild` copies the existing shared styles/brand/font and hashes the public shell assets into the service-worker cache version. Keep `field.js`, `database.js` and the shell allowlist in sync. Never add authenticated pages, GraphQL/auth responses, documents or reports to that list. Worker updates preserve IndexedDB; obsolete shell caches are removed only on activation.

Local checks: workspace typecheck, lint, unit checks; real PostgreSQL `field.test.ts`, `payments.test.ts`, `delivery.test.ts`, `preview-bootstrap.test.ts`; Chrome `pwa.spec.ts`. The existing unfinished monthly-report API acceptance remains red and is unrelated to this PWA slice.
