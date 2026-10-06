# Scopie — Roadmap

> Status: Phase 0 and Phase 1 complete. Next: Phase 2. Last updated: 2026-10-06

## 1. Smallest useful V1

The full V1 list in the brief is large. The **smallest useful V1** is the slice that makes Jen's Monday genuinely better with real data, and everything else builds on it:

> **"Connect CANNA's Instagram and Facebook accounts, see every country side by side with honest metrics, and get a weekly report with evidence-backed insights."**

It contains:

1. Sign in, one organization, members with roles.
2. Social accounts with country, language, owner; country grouping.
3. Meta connector (Instagram + Facebook Pages) with OAuth, scheduled and manual sync, normalization into the universal model. Demo connector for everything else.
4. Dashboard: KPIs with definitions and source badges, trends, top/bottom accounts, top posts, breakdown by country/platform/format.
5. Post explorer with filters, median + mean, and country/account comparison.
6. Basic benchmarking: rankings within a group on a named metric.
7. Basic AI insights + recommendations with evidence, and the weekly report.
8. Seed demo data, docs, tests.

**Deliberately after the smallest V1, but still within the brief's V1:** content hub, calendar, approval workflow, strategy. They don't depend on platform data, so they can be built in parallel once Phase 2 exists, and the brief's full V1 is reached at the end of Phase 13. If Jen's team needs approvals sooner than analytics, Phases 7–9 can be pulled forward without architectural cost.

Why this order: the data model and metric honesty are the hardest things to retrofit; content workflow is comparatively standard CRUD. Getting real data flowing early also exposes API surprises (scopes, deprecations, missing metrics) before the UI is designed around assumptions.

## 2. Phases

Each phase ends with: app runs locally, lint + typecheck + tests green, docs updated, a short demo note.

| Phase                        | Scope                                                                                                                                                                                                                                                                                                                    | Exit criteria                                                                                  | Brief §42 criteria covered |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------- |
| **0** Spec                   | These six docs                                                                                                                                                                                                                                                                                                           | Reviewed by Jen                                                                                | —                          |
| **1** Foundation ✅          | pnpm + Next.js App Router + strict TS, Tailwind, shadcn/ui, ESLint/Prettier, Vitest, Playwright, Supabase local + Auth (magic link), base migrations (profiles, orgs, members, invitations, RLS helpers), app shell + nav, CI (GitHub Actions), README, LICENSE, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, `.env.example` | Sign in, create org, see empty shell; pgTAP RLS tests pass                                     | 1, 2                       |
| **2** Org & accounts         | Members & roles UI, invitations, social accounts CRUD, countries, account groups, permission matrix enforced                                                                                                                                                                                                             | Invite a user as VIEWER who can't edit; add accounts grouped by country                        | 3, 4, 5                    |
| **3** Universal data model   | Metric dictionary, platform metric map, posts, snapshots, rollups, `lib/metrics` + `lib/analytics` core (engagement rate variants, growth, medians, comparability), demo connector + seed generator, sync engine skeleton on Trigger.dev                                                                                 | Seeded demo org with 180 days of data; analytics unit tests                                    | 7                          |
| **4** Meta connector         | OAuth (connect, reconnect, disconnect), encrypted token store, account discovery, profile/posts/metrics sync, incremental + backfill, rate-limit handling, sync health UI, Business Discovery for competitors                                                                                                            | A real CANNA IG/FB account syncs on schedule and on demand; fixture tests for every error path | 6, 7                       |
| **5** Dashboard & analytics  | Dashboard, date ranges + comparisons, post explorer, account/country/platform/format comparison, metric definition tooltips, source badges, demo banner                                                                                                                                                                  | Numbers on screen match analytics tests on seed data                                           | 8, 9, 10                   |
| **6** Benchmarking           | Benchmark groups, rankings with basis label, exclusion of non-comparable members                                                                                                                                                                                                                                         | Ranking of DEMO countries; competitor group from public data                                   | 16                         |
| **7** Content hub            | Taxonomy (pillars, formats, campaigns, audiences), content items, versions, assets upload                                                                                                                                                                                                                                | Create content with assets; versions immutable                                                 | 11                         |
| **8** Calendar               | Month/week/list, filters, side panel, reschedule                                                                                                                                                                                                                                                                         | Open item from calendar                                                                        | —                          |
| **9** Approvals              | State machine, submit, comment with mentions, request changes, approve/reject, history timeline, queue, notifications                                                                                                                                                                                                    | E2E: draft → review → changes → v2 → approved                                                  | 12, 13                     |
| **10** Strategy              | Strategies per market, objectives/KPIs, pillar targets, link content to objectives, coverage view                                                                                                                                                                                                                        | Content linked to an objective; coverage shows                                                 | 14, 15                     |
| **11** AI insights           | Provider layer, signal detection, insight engine, validators, audit log, insights feed                                                                                                                                                                                                                                   | Insights on demo data cite evidence; validator tests                                           | 17                         |
| **12** AI recommendations    | Recommendation engine, computed confidence, accept → content idea, dismiss/done                                                                                                                                                                                                                                          | Recommendation turns into an IDEA item                                                         | 18                         |
| **13** Weekly report         | Scheduled report, snapshot, in-app view, share to members                                                                                                                                                                                                                                                                | Monday report generated automatically                                                          | 19, 20 (V1 complete)       |
| **14** More connectors       | YouTube (#2), then LinkedIn (if approved; CSV import meanwhile), TikTok                                                                                                                                                                                                                                                  | Each with honest capability matrix                                                             | —                          |
| **15** Productivity & career | Workflow stats, Career Intelligence, Scopie AI chat, content assistant, PDF export                                                                                                                                                                                                                                       | —                                                                                              | —                          |

Smallest useful V1 = Phases 1–6 + 11 + 13 (report without content sections). Full brief V1 = Phases 1–13.

## 3. Dependencies

```
1 → 2 → 3 → 4 → 5 → 6 ─┐
          │             ├→ 11 → 12 → 13
          └→ 7 → 8      │
               └→ 9 → 10┘
```

Phases 7–10 only need Phase 2, so they can run alongside 3–6.

## 4. What's needed from people (not engineering decisions)

| Needed                                                                                                                                   | When                              | From                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------ |
| An empty GitHub repository for Scopie                                                                                                    | Before Phase 1                    | Jen                      |
| A Supabase project (free tier is enough to start) and a Trigger.dev project, or permission for Claude to use local-only setup until then | Phase 1 (local), Phase 4 (hosted) | Jen                      |
| List of CANNA's accounts: platform, country, handle (helps confirm Meta-first and seed realism)                                          | Before Phase 4                    | Jen                      |
| Someone with admin access to CANNA's Meta Business portfolio to create/authorize the Meta app                                            | Phase 4                           | Jen / CANNA social admin |
| OpenAI API key                                                                                                                           | Phase 11                          | Jen                      |

## 5. Risks

| Risk                                                 | Mitigation                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta access/approval friction or metric deprecations | Start with internal (standard) access for CANNA-owned assets; pin API version; metric map is data; demo connector keeps development unblocked. |
| LinkedIn/TikTok access not granted                   | Manual/CSV import with `Manual`/`Imported` badges; never fake.                                                                                 |
| Cross-platform comparisons misleading users          | Comparability classes enforced in the analytics layer, not just UI.                                                                            |
| AI producing generic or wrong claims                 | Deterministic signals, evidence validators, computed confidence.                                                                               |
| Scope creep before V1                                | This roadmap; each phase has exit criteria.                                                                                                    |
| Account-level data history limits                    | Start syncing early (Phase 4) so history accumulates; record earliest available date.                                                          |

## 6. Phase 1 outcome

Delivered: Next.js 16 + strict TypeScript + Tailwind + shadcn-style UI; Supabase migrations for tenancy, roles/permissions, platforms, countries, social accounts, account groups and audit log, all with RLS; email/password auth with protected routes; organization onboarding and switching; members & roles settings; the full app shell with honest placeholders; a working Accounts module; DEMO seed; 29 unit, 40 database and 4 browser tests; CI.

Deviations from the Phase 1 plan: email + password instead of magic links (simpler local testing; magic links can be added); RLS is tested with Vitest against a real Supabase stack instead of pgTAP (same guarantees, one test runner); the Accounts module (planned for Phase 2) was built now because it was requested; invitations stay in Phase 2.

## 7. Next step

**Phase 2: Organization & account management.** Invite members by email, remove members, custom account groups (regions) with UI, account CSV import (also the fallback for platforms without API access), and an activity log view.
