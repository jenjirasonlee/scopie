# Scopie — Roadmap

> Status: Phases 1 and 2 complete. Next: Phase 3 (analytics dashboard). Last updated: 2026-10-07

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

**Deliberately after the smallest V1:** content, calendar, approvals and strategy (Phases 5–7). They don't depend on platform data, so they can be pulled forward without architectural cost.

Why this order: the data model and metric honesty are the hardest things to retrofit; content workflow is comparatively standard CRUD. Getting real data flowing early also exposes API surprises (scopes, deprecations, missing metrics) before the UI is designed around assumptions.

## 2. Phases

Jen's roadmap (2026-10-07). Each phase ends with: app runs locally, lint + typecheck + tests green, docs updated, a short demo note.

| Phase                                     | Scope                                                                                                                                                                                                                                   | Exit criteria                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **1** Foundation ✅                       | Next.js + strict TS, Tailwind, shadcn-style UI, Supabase + RLS, auth, organizations, roles, app shell, social accounts, DEMO seed, CI                                                                                                   | Sign in, create org, manage accounts; isolation tests pass                                                |
| — Architecture review ✅                  | Data-layer review; its "change before API development" decisions are now built (see [DATA_PIPELINE.md](DATA_PIPELINE.md), [METRICS.md](METRICS.md))                                                                                     | Decisions approved                                                                                        |
| **2** Real social data pipeline ✅        | Metric dictionary, posts and append-only metric snapshots, shared ingest step, CSV import, Meta connector (Instagram + Facebook) with OAuth, encrypted tokens, scheduled/incremental/backfill sync, sync health, DEMO posts and metrics | A connected account syncs on schedule and on demand; CSV import works; fixture tests for every error path |
| **3** Analytics dashboard                 | Dashboard KPIs with definitions and source badges, date ranges and comparisons, post explorer, account/country/platform/format breakdowns, rollups                                                                                      | Numbers on screen match analytics tests on seed data                                                      |
| **4** Cross-country benchmarking          | Benchmark groups, rankings with their basis, excluding non-comparable values, competitors from public data                                                                                                                              | Ranking of DEMO countries                                                                                 |
| **5** Content management + calendar       | Taxonomy screens (pillars, formats, campaigns, audiences), content items, versions, assets, calendar views                                                                                                                              | Create content with assets and see it on the calendar                                                     |
| **6** Review + approval                   | State machine, comments and mentions, request changes, approve/reject, history, queue, notifications                                                                                                                                    | Draft → review → changes → approved, end to end                                                           |
| **7** Content strategy                    | Strategies per market, objectives and KPIs, pillar targets, coverage                                                                                                                                                                    | Content linked to an objective; coverage shows                                                            |
| **8** AI analyst + recommendations        | Provider layer, signal detection, insights with evidence, recommendations with computed confidence                                                                                                                                      | Insights on demo data cite stored values                                                                  |
| **9** Weekly intelligence reports         | Scheduled weekly report, snapshot, in-app view, sharing                                                                                                                                                                                 | Monday report generated automatically                                                                     |
| **10** More platforms                     | YouTube next, then LinkedIn and TikTok where API access is granted (CSV import until then)                                                                                                                                              | Each with an honest capability list                                                                       |
| **11** Productivity + career intelligence | Workflow stats, career intelligence, AI chat and content assistant, PDF export                                                                                                                                                          | —                                                                                                         |

## 3. Dependencies

```
1 → 2 → 3 → 4 ─┐
    │          ├→ 8 → 9
    └→ 5 → 6 → 7┘
```

Phases 5–7 don't need platform data, so they can run alongside 3–4.

## 4. What's needed from people (not engineering decisions)

| Needed                                                                                          | When                          | From                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------ |
| An empty GitHub repository for Scopie                                                           | Now (code is ready to push)   | Jen                      |
| A Supabase project (free tier is enough to start) and a Trigger.dev project                     | Before going live             | Jen                      |
| List of CANNA's accounts: platform, country, handle (helps confirm Meta-first and seed realism) | Before connecting Jen         |
| Someone with admin access to CANNA's Meta Business portfolio to create/authorize the Meta app   | Now (Phase 2 is ready for it) | Jen / CANNA social admin |
| OpenAI API key                                                                                  | Phase 8                       | Jen                      |

## 5. Risks

| Risk                                                 | Mitigation                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta access/approval friction or metric deprecations | Start with internal (standard) access for CANNA-owned assets; pin API version; metric map is data; demo connector keeps development unblocked. |
| LinkedIn/TikTok access not granted                   | Manual/CSV import with `Manual`/`Imported` badges; never fake.                                                                                 |
| Cross-platform comparisons misleading users          | Comparability classes enforced in the analytics layer, not just UI.                                                                            |
| AI producing generic or wrong claims                 | Deterministic signals, evidence validators, computed confidence.                                                                               |
| Scope creep before V1                                | This roadmap; each phase has exit criteria.                                                                                                    |
| Account-level data history limits                    | Start syncing as soon as the Meta app exists so history accumulates; record earliest available date.                                           |

## 6. Phase 1 outcome

Delivered: Next.js 16 + strict TypeScript + Tailwind + shadcn-style UI; Supabase migrations for tenancy, roles/permissions, platforms, countries, social accounts, account groups and audit log, all with RLS; email/password auth with protected routes; organization onboarding and switching; members & roles settings; the full app shell with honest placeholders; a working Accounts module; DEMO seed; 29 unit, 40 database and 4 browser tests; CI.

Deviations from the Phase 1 plan: email + password instead of magic links (simpler local testing; magic links can be added); RLS is tested with Vitest against a real Supabase stack instead of pgTAP (same guarantees, one test runner); the Accounts module was built early because it was requested; member invitations are not on the current roadmap.

## 7. Phase 2 outcome

Delivered: the review's "change before API development" decisions; posts, append-only metric snapshots with availability and post age; the metric dictionary in code and database; one ingest step used by every source; database rules on where data may come from; CSV import with templates; the Meta connector with OAuth, encrypted tokens, link/unlink/disconnect; four sync jobs with backoff, rate-limit and reconnect handling, run by Trigger.dev or `pnpm sync:worker`; Connections, Import and sync-health screens; recent posts and sync history on account pages; DEMO posts and metrics for the demo organization.

Not yet verified against a real Meta account: that needs a Meta app and a CANNA admin to connect (see §4). Every Meta behaviour is covered by tests against saved responses.

## 8. Next step

**Phase 3: Analytics dashboard**, built on the snapshots and views from Phase 2.
