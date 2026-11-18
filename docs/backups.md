# Encrypted backup implementation and verification

Encrypted storage, actual database backup, isolated restore, the restricted worker boundary and system-status UI are implemented and tested. The Cloudflare hourly trigger is active, but its automatic run is not yet verified. Retention deletion/execution remains pending. Durable job records and reservations are implemented; both storage providers have passed live synthetic replication checks. These checks do not constitute whole-project acceptance.

## Implemented

- `modules/backups/archive.ts` runs PostgreSQL client tools with constrained arguments and connection credentials in a restricted child environment. It creates a consistent custom-format archive of the `daybook` and `public` schemas, preserving ACLs and ownership. Archives are limited to 32 MiB without compression and staged in a private temporary directory. The caller must always run the returned cleanup function.
- Recovery accepts an empty database only. It uses one transaction and never requests a clean/drop restore. The archive's exact default `public` schema creation entry is omitted because PostgreSQL creates that schema in new databases; its ACL and object entries are preserved. Required database roles must already exist. Recovery is an operator action, not a browser endpoint.
- `encryption.ts` streams AES-256-GCM ciphertext with a fresh random nonce. The header, version, agency/scope UUID and backup UUID are authenticated. Recovery releases no plaintext until tag verification succeeds. Keys are externally configured and are never embedded in backup objects.
- `storage/private.ts` derives exact scope prefixes from validated UUIDs, keeps uploads private, checks actual stream lengths, and bounds requests. A server acknowledgement cannot bypass source EOF validation. The same S3 adapter supports Neon and Backblaze B2.
- `replication.ts` verifies each destination by downloading, authenticating and checking the restored size and SHA-256 against the original snapshot. Missing, failed or quota-limited destinations cannot report full protection. Durable job integration must atomically reserve capacity; `otherReserved` explicitly excludes the current job's own reservation.
- `jobs.ts` and migration 015 keep operator-only records in `daybook.operator_backup_runs` and `daybook.operator_backup_objects`, with no HTTP-role grants. Claims are exclusive per UTC period, with 15-minute leases and at most three attempts. Expired final attempts settle from persisted replica evidence. Unknown upload outcomes retain their storage reservation. Reservations are serialized across jobs and capped at 1 GiB per destination. Owner metadata writes cooperate with database transfer locks and remain fenced on a retired source.
- `policy.ts` retains seven daily, four weekly and three monthly recovery points plus the newest verified point after an outage. It only plans removal of uniquely identified, verified objects under the exact owned prefix. Case aliases, other scopes and unverified objects are excluded. It does not execute deletions.

## Observed evidence

An isolated PostgreSQL 17 test performed a real `pg_dump`, encrypted the archive, authenticated it and restored it with `pg_restore` into a new disposable database. It checked two agencies, original sessions, native Malayalam/Hindi text, exact 9007199254740993-paise values, a 1 MiB binary object and generated length, the public migration marker, forced row security and security-function owners. An over-limit backup failed while the source remained usable. Recovery into a populated database was refused.

The private `daybook-private` bucket on the approved Neon project passed a live streamed encrypted synthetic-file upload, authenticated download and exact-byte restore. Backblaze B2 also passed live authenticated replication of the same small synthetic source. Both restored sizes and SHA-256 hashes matched. A real B2 read outside the allowed file prefix returned permission denied. These are storage checks, not yet a scheduled live database backup. Credentials and test session state remain outside version control.

Independent review findings were fixed and regression-tested: hostname variants bypassing direct-connection validation; early upload acknowledgement hiding source failure; retention UUID case aliases; reservation double-counting; and process aborts reporting completion before the child closed. Raw PostgreSQL diagnostic output is not retained in application logs.

## Running the isolated database check

Use PostgreSQL 17 or newer client tools. Supply their paths as `TEST_PG_DUMP_PATH` and `TEST_PG_RESTORE_PATH` when they are not on PATH, then run:

```text
node scripts/test-database.mjs apps/backend/tests/integration/backups.test.ts
```

The runner creates its own disposable PostgreSQL cluster and synthetic data. It does not restore into Neon or the live Render database. Windows test binaries downloaded from the official PostgreSQL-linked EDB distribution are stored only in ignored local test cache. Render includes PostgreSQL client utilities, but the actual runtime client version must still be checked before enabling the live job.

## Remaining release gates

1. Observe the first actual Cloudflare Cron invocation and complete hosted retention acceptance. Worker, protection screen and signed scheduler forwarding are deployed.
2. Connect the remaining durable application jobs to bounded scheduled invocations without passing database-owner credentials into HTTP processes.
3. Reconcile object inventory before restarting jobs after disaster recovery. An actual database archive and isolated restore passed on 18 November 2026.
4. Configure an external production encryption key and recovery procedure; retain the key separately from storage.
5. Enable and observe scheduled execution and bounded retention; preserve the existing successful live backup/restore evidence.

The preview notice stays until these gates and the remaining document intake, reporting, translation, layout and Figma acceptance work are complete.

## Connected Backblaze destination — 16 November 2026

The private bucket is `daybook-paulson-backups-20261115`, endpoint `s3.us-east-005.backblazeb2.com`, region `us-east-005`. Server-side encryption is enabled. Existing account storage and download caps were observed at $0; no billing or cap settings were changed.

The user explicitly approved a non-master `daybook-backup-worker` key. It is restricted to this bucket and the `agencies/` prefix; listing all buckets is disabled. It expires on **14 February 2027 at 04:14 Asia/Calcutta** and needs rotation before then. The key is saved privately outside version control, has not been passed to HTTP processes, and is not yet wired into the production worker.

Bucket lifecycle currently keeps all versions. Retention must handle hidden B2 versions and uncertain uploads before enabling scheduled deletion. A successful synthetic storage test does not complete those release gates.

## Live database restore verified —18November2026

A453704-byte archive of the actual primary was encrypted and independently downloaded, authenticated and checksum-verified from Neon and Backblaze. It restored into an isolated database on the rehearsal branch, retaining two agencies, two agents, one session, three ledger entries and fifteen migrations, with forced tenant row security intact. Source financial records were not modified. The verification database is now populated and must not be overwritten by a retry.

Managed-host recovery requires the original migration owner. The helper prepares only an empty owned schema, temporarily gives existing NOLOGIN definer roles schema CREATE for ownership restoration, then revokes it in all completion paths. Application object ACLs and owners are preserved. Default privileges owned by foreign provider-administrator roles are left to the target provider; application-owned defaults are preserved. This path is regression-tested with a non-superuser migration owner and separate inaccessible platform role.

## Worker and status boundary

The combined service parent retains the operator configuration and launches only fixed `tick` and `status` commands over an IPC channel. Callers cannot supply executable paths, SQL, arguments or environment settings. The HTTP server receives a restricted environment containing its runtime database connection, document/link settings, AI settings and scheduler signing secret. Backup owner connections, encryption keys and storage credentials never enter the HTTP or frontend processes. Documented `AGENCY_*` messaging secret names remain supported; additional provider secret references use `DAYBOOK_PROVIDER_*` names.

`GET /operations/backups` requires an existing agency session and returns only system protection status, independent destination freshness and latest run outcome. It provides no backup download, object identifiers, paths or operator credentials. Settings → Appearance displays this summary in English, Malayalam and Hindi, including unavailable and unconfigured states. A failed newest archive prevents a healthy protection badge even when older verified copies remain recent.

`POST /internal/jobs/tick` accepts only an empty body and a timestamp within five minutes, signed using HMAC-SHA256 over `timestamp + "\nPOST\n/internal/jobs/tick"`. The dedicated signing secret must be 64 hexadecimal characters. The parent admits at most one worker at a time and one tick per fifteen minutes; durable daily claims, attempt limits and capacity reservations remain authoritative across restarts.

## Hosted connection —18 November 2026

The reviewed application commits `caa764c` and `c648c48` are deployed on the existing free Render service. Its actual runtime reports PostgreSQL client major **18**, compatible with the primary's major 17. A missing or older client prevents the status response from claiming protection. The operator explicitly approved the protected settings import: all eleven existing environment settings were preserved and sixteen dedicated worker/signing settings were added. Values remain private and are excluded from HTTP/frontend child environments.

The free Cloudflare Worker `daybook-free-scheduler` has the reviewed fixed-origin source, an encrypted signing secret and the hourly `7 * * * *` trigger. Its production and preview public URLs are disabled. A real signed request through the public forwarding route returned HTTP 200; unauthenticated backup-status access returned 401 and the public health check returned 200. This manual invocation is distinct from observing an automatic Cron run. The first observed automatic invocation failed before sending its request because Cloudflare Workers rejects `redirect: 'error'`; the scheduler now uses supported `redirect: 'manual'` and continues to require exact HTTP 200. Its unit regression is green and an independent review found no issue. The fix still needs deployment and a subsequent Cron run before automatic scheduling is verified.

The reviewed bounded scheduler is now deployed to the preview service at commit `48f29ac` (`dep-dbut468ae00c73fh1j70`, Live since 18 November 2026 16:30 UTC). It runs the backup attempt, then processes at most five agencies and one durable job per agency under a four-minute budget. It receives the restricted application runtime URL through the isolated child; provider credentials and automatic outbound message submission are excluded. The 16:07 UTC tick is not recorded in Cron Events even after a refresh at 16:44 UTC; settings confirm the hourly trigger is active and show the next run at 17:07 UTC. Automatic execution remains unverified. Hosted retention execution and safe communications/document-cycle work remain open. A successful duplicate daily invocation does not prove a new hosted archive was created.
