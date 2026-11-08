# PostgreSQL and SQL migrations

Run `npm run db:migrate` from the repository root. Files in `migrations/` execute in lexical order inside a transaction, recorded in `public.daybook_migrations`. An advisory lock serializes migration runs. Keep applied files immutable; add numbered files for changes. No business tables or sample customer data are included.

Use parameterized SQL (`$1`, `$2`, etc.) for all user-supplied values. Database credentials are backend-only. The app must connect using a least-privilege role when deployed; the local Compose owner is for development only.
