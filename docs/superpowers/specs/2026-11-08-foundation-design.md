# Daybook foundation

Create a public `paulsonrison/daybook` repository for the newspaper agency management project. Scope: initialization and folder structure only.

## Decisions

- npm workspaces: `apps/frontend`, `apps/backend`, `packages/ui`.
- User-selected stack: Next.js/React, TypeScript, MobX, Tailwind CSS, Axios, GraphQL, PostgreSQL/SQL and Storybook.
- Implementation choices: GraphQL Yoga on Node.js, node-postgres with explicit SQL migrations, Next.js App Router. No ORM required.
- A shared UI source package is transpiled by Next.js and documented by Storybook.
- The frontend exposes a small service-status example to demonstrate the integration, including failure handling.
- No authentication, billing, customer records or other product functionality in this milestone.

## Approaches

A workspace monorepo keeps one lockfile and shared UI changes together. Separate repositories would need package publishing and coordinated versions; that overhead is unnecessary for this initialization. The user accepted the monorepo proposal and supplied the stack.

## Source constraints

Figma structure was inspected; this milestone does not implement its screens. The linked Google Sheet could not be read because browser host permission was denied. Preserve the source URL and clearly mark user-story import as pending; do not invent or claim imported requirements.
