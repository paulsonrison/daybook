# Architecture

## Workspace boundaries

`apps/frontend` owns routing, screens, client state and API calls. `apps/backend` owns GraphQL resolvers, services and SQL access. `packages/ui` owns reusable presentation components and their stories, without API calls or domain stores. npm links the UI package locally; Next.js transpiles its TypeScript source and Storybook uses Vite.

GraphQL Yoga runs on a separate Node HTTP server. The starter schema exposes only `health { status service }`. Frontend Axios requests handle both non-2xx failures and GraphQL `errors` returned with a successful HTTP status. The MobX example is created per client component with `useState`, avoiding shared server-side singleton state.

## Database

Use PostgreSQL and node-postgres with explicit SQL. `DATABASE_URL` stays backend-only. A bounded pool uses connection and idle timeouts and closes during shutdown. `db:migrate` runs tracked SQL files under a transaction and advisory lock. No business entities are invented before user-story review.

## Adding features

Create `src/features/<feature>` in the frontend and `src/modules/<feature>` in the backend only when needed. Keep resolvers thin, business logic in services and SQL in repositories. Import shared visual components from `@daybook/ui`; add stories beside components. Use Next.js server components by default and client boundaries where MobX/interactions are required.

## Scope

Authentication, authorization, product CRUD, uploads, billing, deployment, GraphQL code generation and production observability are future decisions. The current unauthenticated health API is a development foundation, not a production application. Pin exact resolved versions through the committed npm lockfile.
