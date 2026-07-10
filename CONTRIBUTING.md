# Contributing to Fiber Link

Thanks for your interest in improving Fiber Link! This guide covers repository
layout, local development, testing, and pull request conventions.

## Repository Layout

| Path | What it is |
|---|---|
| `fiber-link-service/` | Bun workspace monorepo: `apps/rpc` (Fastify JSON-RPC), `apps/worker` (settlement/withdrawal loops), `apps/admin` (Next.js admin console), `packages/db` (Drizzle schema + repos), `packages/fiber-adapter` (Fiber/CKB integration), `packages/notifications`, `packages/client` (JS SDK) |
| `fiber-link-discourse-plugin/` | Discourse plugin (Ruby + Ember/GJS) |
| `deploy/compose/` | Docker Compose reference stack (postgres, redis, FNN nodes, migrate, rpc, worker) |
| `docs/` | Product docs, runbooks, acceptance evidence, historical plans |
| `scripts/` | E2E, demo, evidence-capture, and CI helper scripts |

## Prerequisites

- [Bun](https://bun.sh) 1.3.x (see `packageManager` in `fiber-link-service/package.json`)
- Docker + Docker Compose v2 (for the local stack and DB-backed verification)
- Ruby + a Discourse dev environment (only for plugin work; see
  `docs/discourse-plugin-installation.md`)

## Local Development

```bash
cd fiber-link-service
bun install --frozen-lockfile
```

Run tests per workspace from the `fiber-link-service` root (same layout CI uses;
the subshell keeps your working directory unchanged):

```bash
(cd apps/rpc && bun run test -- --run)          # rpc
(cd apps/admin && bun run test -- --run)        # admin
(cd apps/worker && bun run test -- --run)       # worker
(cd packages/db && bun run test -- --run)       # db
(cd packages/fiber-adapter && bun run test -- --run)
(cd packages/notifications && bun run test -- --run)
(cd packages/client && bun run test -- --run)
```

Typecheck any workspace with:

```bash
bun run typecheck
```

Database migrations live in `fiber-link-service/packages/db/drizzle` and are
generated from `src/schema.ts`:

```bash
cd packages/db   # from fiber-link-service
DATABASE_URL=... bun run db:generate   # generate a migration from schema changes
DATABASE_URL=... bun run db:migrate    # apply migrations
DATABASE_URL=... bun run db:validate   # drift check (also runs in CI)
```

The compose stack (see `docs/runbooks/compose-reference.md`) applies migrations
automatically through the one-shot `migrate` service.

## Pull Request Conventions

- Keep PRs focused; one concern per PR.
- Fill in the PR template (summary, scope, verification).
- CI must pass: service tests, typecheck, db drift check, compose script
  checks, fiber-adapter docker e2e, and the Discourse plugin smoke suite.
- PRs merge via **squash** (auto-merge is enabled once required checks pass).
- Review findings use the repository convention: `BS:` prefixes blocking
  findings, `NBS:` prefixes non-blocking suggestions (one per line; automation
  files follow-up issues for `NBS:` lines after merge). See `AGENTS.md`.

## Reporting Issues

- Bugs and feature requests: use the issue templates.
- Security vulnerabilities: **do not open a public issue** — see
  [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
