# Daybook Foundation Implementation Plan

> Implement inline in the current session using superpowers:executing-plans.

**Goal:** Publish a runnable, documented npm workspace foundation.
**Architecture:** Next.js frontend, standalone GraphQL backend, shared React UI package.
**Tech Stack:** TypeScript, MobX, npm, Tailwind CSS, Axios, GraphQL Yoga, PostgreSQL, Storybook.
**Spec:** ../specs/2026-11-08-foundation-design.md

## Global Constraints

- Foundation only; no speculative business models or authentication.
- User stories remain pending until source access is available.
- Track example environments only; never secrets or generated builds.

## Review Focus

- Shared UI imports work in both Next.js and Storybook.
- MobX stores are scoped to a client component, avoiding cross-request state.
- GraphQL errors are handled separately from HTTP/network failures.
- Database readiness fails when PostgreSQL cannot be reached.
- Clean installs use the root lockfile.

## Tasks

- [x] Configure npm workspaces, TypeScript, formatting, CI, environment examples and Docker PostgreSQL.
- [x] Initialize GraphQL service, database pool, SQL migrations and health/readiness endpoints; test service integration.
- [x] Initialize Next.js App Router, Tailwind, MobX and Axios GraphQL service-status example.
- [x] Initialize shared Button component and Storybook states; verify both consumers build.
- [x] Document setup, architecture, requirements source and limitations; run all local checks and prepare publication to GitHub.

## Verification and review

Typecheck, lint, five backend tests, frontend/backend build and formatting passed. Storybook build and live PostgreSQL checks have the environment limitations recorded in `docs/verification.md`. Independent source review found no material correctness/security issues. Public repository publishing is the final execution step.
