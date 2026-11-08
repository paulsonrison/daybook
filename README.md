# Daybook

Newspaper agency management project foundation. This milestone initializes the repository and development environment; the Figma screens and business workflows are not implemented yet.

## Stack

| Area           | Technologies                                                   |
| -------------- | -------------------------------------------------------------- |
| Frontend       | Next.js App Router, React, TypeScript, MobX, Tailwind CSS v4   |
| API client     | Axios posting GraphQL operations                               |
| Backend        | Node.js, TypeScript, GraphQL Yoga                              |
| Database       | PostgreSQL 17, node-postgres, versioned SQL migrations         |
| UI development | Shared React package, Storybook, accessibility addon           |
| Tooling        | npm workspaces, one lockfile, Prettier, ESLint, GitHub Actions |

## Structure

```text
apps/
  frontend/               Next.js application
    src/app/              Routes, layouts and global styles
    src/features/         Feature components and local MobX stores
    src/lib/graphql/      Axios-based GraphQL client
    src/stores/           Future shared client stores
  backend/                Standalone GraphQL API
    src/db/               Connection pool and database commands
    src/modules/          Future domain modules
    db/migrations/        Versioned SQL files
packages/
  ui/                     Shared React UI source
    .storybook/           Storybook configuration
    src/components/       Components and colocated stories
docs/                     Setup, architecture and requirements sources
```

## Quick start

Requirements: Node.js 22.12+ (Node 22 LTS recommended), npm 10+, Docker Compose or an existing PostgreSQL instance.

```bash
npm ci
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
```

Choose a local password in root `.env` and use the same URL-encoded password in `apps/backend/.env`'s `DATABASE_URL`. The example values are placeholders, never production credentials.

```bash
docker compose up -d --wait
npm run db:migrate
npm run db:check
npm run dev
```

- Frontend: http://localhost:3000
- GraphQL playground: http://localhost:4000/graphql (development only)
- Liveness: http://localhost:4000/health
- Database readiness: http://localhost:4000/ready
- Storybook: `npm run storybook` → http://localhost:6006

The frontend's **Check connection** button exercises Next.js → Axios → GraphQL. It reports API status, not database readiness; `/ready` checks PostgreSQL separately.

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run build-storybook
npm run format:check
```

Run `npm run format` to format files. For production-like local execution after building, run `npm start -w @daybook/backend` and `npm start -w @daybook/frontend` in separate terminals. To expose the backend in a container set `HOST=0.0.0.0` deliberately. No deployment or auth configuration is included.

## Documentation

- [Detailed setup and troubleshooting](docs/setup.md)
- [Architecture and conventions](docs/architecture.md)
- [User stories and source status](docs/user-stories.md)
- [Figma references](docs/design-references.md)
- [Verification record](docs/verification.md)

No license has been selected. Public visibility alone does not grant an open-source license.
