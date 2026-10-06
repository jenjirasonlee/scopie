# Scopie — Product Specification

> "Content intelligence for modern marketing teams."
> Status: Phase 1 implemented (auth, organizations, roles, accounts, shell). Last updated: 2026-10-06

## 1. What Scopie is

Scopie is an open-source platform that connects a marketing team's social accounts, turns their data into clear, comparable metrics, and closes the loop from **data → insight → recommendation → content → approval → publish → measure → learn**.

It starts as an internal content intelligence tool for CANNA Corporate (~30 social accounts across countries and platforms) and is built so any organization can run it.

## 2. Product principles

1. **Real data, labelled.** Every number shows where it came from (live API, public API, manual entry, import, demo). Demo data is always visibly marked.
2. **Clear metrics.** Every metric has a definition one hover away. Unavailable means "N/A", never a silent substitute.
3. **Honest comparisons.** Scopie refuses to rank things on metrics that aren't comparable (e.g. Instagram "views" vs LinkedIn "impressions") and explains why.
4. **Insights, not summaries.** AI explains what changed and what's associated with it, with evidence, using "associated with", never "caused by" without evidence.
5. **Actionable.** Recommendations become content ideas or experiments in one click.
6. **Calm, data-dense UI.** Enterprise analytics feel: tables first, charts that make a point, no decoration.

## 3. Users and jobs to be done

| Persona                  | Primary jobs                                                                                        | Default role                            |
| ------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Content Marketer (Jen)   | Understand performance across markets, plan content, produce weekly reports, find what to replicate | ADMIN / MANAGER                         |
| Marketing Manager        | Review and approve content, see team output, read weekly report                                     | MANAGER                                 |
| Country/Regional Manager | See own market vs others, plan local content, submit for approval                                   | EDITOR (scoped to country groups later) |
| Content Creator          | Draft content, respond to review comments                                                           | EDITOR                                  |
| Social Media Manager     | Connect accounts, keep sync healthy, schedule                                                       | ADMIN                                   |
| Executive/Stakeholder    | Read reports and headline KPIs                                                                      | VIEWER                                  |

## 4. Questions Scopie must answer

What happened? Why (associated factors)? Best/worst accounts, content, countries, formats, pillars? What's improving or declining? What to test next, stop, or replicate across markets? Where are the gaps? How can the team work more efficiently?

Each maps to a screen or AI tool (see §6 and AI_ARCHITECTURE.md).

## 5. Information architecture

Primary navigation (left sidebar, org-scoped):

1. **Dashboard** — global KPIs, trends, top/bottom accounts, top posts, breakdowns.
2. **Analytics** — post explorer and account comparison.
3. **Accounts** — social accounts, groups (country/region), connections, sync health.
4. **Content** — content library / hub.
5. **Calendar** — month, week, list views.
6. **Approvals** — review queue.
7. **Strategy** — strategies per market, objectives, pillars, KPIs.
8. **Benchmarks** — groups, rankings.
9. **Reports** — weekly intelligence reports.
10. **AI Insights** — insights feed, recommendations, Scopie AI chat.
11. **Productivity** — team workflow stats (later).
12. **Settings** — organization, members & roles, taxonomy, connections, system health.

Global controls: org switcher, date range (This week, Last week, Last 30/90 days, This year, Custom), comparison (previous period, previous year where data exists), filters (country, platform, account, pillar, format, campaign).

## 6. Feature specifications

### 6.1 Authentication & organizations (V1)

- **Built (Phase 1):** sign up, sign in and sign out with email + password (Supabase Auth); basic profile (name, timezone); create an organization (name, URL slug, default timezone) and become its owner; switch between organizations; change members' roles (OWNER/ADMIN; only owners grant ownership; an organization always keeps an owner).
- **Phase 2:** invite members by email with a role; remove members from the UI. Magic links and SSO later.
- A user can belong to multiple organizations.

### 6.2 Social accounts & grouping (V1)

_Built in Phase 1:_ manual add/edit, activate/deactivate (accounts are never deleted, so history survives), country, platform, language, timezone, owner, competitor flag, notes, connection status and last-sync display, filters and group-by-country. Custom groups (regions) have tables but no UI yet (Phase 2).

- Add an account manually (platform, handle, display name, country, language, account type, owner, timezone) or by connecting via OAuth (fields pre-filled).
- Account card shows: connection status (`not_connected`, `connected`, `needs_reauth`, `error`, `demo`), data source, last successful sync, active/inactive.
- Groups: every account has a country; accounts can also belong to custom groups (region, "Core markets", competitors).
- Competitor accounts: flagged `is_competitor`, only ever filled from public data.

### 6.3 Dashboard (V1)

KPI row: Reach, Impressions/Views, Engagement, Engagement rate (by reach), Followers, Follower growth, Posts published, Video views — each with delta vs comparison period, definition tooltip, and source badge. Metrics not available for the selected scope show "N/A" with the reason.

Below: trend chart (selectable metric), top & bottom accounts table (ranked by a named metric), top posts table, breakdowns by country, platform, format, pillar (tables with small bars).

### 6.4 Analytics: post performance & comparison (V1)

- **Post explorer:** filterable, sortable table of posts with metadata (country, platform, format, pillar, campaign, audience, topic, CTA, date, owner, language) and metrics. Summary row shows **median** and mean, count, and top examples. Example query: "educational posts, Germany, last 90 days".
- **Comparison:** pick two to four entities of one kind (country, account, platform, pillar, format, campaign) and a period. Shows side-by-side table + chart. Only metrics comparable across the selected entities are shown; others are listed under "Not comparable" with the reason.
- Posts can be tagged (pillar, format, campaign, etc.) after the fact; tags from linked content items flow onto published posts automatically.

### 6.5 Content hub (V1)

Content item fields: title, description, caption, platform(s), country, pillar, format, campaign, audience, CTA, hashtags, planned publish date, owner, assets, notes, linked strategy objective.

Statuses: `IDEA → DRAFT → IN_REVIEW → (CHANGES_REQUESTED → DRAFT…) → APPROVED → SCHEDULED → PUBLISHED → ANALYSED`, plus `REJECTED` and `ARCHIVED` as terminal states.

Editing a submitted item creates a new **version**; old versions are never overwritten. Publishing is manual in V1 (user marks as published and links the live post URL); direct publishing comes later.

### 6.6 Calendar (V1)

Month, week, and list views of content items by planned/actual publish date. Filters: country, platform, owner, status, pillar, campaign. Click opens the item in a side panel. Drag to reschedule (EDITOR+, not for APPROVED items without re-approval — configurable).

### 6.7 Review & approval (V1)

- Editor submits a version for review → item becomes `IN_REVIEW`, reviewers notified.
- Manager can comment (threaded, @mentions), request changes, approve, or reject. Each decision is stored with reviewer, timestamp, version, decision and comment.
- Approval history timeline: Version 1 → comment → Version 2 → comment → Version 3 → Approved.
- Approvals queue: items awaiting my review, sorted by planned publish date.
- V1 uses a single-step approval (any MANAGER+). Multi-step approval chains are a later extension; the data model supports them.

### 6.8 Strategy (V1 basic)

A strategy has: name, scope (organization, or country/market group), period, audiences, objectives (with KPIs and targets), content pillars (with target share of output), tone of voice, platforms, priorities, competitors (links to competitor accounts). Content items and posts link to a pillar and optionally an objective. Strategy page shows coverage: planned/published output per pillar vs target share.

### 6.9 Benchmarking (V1 basic)

- Benchmark groups: sets of accounts (e.g. "CANNA countries – Instagram", "Competitors – Instagram").
- Rankings on a chosen metric and period, always labelled ("Ranked by median engagement rate by reach, Instagram posts, September 2026").
- Metrics: follower growth %, engagement, engagement rate, reach, views, posts published, mean and median post performance.
- A ranking is only offered on metrics every member of the group provides; otherwise members lacking the metric are listed as "excluded: metric unavailable".

### 6.10 AI insights & recommendations (V1 basic)

- Weekly insight run produces 5–10 insights (changes, anomalies, trends, format/pillar winners and losers, country differences, gaps), each with evidence.
- Recommendations: title, observation, evidence, recommendation, expected impact, confidence, relevant accounts, suggested experiment. "Create content idea" turns one into an IDEA item linked to the recommendation.
- Users can mark recommendations as accepted / dismissed / done (feeds learning and Career Intelligence later).

### 6.11 Weekly report (V1)

Auto-generated each Monday for the previous ISO week: global performance, top markets, top content, key insights, opportunities, recommended actions, risks. Stored as a snapshot (numbers frozen at generation time). Viewable in-app and shareable to org members; PDF export after V1.

### 6.12 Scopie AI chat (post-V1)

Natural-language questions answered via tool calls over the analytics layer. Every answer shows which data it used.

### 6.13 Productivity (post-V1)

Team-level workflow stats from Scopie's own data only: approval cycle counts and time-in-review, output volume, publishing consistency, strategy coverage, report automation time saved. No individual surveillance, no tracking outside Scopie, no per-person leaderboards.

### 6.14 Career Intelligence (post-V1)

Private to the individual user: recommendations implemented, campaigns managed, markets supported, measured performance changes on their content, reports automated. "Your impact this quarter" summary built only from recorded Scopie data, with links to the evidence.

## 7. Metric display rules

- Every metric shown uses a key from the metric dictionary (DATABASE.md §5) and shows its definition on hover.
- Rates state their denominator in the label: "Engagement rate (by reach)", "Engagement rate (by followers)".
- Missing data shows "N/A" + reason ("Not provided by LinkedIn API", "Account not connected", "Before account connected").
- Source badge on every KPI and table: `Live`, `Public`, `Manual`, `Imported`, `DEMO`. Any view containing demo data shows a persistent "Contains demo data" banner.
- Averages are always paired with medians where distributions are skewed (post-level metrics).

## 8. Design direction

Modern, professional, minimal, data-focused. Neutral palette with one accent colour, strong type hierarchy (Inter or Geist), 8px grid, subtle borders over shadows, modest radii (6px), dense tables with sticky headers, charts with direct labels and one highlighted series. No gradients, no decorative illustration, no gratuitous animation. Light mode first; tokens structured so dark mode is a theme switch later.

## 9. Non-goals for V1

Direct publishing to platforms; social listening across the open web; paid ads analytics; scraping of any kind; multi-step approval chains; PDF export; mobile app; billing.

## 10. Success criteria (V1)

The 20 criteria in the original brief §42 are the acceptance list. ROADMAP.md maps each to a phase.
