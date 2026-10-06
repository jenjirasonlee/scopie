# Contributing to Scopie

Thanks for helping build Scopie. This guide covers how to get set up and what we expect from changes.

## Ground rules

1. **Real data, clearly labelled.** Never present mock or demo data as real. Demo data uses `data_source = 'demo'` and is labelled DEMO in the UI.
2. **Don't invent platform capabilities.** If an API doesn't provide a metric, model it as unavailable. Document what each connector can and can't do (`docs/API_INTEGRATIONS.md`).
3. **Security is enforced in the database.** New organization-owned tables need `organization_id`, Row Level Security policies, and integration tests proving isolation.
4. **Small, focused pull requests.** Follow the phases in `docs/ROADMAP.md`.

## Setup

See [README.md](README.md#local-development). In short:

```bash
pnpm install
pnpm db:start          # local Supabase (needs Docker)
cp .env.example .env.local   # paste the URL and keys printed by db:start
pnpm db:seed           # optional DEMO DATA
pnpm dev
```

## Before you open a pull request

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test               # unit tests
pnpm test:integration   # database + RLS tests (needs local Supabase)
pnpm build
pnpm test:e2e           # browser tests (needs local Supabase)
```

CI runs all of these.

## Code structure

- `app/` routes only; keep them thin.
- `lib/<domain>/` business logic, queries (`queries.ts`, server-only) and server actions (`actions.ts`).
- `schemas/` Zod schemas shared by forms and server actions.
- `components/ui/` shadcn-style primitives; `components/<domain>/` feature components.
- `supabase/migrations/` SQL migrations; never edit a migration that has been released, add a new one.

After changing the schema, update `lib/db/types.ts` (`pnpm db:types` with local Supabase running) and `docs/DATABASE.md`.

## Commit messages

Use the imperative mood ("Add account filters"), and explain why in the body when it isn't obvious.

## Code of conduct

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
