# Security Policy

Scopie handles marketing analytics and, from Phase 4, OAuth access to social media accounts. We take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the repository's **Security** tab). Include steps to reproduce, the affected version or commit, and the impact you expect.

We aim to acknowledge reports within 5 working days and to agree on a disclosure timeline with you.

## Supported versions

Scopie is pre-1.0. Only the latest `main` branch receives security fixes.

## How Scopie protects data

- **Tenant isolation in the database.** Every organization-owned table has Row Level Security. Users can only read or change rows of organizations they belong to, enforced by Postgres, not just by the app. See `supabase/migrations` and `tests/integration`.
- **Roles.** OWNER, ADMIN, MANAGER, EDITOR and VIEWER, with the permission matrix stored in `public.role_permissions` and enforced by RLS policies.
- **No service-role key in the web app.** The app only uses the public anon key plus the signed-in user's session. The service-role key is used by the demo seed script and tests only.
- **Server-side secrets only.** Only variables prefixed `NEXT_PUBLIC_` reach the browser; nothing secret may use that prefix.
- **Connection status can't be faked.** Users cannot mark an account as connected or as live data; only trusted server code can (database trigger).
- **Audit log.** Changes to social accounts, memberships and organization settings are recorded in `activity_log`.
- **Planned (Phase 4):** encrypted OAuth token storage (AES-256-GCM), tokens never sent to the browser, logs or AI prompts. See `docs/ARCHITECTURE.md` §8.

## Never commit

Real credentials, API keys, OAuth tokens, `.env.local`, or any real customer data (including CANNA's). Use the demo seed (`pnpm db:seed`) for development data.
