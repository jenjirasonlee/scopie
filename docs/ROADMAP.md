# Scopie — Roadmap

> Status: Phases 1 to 11 built. Phase 3 (public profile intelligence, [PHASE_3_PLAN.md](PHASE_3_PLAN.md)) still needs its live check on a real Meta app, and Phase 4's YouTube collector its live check with a real API key. All roadmap phases are built. X and Bluesky haven't been tried against the live APIs yet. Last updated: 2026-10-09

## 1. Product focus

Scopie is first a **public social intelligence and competitor monitoring** tool. It observes public profiles (competitors, industry accounts, creators and CANNA's own accounts) through official APIs, builds its own history by observing them repeatedly, and compares them honestly.

Connecting an account with OAuth is **optional enrichment** for CANNA-owned accounts: it adds private metrics such as reach, saves and shares. Scopie never requires CANNA Meta Business admin access to work.

Two separate labels describe every profile:

- **Access type:** Public, Connected, Imported, Demo. How Scopie gets the data.
- **Business role:** Owned, Competitor, Industry, Influencer, Other. Why CANNA tracks it.

Every number carries its provenance (PUBLIC, CONNECTED, IMPORTED, ESTIMATED, DEMO). Unavailable values are shown as unavailable, never as zero, and history is never claimed before Scopie started observing.

### Smallest useful V1

> **"Add CANNA's and competitors' Instagram profiles by username, watch them every day, and see who is growing, who posts what, and what performs best, with every number traceable to an observation."**

1. Sign in, organization, roles (done).
2. Profiles with platform, country, business role and access type (done).
3. Public Instagram observation through Meta's official Business Discovery API (done); CSV import for platforms without a public API (done).
4. Dashboard and comparisons built from stored observations (Phase 3, `lib/analytics`).
5. An evidence-based "What changed?" panel (Phase 3, `lib/analytics`).
6. Optional connected enrichment for CANNA accounts (Meta connector, done).

## 2. Phases

Each phase ends with: app runs locally, lint + typecheck + tests green, docs updated, a short demo note.

| Phase                                        | Scope                                                                                                                                                                                                                                                                                          | Exit criteria                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **1** Foundation ✅                          | Next.js + strict TS, Tailwind, shadcn-style UI, Supabase + RLS, auth, organizations, roles, app shell, social accounts, DEMO seed, CI                                                                                                                                                          | Sign in, create org, manage accounts; isolation tests pass                                                          |
| — Architecture review ✅                     | Data-layer review; its decisions are built (see [DATA_PIPELINE.md](DATA_PIPELINE.md), [METRICS.md](METRICS.md))                                                                                                                                                                                | Decisions approved                                                                                                  |
| **2** Real social data pipeline ✅           | Metric dictionary, posts and append-only metric snapshots, shared ingest step, CSV import, Meta connector (Instagram + Facebook) with OAuth, encrypted tokens, scheduled sync, sync health, DEMO posts and metrics                                                                             | A connected account syncs on schedule and on demand; CSV import works; fixture tests for every error path           |
| **3** Public profile intelligence ✅         | Access type and business role, provenance labels, public Instagram observation via Business Discovery, add profile by username, observation history, public posts and engagement, analytics layer, first dashboard, comparisons, "What changed?" panel. See [PHASE_3_PLAN.md](PHASE_3_PLAN.md) | A competitor added by username is observed daily on a real Meta app; dashboard and insights show only stored values |
| **4** Benchmarking + YouTube ✅              | Benchmark groups, rankings with their basis, country vs country, period comparisons; YouTube public collector (API key, no Meta needed)                                                                                                                                                        | Rankings exclude non-comparable values; a YouTube channel is observed with no OAuth                                 |
| **5** Content management + calendar ✅       | Taxonomy screens (pillars, formats, campaigns, audiences), content items, versions, assets, calendar views                                                                                                                                                                                     | Create content with assets and see it on the calendar                                                               |
| **6** Review + approval ✅                   | State machine, comments and mentions, request changes, approve/reject, history, queue, notifications                                                                                                                                                                                           | Draft → review → changes → approved, end to end                                                                     |
| **7** Content strategy ✅                    | Strategies per market, objectives and KPIs, pillar targets, coverage                                                                                                                                                                                                                           | Content linked to an objective; coverage shows                                                                      |
| **8** AI analyst + recommendations ✅        | Provider layer, topics and content gaps from public posts, insights with evidence, "what should CANNA test" recommendations with computed confidence                                                                                                                                           | Insights cite stored values; no causal claims without evidence                                                      |
| **9** Weekly intelligence reports ✅         | Scheduled weekly report, snapshot, in-app view, sharing                                                                                                                                                                                                                                        | Monday report generated automatically                                                                               |
| **10** More platforms ✅                     | Facebook Pages public data (after Meta's Page Public Content Access approval), Instagram hashtag search (after approval), TikTok, X, LinkedIn through official access or a licensed provider; CSV import until then                                                                            | Each with an honest public/private capability list                                                                  |
| **11** Productivity + career intelligence ✅ | Workflow stats, career intelligence, AI chat and content assistant, PDF export                                                                                                                                                                                                                 | —                                                                                                                   |

## 3. Dependencies

```
1 → 2 → 3 → 4 ─┐
    │          ├→ 8 → 9 → 10
    └→ 5 → 6 → 7┘
```

Phases 5–7 don't need platform data, so they can run alongside 3–4. Platforms in Phase 10 can be pulled forward as soon as official access exists.

## 4. What's needed from people (not engineering decisions)

| Needed                                                                                                                                                                                                                                            | When                          | From        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------- |
| A viewer account for public Instagram data: any Instagram professional account linked to a Facebook Page that the person setting up Scopie manages. CANNA Business admin access isn't needed. Steps: [PUBLIC_DATA_SETUP.md](PUBLIC_DATA_SETUP.md) | Before Phase 3 is tested live | Jen         |
| A Meta developer app created by that person (Facebook Login for Business)                                                                                                                                                                         | Before Phase 3 is tested live | Jen         |
| Confirm on the live test whether Standard Access is enough for Business Discovery, or App Review is needed                                                                                                                                        | First live test               | Jen + dev   |
| First list of competitor, industry and creator handles                                                                                                                                                                                            | During Phase 3                | Jen         |
| A short legal/privacy check of competitor monitoring                                                                                                                                                                                              | Before launch                 | CANNA legal |
| A Supabase project and a Trigger.dev project                                                                                                                                                                                                      | Before going live             | Jen         |
| A YouTube Data API key                                                                                                                                                                                                                            | Phase 4                       | Jen         |
| OpenAI API key                                                                                                                                                                                                                                    | Phase 8                       | Jen         |
| A random `REPORTS_CRON_SECRET` set in the app and in Trigger.dev, and `SCOPIE_APP_URL` in Trigger.dev                                                                                                                                             | Phase 9                       | Jen         |

## 5. Risks

| Risk                                                                                       | Mitigation                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta access/approval friction or metric deprecations                                       | Business Discovery runs through the viewer account; whether Standard Access is enough is confirmed on the first live test. Pin API version; metric map is data; saved-response tests keep development unblocked. |
| Business Discovery limits (business/creator accounts only, hidden likes, Reels-only views) | Show each limitation as an availability reason; offer CSV import for accounts the API can't read.                                                                                                                |
| Competitor monitoring and platform terms                                                   | Official APIs only; no scraping; business account metrics only; delete-on-request action; legal check before launch.                                                                                             |
| LinkedIn/TikTok access not granted                                                         | CSV import with the `IMPORTED` label; never fake.                                                                                                                                                                |
| Cross-platform comparisons misleading users                                                | Comparability classes enforced in the analytics layer, not just UI.                                                                                                                                              |
| AI producing generic or wrong claims                                                       | Deterministic signals, evidence validators, computed confidence.                                                                                                                                                 |
| Scope creep before V1                                                                      | This roadmap; each phase has exit criteria.                                                                                                                                                                      |
| No history for public profiles                                                             | Start observing as soon as a profile is added; record first observed date and earliest available post; never back-fill.                                                                                          |

## 6. Phase 1 outcome

Delivered: Next.js 16 + strict TypeScript + Tailwind + shadcn-style UI; Supabase migrations for tenancy, roles/permissions, platforms, countries, social accounts, account groups and audit log, all with RLS; email/password auth with protected routes; organization onboarding and switching; members & roles settings; the full app shell with honest placeholders; a working Accounts module; DEMO seed; 29 unit, 40 database and 4 browser tests; CI.

Deviations from the Phase 1 plan: email + password instead of magic links (simpler local testing; magic links can be added); RLS is tested with Vitest against a real Supabase stack instead of pgTAP (same guarantees, one test runner); the Accounts module was built early because it was requested; member invitations are not on the current roadmap.

## 7. Phase 2 outcome

Delivered: the review's "change before API development" decisions; posts, append-only metric snapshots with availability and post age; the metric dictionary in code and database; one ingest step used by every source; database rules on where data may come from; CSV import with templates; the Meta connector with OAuth, encrypted tokens, link/unlink/disconnect; four sync jobs with backoff, rate-limit and reconnect handling, run by Trigger.dev or `pnpm sync:worker`; Connections, Import and sync-health screens; recent posts and sync history on account pages; DEMO posts and metrics for the demo organization.

Not yet verified against a real Meta account: that needs a Meta app (see §4). Every Meta behaviour is covered by tests against saved responses.

## 8. Phase 3 outcome

Delivered: business role and access type on every profile (access type derived by the database); provenance values PUBLIC / CONNECTED / IMPORTED / ESTIMATED / DEMO with database rules; availability reasons `hidden_by_owner` and `not_public`; the Instagram public collector through Business Discovery and a viewer account; three public sync jobs with an 80% app-usage pause; profile snapshots stored only on change; `earliest_post_at` and observation dates; Settings → Public data; add profile with a live preview, bulk add from a list or CSV, and remove profile with all its data; observation history and coverage on profile pages; DEMO public competitor profiles; dashboard and analytics (`lib/analytics`). Setup guide for the viewer account: [PUBLIC_DATA_SETUP.md](PUBLIC_DATA_SETUP.md).

Not yet verified against a real Meta app: a live Business Discovery lookup, and whether Standard Access is enough. Every Meta behaviour is covered by tests against saved responses.

## 9. Phase 4 outcome

Delivered: the YouTube public collector (Data API v3 with a server API key, no OAuth, no Meta app), YouTube in add profile, bulk add, sync and Settings → Public data; separate comparability classes for YouTube's rounded subscribers and public views; DEMO YouTube channels. The Benchmarks page: rankings by observed follower growth, posts per week, median public engagement or followers, each with a basis sentence, one platform and one data source at a time, and profiles without a comparable value listed as "Not ranked" with the reason; country vs country medians; this period vs the previous one per profile and per group; benchmark groups (create, rename, delete, add and remove profiles).

Not yet verified against the live YouTube API. Every YouTube behaviour is covered by tests against saved responses.

## 10. Phase 5 outcome

Delivered: Settings → Content taxonomy (pillars with a colour, formats, campaigns with dates, audiences, CTA types; add, edit, deactivate). The Content page: list with filters, new content (a title is enough), and an item page with copy, plan, platforms, country, owner and taxonomy. Every save edits the current version; "Start a new version" copies it and keeps the earlier one unchanged. Files (images, videos, PDFs) on each version, stored privately per organization, type checked from the file's bytes (SVG and HTML refused), served only to members. Content is archived, never deleted. The calendar: month, week and list views in the organization's time zone, filters, a details panel, and moving an item to another day by drag or date. Managers can now also edit benchmark groups. DEMO taxonomy and DEMO content items in the seed.

Status moves are limited to Idea, Draft and Archived until the approval flow (Phase 6) exists.

## 11. Phase 6 outcome

Delivered: submit for review (with a note), withdraw, approve, request changes and reject (a comment is required for the last two), mark as scheduled and as published. Every decision and every stage change is kept and shown as a history on the content page. Submitted versions and what the reviewer saw (title, platforms, country, taxonomy) are locked; starting a new version of approved content sends it back to draft, because the approval no longer applies. Managers can't approve their own submission; admins and owners can. Comments with replies, mentions of members, resolve and reopen. In-app notifications for review requests, decisions, mentions and comments on your content. The Approvals page lists what's waiting, sent back, approved, and published or rejected. DEMO review activity in the seed.

Not built yet: email notifications (no email provider is set up), configurable approval rules (who may approve their own work, multi-step approval), and the automatic move to Analysed after publishing (needs post metrics linked to content; a published item can already be linked to its post in the database).

## 12. Phase 7 outcome

Delivered: strategies with a name, summary, period, markets and platforms (empty means all), status (draft, active, archived), tone of voice, priorities, audiences and the competitor profiles they watch. Objectives with a KPI and a target: published content, posts per week, follower growth, or tracked outside Scopie. Target shares per content pillar, adding up to at most 100%. Content items can link to one objective. The strategy page shows pillar coverage (content planned and published in the strategy's period, markets and platforms, per pillar, against its target share) and objective progress. Progress is measured only from stored data: content marked published, and posts and followers observed on the organization's own profiles. When something can't be measured, the page says why instead of showing 0; profiles left out of a total are named with the reason. Managers, admins and owners edit strategies; everyone in the organization reads them. A DEMO strategy in the seed.

Not built yet: KPIs on engagement or reach (they need an agreed definition across platforms first), strategies per account group, and a link from published posts (not content items) to objectives.

## 13. Phase 8 outcome

Delivered: an AI Insights page. A manager runs an analysis; Scopie compares the last 28 days with the 28 before, from stored data only, and finds signals: changes in follower growth and posting frequency, formats that do better or worse than each profile's usual, formats and topics (hashtags) that do well for competitors and that the organization uses less, single posts far above their profile's usual, and pillars under their target in a running strategy. Each insight shows its evidence (value, sample size, period, method, profiles). Recommendations come with a suggested experiment and a confidence computed from sample size, agreement across profiles and effect size; a writer can only lower it. Editors and up turn a recommendation into a content idea (linked to it), dismiss it with a reason, or mark it done.

It works without any AI key: Scopie's own rules write the text from the numbers, and the page says so. With `OPENAI_API_KEY` set on the server, a model rewords the insights; every number it writes must appear in the cited evidence, causal wording is refused, and anything that fails keeps Scopie's text. The model gets only computed values and names of business profiles, never captions, links, ids or personal data. Every model call is kept in `ai_generations`. Runs are limited to one every two minutes per organization and 20 model runs a day (`AI_MAX_RUNS_PER_DAY`).

Not built yet: scheduled weekly runs (Phase 9), trends over 8 to 12 weeks and anomaly scores over longer baselines, an organization setting to switch the model off, cost tracking per call, and checking later whether a followed recommendation was followed by better results.

## 14. Phase 9 outcome

Delivered: weekly reports. Every Monday from 06:00 in the organization's time zone, Scopie makes the report for the week before (Monday to Sunday): a short summary, the week in numbers against the week before (followers gained, posts published, median likes + comments at 7 days, content published and review decisions in Scopie), markets (own profiles ranked by follower growth, per platform), competitor watch (own profiles and competitors together), top content, where each active strategy stood, key insights, opportunities, risks and up to three recommended actions from the latest analysis. A report is a snapshot: its numbers and sentences are saved when it is made and never change afterwards. Anything that couldn't be measured says N/A with the reason, and profiles left out of a ranking are listed with why. Members are told in the app when a report is ready; managers and up can also make last week's report by hand. Reports are shared inside Scopie: every member of the organization can open them, copy the link or print them. There is no email.

The schedule is a Trigger.dev task (`trigger/reports.ts`) that asks the app every hour to make the reports that are due, using `REPORTS_CRON_SECRET`; a missed hour is caught up later in the week.

Not built yet: PDF export (after V1), email delivery, reports for other periods (monthly, per campaign), and comparing a report with earlier ones.

## 15. Phase 10 outcome

Checked on 2026-10-09 which platforms let Scopie read other accounts' public numbers through an official API without the platform approving the app first: only X and Bluesky. Delivered:

- **X**: any public account by @handle or link, read daily through the official X API v2 with a key set on the server (`X_BEARER_TOKEN`). Followers, following, post count, and per post likes, replies, reposts, quotes, bookmarks and views. X charges per read (pay-per-use credits), so Scopie reads each profile once a day, only new posts, and re-reads posts only until they are a week old, with at most 50 posts per profile per run. Protected accounts are not read. Posts deleted on X are deleted from Scopie when they are re-read, as X's terms require.
- **Bluesky**: any public account by handle or link, through Bluesky's open public API, with no key. Followers, following, post count, and per post likes, replies, reposts and quotes (Bluesky has no views). Accounts that ask apps not to show them to logged-out people are not read.
- A list in Settings → Public data saying, for every platform, whether its public data is available and, if not, why: Facebook Pages (Meta's Page Public Content Access approval and a verified business), LinkedIn and Threads (platform approval), TikTok, Pinterest and Discord (no official way), Reddit (written approval for commercial use). CSV import works for all of them.
- DEMO X and Bluesky profiles in the seed.

Neither collector has been tried against the live API yet (this environment can't reach them); they are tested against responses written from the official documentation.

Not built yet: Facebook Pages public data (waits for Meta's approval), Threads and LinkedIn (wait for approval), TikTok and Pinterest public data (no official route), older X history (X charges for it).

## 16. Phase 11 outcome

Delivered:

- **Productivity (team):** content created, sent for review, approved and marked published; review rounds per approval, share approved the first time, median time in review; weeks with something published; strategy coverage and objective progress; reports made automatically and on request, and analyses run. Whole-team numbers only, from Scopie's own records: no names, no per-person breakdown, no tracking outside Scopie. Time saved by automatic reports is shown only as a labelled estimate with its assumption.
- **Your impact (private):** for the signed-in person only, built from their own records with links to the evidence: content created and published, recommendations acted on, ideas from recommendations, campaigns, markets, review decisions, reports made by hand, and results of their published content where it is linked to a post with enough data.
- **Ask Scopie (AI chat):** questions answered from read-only analytics tools that run as the signed-in user, with a "Data used" panel on every answer. Ready questions work without any AI key (Scopie's own rules write the answer); typed questions need `OPENAI_API_KEY`. Numbers in a model's answer must match the tool results, or Scopie's wording is shown instead. Conversations are private to each person. Limits: `AI_MAX_CHAT_PER_HOUR` per person (default 20) and 200 a day per organization.
- **Suggest copy (content assistant):** with an AI key, editors get 2–3 caption options for a content item, grounded in its brief and its strategy's tone, pillars and audiences. A chosen option is saved as a new draft version; nothing is published or submitted.
- **PDF export of weekly reports**, drawn only from the saved snapshot, with DEMO DATA marked on every page.

Not built yet: the chat and assistant haven't been tried with a live AI key; multi-turn chat context; hooks, briefs and repurposing in the assistant; non-Latin characters in the PDF (needs a bundled font); recommendation status history (only the latest change is stored).

## 17. Next step

All roadmap phases are built. What's left is getting the live connections in place (Meta app and viewer account, YouTube key, X key, reports secret, optional AI key) and checking each against real data.
