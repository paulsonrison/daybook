# Authentication and tenant boundary

P01 implements agent-only agency registration, sign-in, session lookup and logout. Staff and residents do not log in. The root application uses these endpoints through same-origin Next.js routes. The UI catalogue remains public and carries no operational tenant data.

Passwords are salted and hashed with Node scrypt (N=32768, r=8, p=1, 64-byte derived key). Passwords are never returned. A random 256-bit opaque cookie token is stored only as its SHA-256 digest in the database. Cookies are HttpOnly, SameSite=Strict and expire in eight hours; production adds Secure and requires HTTPS. Logout revokes the database session. Expired or malformed tokens cannot authenticate.

Registration/login accept JSON only, enforce credential sizes, limit per-email attempts to ten per fifteen minutes using a durable atomic database counter, and reject untrusted or absent Origin headers. Backend authentication input is cancelled after 8 KiB instead of reading an unbounded body. The public frontend proxy likewise reads at most 8 KiB for auth or 64 KiB for GraphQL, cancels oversized streams and limits body reading to ten seconds. Frontend mutation proxies require the configured FRONTEND_ORIGIN. Account/successful proxy responses use no-store. The public registration endpoint creates one independent agency/owner atomically; global email uniqueness prevents duplicate owners from network retries.

## Database roles

Run migrations with MIGRATION_DATABASE_URL (administrative owner). Run the server with DATABASE_URL (restricted login role inheriting daybook_app). Server startup refuses superuser, BYPASSRLS, role/database creation, replication and inherited daybook_auth privileges. Do not grant the runtime role migration privileges or membership in daybook_auth.

Migration 002 creates daybook_app and daybook_auth as non-login roles if absent. An administrator provisions a separate login role with a locally chosen password, NOSUPERUSER, NOCREATEDB, NOCREATEROLE and NOBYPASSRLS, then grants it daybook_app. Do not put actual credentials in checked-in commands. PostgreSQL's CREATE ROLE password must be entered deliberately through the administrator's own setup; the app does not configure real database credentials.

All three tenant tables (agencies, agents, sessions) enable and FORCE RLS. Composite session foreign keys reject mismatched agency/agent relationships. Domain repositories must use withTenant, which parameterizes a transaction-local agency setting and commits/rolls back before releasing the connection. Subsequent domain migrations must add the same tenant policies and composite relationships; P14 rechecks the entire expanded schema.

Authentication is the deliberate cross-scope exception: an unauthenticated login cannot know its agency yet. Two narrowly scoped SECURITY DEFINER identity functions are owned by the non-login daybook_auth role. Explicit SELECT policies allow that role to resolve an email or random token digest; the application role cannot assume it. Functions use fully qualified objects, fixed pg_catalog search paths and revoked PUBLIC execution. The GraphQL API never exposes credential functions, password hashes, token hashes or arbitrary SQL. Global abuse counters contain only hashed identifiers and are inaccessible to runtime table queries.

## Local verification

- npm test: application health, bounded authentication input, shared UI behavior.
- npm run test:integration: launches disposable PostgreSQL 17 through a test-only npm runtime, applies real migrations, and uses a restricted database role. Tests auth, expiry, logout, direct SQL tenant isolation, pooled scope reset and forged relationships.
- npm run test:application: starts disposable PostgreSQL, backend and a separate local Next.js build directory; Chrome exercises agency creation, refresh, logout, failed/successful login and proxy origin rejection.
- npm run test:browser: independent reusable-UI browser regressions.

Test database credentials are generated randomly and never printed or committed. Generated databases/logs/build output live under ignored .cache directories. The current runner retains database files for debugging; no production database is used. Browser test servers bind only to loopback. No real customer data or messages are used.

Future tasks implement tenant-scoped operational workflows, full localization and offline session-switch clearing. P01 is an authentication/tenancy foundation, not completion of the other stories.
