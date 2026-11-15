# Encrypted backup implementation and verification

The backup foundation is implemented and tested. Automatic backup jobs, durable quota reservations, system-status UI and independent live replication are still pending. These checks do not constitute whole-project acceptance.

## Implemented

- `modules/backups/archive.ts` runs PostgreSQL client tools with constrained arguments and connection credentials in a restricted child environment. It creates a consistent custom-format archive of the `daybook` and `public` schemas, preserving ACLs and ownership. Archives are limited to 32 MiB without compression and staged in a private temporary directory. The caller must always run the returned cleanup function.
- Recovery accepts an empty database only. It uses one transaction and never requests a clean/drop restore. The archive's exact default `public` schema creation entry is omitted because PostgreSQL creates that schema in new databases; its ACL and object entries are preserved. Required database roles must already exist. Recovery is an operator action, not a browser endpoint.
- `encryption.ts` streams AES-256-GCM ciphertext with a fresh random nonce. The header, version, agency/scope UUID and backup UUID are authenticated. Recovery releases no plaintext until tag verification succeeds. Keys are externally configured and are never embedded in backup objects.
- `storage/private.ts` derives exact scope prefixes from validated UUIDs, keeps uploads private, checks actual stream lengths, and bounds requests. A server acknowledgement cannot bypass source EOF validation. The same S3 adapter supports Neon and Backblaze B2.
- `replication.ts` verifies each destination by downloading, authenticating and checking the restored size and SHA-256 against the original snapshot. Missing, failed or quota-limited destinations cannot report full protection. Durable job integration must atomically reserve capacity; `otherReserved` explicitly excludes the current job's own reservation.
- `policy.ts` retains seven daily, four weekly and three monthly recovery points plus the newest verified point after an outage. It only plans removal of uniquely identified, verified objects under the exact owned prefix. Case aliases, other scopes and unverified objects are excluded. It does not execute deletions.

## Observed evidence

An isolated PostgreSQL 17 test performed a real `pg_dump`, encrypted the archive, authenticated it and restored it with `pg_restore` into a new disposable database. It checked two agencies, original sessions, native Malayalam/Hindi text, exact 9007199254740993-paise values, a 1 MiB binary object and generated length, the public migration marker, forced row security and security-function owners. An over-limit backup failed while the source remained usable. Recovery into a populated database was refused.

The private `daybook-private` bucket on the approved Neon project passed a live streamed encrypted synthetic-file upload, authenticated download and exact-byte restore. This is storage verification, not yet a scheduled database backup or an independently replicated backup. Credentials and test session state remain outside version control.

Independent review findings were fixed and regression-tested: hostname variants bypassing direct-connection validation; early upload acknowledgement hiding source failure; retention UUID case aliases; reservation double-counting; and process aborts reporting completion before the child closed. Raw PostgreSQL diagnostic output is not retained in application logs.

## Running the isolated database check

Use PostgreSQL 17 or newer client tools. Supply their paths as `TEST_PG_DUMP_PATH` and `TEST_PG_RESTORE_PATH` when they are not on PATH, then run:

```text
node scripts/test-database.mjs apps/backend/tests/integration/backups.test.ts
```

The runner creates its own disposable PostgreSQL cluster and synthetic data. It does not restore into Neon or the live Render database. Windows test binaries downloaded from the official PostgreSQL-linked EDB distribution are stored only in ignored local test cache. Render includes PostgreSQL client utilities, but the actual runtime client version must still be checked before enabling the live job.

## Remaining release gates

1. Add durable owner-only job metadata, atomic quota reservations, leases, bounded retries and visible destination health.
2. Wire a bounded scheduled worker without passing database-owner credentials into HTTP processes.
3. Connect the user's independent Backblaze B2 destination, configure restricted credentials and verify actual encrypted replication.
4. Configure an external production encryption key and recovery procedure; retain the key separately from storage.
5. Verify an actual live database archive and disposable restore, then enable and observe scheduling and retention.

The preview notice stays until these gates and the remaining document intake, reporting, translation, layout and Figma acceptance work are complete.
