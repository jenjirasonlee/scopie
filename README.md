# Scopie

**Content intelligence for modern marketing teams.**

Scopie is an open-source platform for social media analytics, cross-market benchmarking, content planning, review and approval, and evidence-based AI recommendations. It starts as an internal tool for a marketing team managing ~30 social accounts across countries (CANNA Corporate), and is built multi-tenant so any organization can run it.

> **Status: Phase 6 (review + approval).** Track any public Instagram business or creator account or public YouTube channel, including competitors, by username or handle, with no login from the account owner. Scopie observes them every day through the platforms' official APIs, builds its own history, and ranks profiles only on numbers that are comparable. Connecting your own accounts (Meta connector), scheduled sync, CSV import and a first dashboard work. Plan content with its copy, files and versions, see it on a calendar, and send it through review and approval. Strategy and AI are planned and shown as "Coming in a future phase" in the app. See [What works today](#what-works-today) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Why Scopie exists

Marketing teams running many accounts across countries and platforms end up with numbers in a dozen dashboards, metrics that silently mean different things, and weekly reports assembled by hand. Scopie's loop is **data → analysis → insight → recommendation → content action → publish → measure → learn**, built on three rules:

1. **Real data, labelled.** Every number shows where it came from. Demo data is always marked DEMO.
2. **Clear metrics.** Every metric has a definition; unavailable means "N/A", never a silent substitute.
3. **Honest comparisons.** Metrics that aren't comparable across platforms aren't compared.

## What works today

| Area                                                                                                                                        | Status                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sign up, sign in, sign out (email + password, Supabase Auth)                                                                                | Working                                                                                                         |
| Protected routes and session refresh                                                                                                        | Working                                                                                                         |
| Basic user profile (name, timezone)                                                                                                         | Working                                                                                                         |
| Organizations (create, settings, switch between them)                                                                                       | Working                                                                                                         |
| Roles OWNER / ADMIN / MANAGER / EDITOR / VIEWER, changing a member's role                                                                   | Working                                                                                                         |
| Organization isolation via Postgres Row Level Security                                                                                      | Working, covered by integration tests                                                                           |
| Profiles: list, filter, group by country, add, edit, activate/deactivate; business role and access type                                     | Working                                                                                                         |
| Public Instagram profiles (competitors, industry, creators, your own) by username, through Business Discovery                               | Working once a Meta app and a viewer account are set up (see [PUBLIC_DATA_SETUP.md](docs/PUBLIC_DATA_SETUP.md)) |
| Add profile with a live preview; bulk add from a list or CSV; remove a profile with all its data                                            | Working                                                                                                         |
| Daily public observations, post metrics at set ages, 12-month post history, profile change history                                          | Working (Trigger.dev task or `pnpm sync:worker`)                                                                |
| Connect with Meta (Instagram business accounts + Facebook Pages), link, unlink, disconnect                                                  | Working once a Meta app is configured (see [API_INTEGRATIONS.md](docs/API_INTEGRATIONS.md))                     |
| Scheduled sync: daily account metrics, new posts, post metrics at set ages, history backfill                                                | Working (Trigger.dev task or `pnpm sync:worker`)                                                                |
| CSV import of account metrics or posts (LinkedIn and other platforms without a connector)                                                   | Working                                                                                                         |
| Profile page: coverage line, follower observations, recent posts with PUBLIC / CONNECTED / IMPORTED / DEMO labels, sync history, "Sync now" | Working                                                                                                         |
| Dashboard and analytics from stored observations                                                                                            | Working (`lib/analytics`)                                                                                       |
| DEMO seed data, including DEMO posts, metrics and DEMO public competitor profiles                                                           | Working (`pnpm db:seed`)                                                                                        |
| Public YouTube channels by handle or link, with only a server API key (no OAuth)                                                            | Working once `YOUTUBE_API_KEY` is set (see [PUBLIC_DATA_SETUP.md](docs/PUBLIC_DATA_SETUP.md#youtube))           |
| Benchmarks: rankings with their basis, country vs country, this period vs the previous one; benchmark groups                                | Working                                                                                                         |
| Inviting members by email                                                                                                                   | Not yet                                                                                                         |
| Content taxonomy: pillars, formats, campaigns, audiences, CTA types                                                                         | Working (Settings → Content taxonomy)                                                                           |
| Content: ideas and drafts with copy, plan, files and kept versions                                                                          | Working; file uploads need `ASSET_STORAGE` (see `.env.example`)                                                 |
| Calendar: month, week and list, filters, move to another day                                                                                | Working                                                                                                         |
| Review and approval: submit, approve, request changes, reject, history, comments, mentions                                                  | Working; notifications are in-app only                                                                          |
| Strategy, reports, AI                                                                                                                       | Not yet. Placeholder pages say "Coming in a future phase."                                                      |

## Architecture

- **Next.js (App Router) + React + TypeScript (strict)** for UI and server logic (Server Components, Server Actions).
- **Supabase**: Postgres with Row Level Security, Auth, and (later) Storage.
- **Tailwind CSS + shadcn/ui-style components + Lucide icons.**
- **Zod** for validation, **Vitest** and **Playwright** for tests.
- **Trigger.dev** runs the sync worker every 15 minutes (or run `pnpm sync:worker --watch` on any server).
- Planned: **OpenAI** behind a provider interface for AI.

Domain logic lives in `lib/<domain>`; routes in `app/` stay thin. Security is enforced in the database (RLS), and the app adds friendly permission checks on top. Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md).

```
app/                 routes (auth pages, onboarding, /[orgSlug]/…)
components/          ui primitives, layout, feature components
lib/                 auth, db, orgs, accounts, members, profile, navigation,
                     platforms (adapters, public collectors), ingest, metrics, sync, imports,
                     connections, public-data, analytics, crypto, demo
trigger/             Trigger.dev scheduled sync task
schemas/             Zod schemas shared by forms and server actions
supabase/migrations  SQL schema, RLS policies, reference data
scripts/             seed-demo.ts (DEMO DATA), sync-worker.ts (sync without Trigger.dev)
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
| `pnpm sync:worker` (`--watch` to repeat)     | Run one sync pass: queue due jobs and run them                           |
| `pnpm trigger:dev` / `pnpm trigger:deploy`   | Run or deploy the Trigger.dev sync task                                  |

## Environment variables

See [.env.example](.env.example).

| Variable                                    | Where it's used                                                                                                                                         | Secret?         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                  | App (browser and server)                                                                                                                                | No              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`             | App. Supabase's anon (or publishable) key; safe in the browser because RLS protects data                                                                | No              |
| `NEXT_PUBLIC_SITE_URL`                      | Links in auth emails                                                                                                                                    | No              |
| `SUPABASE_SERVICE_ROLE_KEY`                 | Server only: the Meta OAuth callback and disconnect (to store/delete encrypted tokens), the sync worker, `pnpm db:seed` and tests. **Never expose it.** | **Yes**         |
| `SCOPIE_ENCRYPTION_KEY`                     | Encrypts platform tokens at rest. 32 random bytes, base64 (`openssl rand -base64 32`). Losing it means reconnecting every platform.                     | **Yes**         |
| `META_APP_ID`, `META_APP_SECRET`            | The Meta app used for "Connect with Meta" and the sync worker                                                                                           | Secret: **Yes** |
| `META_GRAPH_API_VERSION`                    | Optional. Graph API version, defaults to the one pinned in code                                                                                         | No              |
| `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY` | Trigger.dev project for the scheduled sync                                                                                                              | Key: **Yes**    |
| `DEMO_USER_PASSWORD`                        | Password for demo users created by `pnpm db:seed`                                                                                                       | Local only      |

## Database setup (hosted Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Link and push migrations: `pnpm exec supabase link --project-ref <ref>` then `pnpm exec supabase db push`.
3. In **Authentication → URL Configuration**, set the Site URL to your app URL and add `<app-url>/auth/confirm` to the redirect URLs.
4. Keep **Confirm email** on in production. Update the "Confirm signup" email template link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` so confirmation goes through the app.
5. Copy the project URL and anon/publishable key into your environment.
6. Don't run `pnpm db:seed` against production; it refuses non-local URLs unless you pass `--allow-remote`.

## Platform connectors and data

Scopie reads profiles in two ways:

- **Public** (the default): any Instagram business or creator account, by username, through Meta's official Business Discovery API. The account owner approves nothing. You need one Instagram professional "viewer" account of your own, linked to a Facebook Page you manage. Step-by-step guide for non-engineers: [docs/PUBLIC_DATA_SETUP.md](docs/PUBLIC_DATA_SETUP.md).
- **Connected** (optional, your own accounts): adds private metrics such as reach, saves and shares.

Both need a Meta app and the variables above; the technical steps are in [docs/API_INTEGRATIONS.md](docs/API_INTEGRATIONS.md). Then go to **Settings → Connections → Connect with Meta**, and choose the viewer account in **Settings → Public data**. Without a Meta app, CSV import (**Accounts → Import CSV**) works on its own.

How data flows, how sync is scheduled and what happens on errors: [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md). Metric definitions: [docs/METRICS.md](docs/METRICS.md). AI design: [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md).

Tokens are encrypted on the server and never reach the browser or the logs. Scopie only reads data; it never posts.

## Deployment

Any Node.js host that runs Next.js works (for example Vercel). Set the three `NEXT_PUBLIC_*` variables, point Supabase Auth's Site URL at the deployment, and run migrations with `supabase db push`. For platform connections also set `SUPABASE_SERVICE_ROLE_KEY`, `SCOPIE_ENCRYPTION_KEY` and the Meta variables (server-side only), and deploy the sync task with `pnpm trigger:deploy` (with the same variables set in Trigger.dev), or run `pnpm sync:worker --watch` on a server.

## Testing

- **Unit** (`tests/unit`): validation, permissions, slugs, grouping, navigation, CSV parsing, metric dictionary, token encryption, sync schedule, DEMO generator, analytics, the Meta adapters and the Business Discovery collector against saved API responses (pagination, rate limits, expired tokens, missing permissions, hidden likes, secret redaction).
- **Integration** (`tests/integration`): runs against a real Supabase stack, no mocks. Covers sign-up/sign-in/sign-out, organization isolation, the role permission matrix, last-owner protection, social account rules, and the data pipeline: where data may come from (no DEMO data in real organizations, no live data from users), tokens unreadable by users, linking and disconnecting, CSV import, duplicate protection, the sync engine end to end with a fake platform, public profiles and public sync jobs, and the metric dictionary matching the database.
- **End-to-end** (`tests/e2e`): sign-up → organization → add/edit/deactivate account → sign-out; viewer read-only; non-members get "not found".

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE).
