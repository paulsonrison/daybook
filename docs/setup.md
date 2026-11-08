# Local setup

1. Install Node 22.12+ and npm 10+.
2. Run `npm ci` from the root.
3. Copy root `.env.example` to `.env`, backend `.env.example` to `apps/backend/.env`, and frontend `.env.example` to `apps/frontend/.env.local`.
4. Set a local PostgreSQL password and match it in the backend connection URL. Percent-encode special characters in URL credentials.
5. Start PostgreSQL with `docker compose up -d --wait`, then run `npm run db:migrate` and `npm run db:check`.
6. Start both apps with `npm run dev`. Start Storybook separately with `npm run storybook`.

npm workspace scripts execute in each package directory: backend dotenv reads `apps/backend/.env`; Next.js reads `apps/frontend/.env.local`; Docker Compose reads root `.env`.

## Troubleshooting

- API unavailable: confirm backend startup, port 4000 and `NEXT_PUBLIC_GRAPHQL_URL`. Restart Next.js after changing public environment values.
- CORS failure: `FRONTEND_ORIGIN` must exactly match the frontend origin, including the port.
- Readiness 503: PostgreSQL is unavailable, credentials are wrong, or `DATABASE_URL` points at the wrong host. `/health` and GraphQL `health` only report API liveness.
- Port 5432 busy: use an existing local database, or change Compose's host port and the connection URL together.
- Password changed after first startup: PostgreSQL initialization environment variables only apply to a new volume. Update the database role password deliberately; do not delete a volume containing valuable data.
- Stop database: `docker compose down` retains the volume. Avoid `down -v` unless you intend to delete local database data.

## Checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run build-storybook`, `npm run format:check`.

CI runs these checks and exercises SQL migration and connectivity against a disposable PostgreSQL service. `.env` files, credentials, dependencies and build output are excluded from git.
