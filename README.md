# Scopie

**Content intelligence for modern marketing teams.**

Scopie is an open-source platform for social media analytics, cross-market benchmarking, content planning, review and approval, and evidence-based AI recommendations. It starts as an internal tool for a marketing team managing ~30 social accounts across countries (CANNA Corporate), and is built multi-tenant so any organization can run it.

> **Status: Phase 1 (foundation).** Sign-in, organizations, roles, organization isolation, the app shell and social account management work. Analytics, platform connectors, content, approvals and AI are planned and shown as "Coming in a future phase" in the app. See [What works today](#what-works-today) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Why Scopie exists

Marketing teams running many accounts across countries and platforms end up with numbers in a dozen dashboards, metrics that silently mean different things, and weekly reports assembled by hand. Scopie's loop is **data → analysis → insight → recommendation → content action → publish → measure → learn**, built on three rules:

1. **Real data, labelled.** Every number shows where it came from. Demo data is always marked DEMO.
2. **Clear metrics.** Every metric has a definition; unavailable means "N/A", never a silent substitute.
3. **Honest comparisons.** Metrics that aren't comparable across platforms aren't compared.

## What works today

| Area                                                                                               | Status                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Sign up, sign in, sign out (email + password, Supabase Auth)                                       | Working                                                                                                |
| Protected routes and session refresh                                                               | Working                                                                                                |
| Basic user profile (name, timezone)                                                                | Working                                                                                                |
| Organizations (create, settings, switch between them)                                              | Working                                                                                                |
| Roles OWNER / ADMIN / MANAGER / EDITOR / VIEWER, changing a member's role                          | Working                                                                                                |
| Organization isolation via Postgres Row Level Security                                             | Working, covered by integration tests                                                                  |
| Social accounts: list, filter, group by country, add, edit, activate/deactivate, connection status | Working (manual accounts; no platform connection yet)                                                  |
| Dashboard                                                                                          | Account overview only (counts by country and platform). No performance metrics until connectors exist. |
| DEMO seed data                                                                                     | Working (`pnpm db:seed`)                                                                               |
| Inviting members by email                                                                          | Not yet (Phase 2)                                                                                      |
| Platform connectors, analytics, benchmarks, content, calendar, approvals, strategy, reports, AI    | Not yet. Placeholder pages say "Coming in a future phase."                                             |

## Architecture

- **Next.js (App Router) + React + TypeScript (strict)** for UI and server logic (Server Components, Server Actions).
- **Supabase**: Postgres with Row Level Security, Auth, and (later) Storage.
- **Tailwind CSS + shadcn/ui-style components + Lucide icons.**
- **Zod** for validation, **Vitest** and **Playwright** for tests.
- Planned: **Trigger.dev** for background sync jobs, **OpenAI** behind a provider interface for AI.

Domain logic lives in `lib/<domain>`; routes in `app/` stay thin. Security is enforced in the database (RLS), and the app adds friendly permission checks on top. Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md).

```
app/                 routes (auth pages, onboarding, /[orgSlug]/…)
components/          ui primitives, layout, feature components
lib/                 auth, db, orgs, accounts, members, profile, navigation
schemas/             Zod schemas shared by forms and server actions
supabase/migrations  SQL schema, RLS policies, reference data
scripts/seed-demo.ts DEMO DATA generator
tests/               unit, integration (real database), e2e (browser)
docs/                product, architecture, database, integrations, AI, roadmap
```

## Local development

Requirements: Node.js 22+, pnpm 10+, Docker (for the local Supabase stack).

```bash
pnpm install
pnpm db:start                 # starts local Supabase and applies migrations
cp .env.example .env.local    # then paste the API URL, anon key and service_role key printed by db:start
pnpm db:seed                  # optional: DEMO organization with fictional CANNA-style accounts
pnpm dev                      # http://localhost:3000
```

With demo data loaded, sign in as `demo@scopie.local` (owner), `manager.demo@scopie.local` or `viewer.demo@scopie.local`, password `scopie-demo-password` (or your `DEMO_USER_PASSWORD`). Or sign up with any email: local Supabase does not require email confirmation.

Useful commands:

| Command                                      | What it does                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev` / `pnpm build` / `pnpm start`     | Run, build, serve                                                        |
| `pnpm lint`, `pnpm typecheck`, `pnpm format` | Code quality                                                             |
| `pnpm test`                                  | Unit tests                                                               |
| `pnpm test:integration`                      | Database tests against local Supabase (auth, isolation, roles, accounts) |
| `pnpm test:e2e`                              | Browser tests (builds must exist: run `pnpm build` first)                |
| `pnpm db:reset`                              | Recreate the local database from migrations                              |
| `pnpm db:types`                              | Regenerate `lib/db/types.ts` from the local database                     |

## Environment variables

See [.env.example](.env.example).

| Variable                        | Where it's used                                                                                    | Secret?    |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | App (browser and server)                                                                           | No         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App. Supabase's anon (or publishable) key; safe in the browser because RLS protects data           | No         |
| `NEXT_PUBLIC_SITE_URL`          | Links in auth emails                                                                               | No         |
| `SUPABASE_SERVICE_ROLE_KEY`     | Only `pnpm db:seed` and the integration/e2e tests. **Never used by the web app; never expose it.** | **Yes**    |
| `DEMO_USER_PASSWORD`            | Password for demo users created by `pnpm db:seed`                                                  | Local only |

## Database setup (hosted Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Link and push migrations: `pnpm exec supabase link --project-ref <ref>` then `pnpm exec supabase db push`.
3. In **Authentication → URL Configuration**, set the Site URL to your app URL and add `<app-url>/auth/confirm` to the redirect URLs.
4. Keep **Confirm email** on in production. Update the "Confirm signup" email template link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` so confirmation goes through the app.
5. Copy the project URL and anon/publishable key into your environment.
6. Don't run `pnpm db:seed` against production; it refuses non-local URLs unless you pass `--allow-remote`.

## OAuth, platform connectors and AI

Not implemented yet. Planned designs, including scopes and limitations per platform, are in [docs/API_INTEGRATIONS.md](docs/API_INTEGRATIONS.md) and [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md). The first real connector (Meta: Instagram + Facebook) is Phase 4. The section "Adding a new platform connector" in API_INTEGRATIONS.md describes the contract new connectors will implement.

## Deployment

Any Node.js host that runs Next.js works (for example Vercel). Set the three `NEXT_PUBLIC_*` variables, point Supabase Auth's Site URL at the deployment, and run migrations with `supabase db push`. The service-role key is not needed by the deployed app.

## Testing

- **Unit** (`tests/unit`): validation, permissions, slugs, grouping, navigation.
- **Integration** (`tests/integration`): runs against a real Supabase stack, no mocks. Covers sign-up/sign-in/sign-out, organization isolation, the role permission matrix, last-owner protection, and social account rules (users can't mark accounts as connected, duplicates, owners must be members, audit log).
- **End-to-end** (`tests/e2e`): sign-up → organization → add/edit/deactivate account → sign-out; viewer read-only; non-members get "not found".

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE).
