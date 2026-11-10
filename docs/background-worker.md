# Background preparation

Run the worker separately from the web API, using the same restricted runtime database connection after applying migrations:

```powershell
npm run worker -w @daybook/backend
```

After a production build, use `npm run worker:start -w @daybook/backend`. The worker polls every 30 seconds and respects each agency's IANA timezone. It queues delivery marking at local midnight and morning/evening manifests after 04:00. Unique tenant/job/date keys, transaction-scoped configuration locks and delivery/subscription/date keys prevent duplicate preparation. Expired leases are recoverable, retries stop after five attempts, and failures remain recorded for inspection.

Catch-up is bounded to 31 calendar days per agency per pass. Multiple worker instances may share the queue. A narrow security-definer function returns only agency identifiers, timezone and creation timestamp to enumerate schedules; normal reads and all operational work remain tenant-scoped with forced row security. The function owner cannot log in and is not granted to the application role.

Recorded past delivery days and existing historical manifests are preserved when present-day profiles or subscriptions change. A first backfill can only use the configuration currently available; it cannot reconstruct unrecorded historical household changes. Dated staff corrections are explicit, audited substitute-assignment operations. Posted financial records receive additional immutable-cycle gates in P07.

Development verification runs disposable databases and synthetic agencies. It does not start a persistent worker for customer data, send communications or publish the application.
