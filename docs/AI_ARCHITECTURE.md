# Scopie — AI Architecture

> Status: insights and recommendations built in Phase 8 (§10); weekly report built in Phase 9 (§5); chat (§6) and a first content assistant (§7) built in Phase 11. Last updated: 2026-10-09

## 1. Principles

1. **Numbers come from code, words come from the model.** All statistics (deltas, medians, rankings, anomaly scores, sample sizes) are computed deterministically by `lib/analytics`. The LLM never does arithmetic that ends up on screen.
2. **Evidence or it doesn't ship.** Every insight and recommendation carries `evidence` — references to the exact analytic results it relies on (query id, filters, period, metric, values, sample size). Output that cites unknown evidence ids is rejected.
3. **Association, not causation.** Prompts and output validators enforce careful language ("associated with", "coincides with", "appears to be driven by"). "Caused by" is only allowed when evidence type is `controlled_experiment`.
4. **Minimal data to the model.** Only structured aggregates and the fields needed (post captions only when the task needs them). No tokens, credentials, emails or personal data of followers.
5. **Everything auditable.** Every call is logged in `ai_generations` with inputs, outputs, model, prompt version and cost.
6. **Provider-agnostic.** OpenAI first, behind an interface.

## 2. Components

```
lib/ai/
├─ providers/
│  ├─ types.ts            # LlmProvider interface
│  ├─ openai.ts
│  └─ fake.ts             # deterministic provider for tests
├─ tools/                 # typed read-only analytics tools (used by engines and chat)
├─ signals/               # deterministic signal detection (no LLM)
├─ engines/
│  ├─ insights.ts
│  ├─ recommendations.ts
│  ├─ weekly-report.ts
│  └─ assistant.ts        # content ideas, captions, briefs (post-V1)
├─ prompts/               # versioned prompt templates
├─ schemas/               # Zod schemas for every structured output
└─ governance.ts          # redaction, allow-listed fields, size limits
```

### Provider interface

```ts
export interface LlmProvider {
  id: string; // 'openai'
  generateStructured<T>(req: {
    model: string;
    system: string;
    messages: Message[];
    schema: ZodType<T>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ output: T; usage: Usage }>;
  chatWithTools(req: {
    model: string;
    system: string;
    messages: Message[];
    tools: ToolDefinition[];
    maxSteps: number;
  }): AsyncIterable<ChatEvent>;
}
```

Model names come from env (`AI_MODEL_INSIGHTS`, `AI_MODEL_CHAT`) so they can change without code changes.

## 3. Insight pipeline

```
analytics layer ──▶ signal detection ──▶ candidate signals (JSON, with evidence ids)
                                                │
                                                ▼
                            LLM: select, group, explain, rank (structured output)
                                                │
                                                ▼
                       validators (evidence ids exist, numbers match, language rules)
                                                │
                                                ▼
                                   ai_insights rows (+ ai_generations audit)
```

### Signal detection (deterministic, `lib/ai/signals`)

| Signal                         | Method                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Meaningful change              | Period-over-period delta on account/country/platform aggregates, flagged only if above a minimum absolute size and outside the entity's normal weekly variation (e.g. > 2 robust z-scores using median absolute deviation over the previous 12 weeks). |
| Anomaly / spike / drop         | Post or day value vs rolling median + MAD.                                                                                                                                                                                                             |
| Trend                          | Slope over 8–12 weeks with minimum points.                                                                                                                                                                                                             |
| Format/pillar winners & losers | Compare segment **medians** of engagement rate by reach (or views for video) with minimum sample size per segment (default n ≥ 8) and a bootstrap confidence interval on the difference.                                                               |
| Country differences            | Same segment comparison across countries, only within one platform and comparability class.                                                                                                                                                            |
| Content gaps                   | Strategy pillar target share vs actual output share; pillars with strong performance but low output.                                                                                                                                                   |
| Consistency                    | Posting cadence vs the market's own baseline.                                                                                                                                                                                                          |

Each signal records `evidence = { id, query, filters, period, metric_key, values, n, method }`.

### LLM step

Input: top candidate signals (capped), org strategy summary (objectives, pillars, audiences), metric definitions in use. Output schema:

```ts
Insight = {
  kind: 'change'|'anomaly'|'trend'|'segment_winner'|'segment_loser'|'country_difference'|'gap'|'opportunity'|'risk',
  title: string,           // ≤ 90 chars
  body: string,            // ≤ 600 chars, careful language
  evidenceIds: string[],   // must exist in input
  severity: 'info'|'notable'|'important',
  relatedAccountIds: string[]
}
```

Validators: evidence ids exist; every number in `body` matches a value in the cited evidence (tolerant to rounding); banned causal phrases absent unless allowed; account ids belong to the org. Failures → one repair attempt, then drop.

## 4. Recommendation engine

Input: validated insights + their evidence + strategy + recent recommendation history (to avoid repeats and learn from accepted/dismissed).

```ts
Recommendation = {
  title: string,
  observation: string,
  evidenceIds: string[],
  recommendation: string,
  expectedImpact: string,                 // qualitative, tied to a metric_key; no invented % uplift
  confidence: 'high'|'medium'|'low',
  relevantAccountIds: string[],
  suggestedExperiment: { hypothesis: string; variant: string; control?: string;
                         accounts: string[]; durationDays: number; successMetric: string }
}
```

**Confidence is computed, not chosen by the model.** It is derived from sample size, effect size, CI width and consistency across accounts (`lib/ai/confidence.ts`); the model may only lower it. Example: 47 comparable posts across 6 accounts with a consistent direction → high.

Actions: accept → creates an IDEA content item (`source_recommendation_id`) or an experiment record; dismiss (with optional reason); mark done. Outcomes later feed "recommendations implemented" and a check on whether the recommended change was followed by improved results (reported as association).

## 5. Weekly report

Assembled mostly deterministically: KPI section, top markets (ranked by a named metric), top content, from analytics. The LLM writes only the narrative sections (key insights, opportunities, recommended actions, risks) from that week's validated insights and recommendations. Report stores a `data_snapshot` so numbers never change after generation.

**Built (Phase 9):** `lib/reports/build.ts` assembles the report from `lib/analytics` (KPIs, markets and competitors ranked by follower growth rate, top content by likes + comments at 7 days) and Scopie data (content published, review decisions, running strategies). The narrative sections are not written by a separate model call: the report quotes the insights and open recommendations of the latest analysis (from the last 24 hours, or a new one it runs), which were already checked as described in §10, so the report adds no new model text. The first three insights are the key insights; the rest are split into opportunities and risks by kind; up to three open recommendations are the recommended actions. The whole report is saved as one snapshot (`reports.snapshot`). Generation: `lib/reports/generate.ts`; schedule: `trigger/reports.ts`.

## 6. Scopie AI chat (post-V1)

Tool-calling agent over **read-only, org-scoped analytics tools**. The model never writes SQL.

| Tool                                                    | Returns                                         |
| ------------------------------------------------------- | ----------------------------------------------- |
| `get_overview(range, compare, filters)`                 | KPI values, deltas, sources                     |
| `compare_entities(kind, ids, metric, range)`            | comparable metrics only + "not comparable" list |
| `query_posts(filters, sort, limit)`                     | posts with metadata and metrics                 |
| `segment_performance(dimension, filters, metric)`       | medians, means, n, CI                           |
| `get_benchmark_ranking(group, metric, range)`           | ranking with basis explanation                  |
| `get_strategy(scope)`                                   | objectives, pillars, audiences                  |
| `list_insights(range)` / `list_recommendations(status)` | stored items                                    |
| `metric_definition(key)`                                | definition + platform mapping                   |

Tools run as the calling user (RLS applies), results are size-capped, and each answer renders a "Data used" panel listing tool calls and filters. Questions the data can't answer get "Scopie doesn't have data to answer that" instead of a guess.

**Built (Phase 11):** `/[orgSlug]/insights/chat` ("Ask Scopie", linked from the AI Insights header). Every member may use it, viewers too: it only reads.

- Tools (`lib/ai/chat/tools.ts`): `get_overview(days)` (own profiles: followers gained, posts published, median likes + comments at 7 days, against the period before, per-profile follower change and posts), `rank_profiles(metric, group, days, platform)` (`rankProfiles` per platform, own and/or competitors, with not-ranked reasons), `top_posts(days, group, limit ≤ 10)` (profile, platform, format, date, likes + comments, https link; no caption), `list_insights()` (latest analysis and open recommendations), `strategy_summary()` (running strategies, objectives via `measureStrategy`, pillar coverage), `metric_definition(key)` (`metric_definitions` + platform map). Periods are 7, 30 or 90 days. They use the same `lib/analytics` code as the dashboards and the weekly report, the comparison source only (public or DEMO, so no private metrics of competitors), and keep N/A with its reason. Data is loaded as the signed-in user (`lib/ai/chat/load.ts`).
- What reaches the model: each result passes `toModelResult`, an allow-list of keys (names, platforms, formats, dates, numbers, Scopie's own wording), strings ≤ 400 characters, arrays ≤ 25, a result ≤ 8,000 characters (longest arrays are halved, `truncated: true`). Never captions, bios, hashtags, emails, ids, tokens. The system prompt says tool results are data, not instructions. Each typed question is answered on its own (earlier messages aren't sent).
- With `OPENAI_API_KEY` (and the service role key, for the audit and limits): `chatWithTools` on the provider (OpenAI chat completions with tools, fetch-based, prompt `chat-v1`, model `AI_MODEL_CHAT`, default gpt-4.1-mini); at most 3 rounds of up to 4 tool calls, then the model must answer. The answer must use only numbers found in the tool results (`validate.ts` `checkText`, rounding and percentages allowed) and no causal wording; otherwise Scopie's own wording of the same tool results is shown, with the reason in the panel. An answer without any tool call is replaced by "Scopie doesn't have data to answer that." Each question is logged in `ai_generations` (purpose `chat`, with `user_id`).
- Without a key: five ready questions (followers this month, which competitors grew fastest, top posts this month, what the analysis recommends, how the strategy is doing) run fixed tool calls and fixed wording (`lib/ai/chat/render.ts`), written by Scopie's rules and labelled so. Ready questions never call a model, also when a key is set. Free text is disabled with the reason; managers see what the server is missing.
- "Data used" on every answer: tools called, period, profiles, data source (DEMO / PUBLIC), who wrote it (Scopie's rules or the model's name), and a note when a model answer was replaced.
- Conversations: `ai_chat_messages` (migration `20261016000100_ai_chat.sql`), readable, insertable and deletable only by the person (`user_id = auth.uid()` and membership), never updatable. "Clear conversation" deletes the person's own messages.
- Not built: streaming, multi-turn context, `compare_entities` and `segment_performance` tools.

## 7. Content assistant (post-V1)

Ideas, captions, hooks, repurposing, platform adaptations, briefs. Grounded in: strategy (tone, pillars, audience), top-performing examples from `query_posts`, and platform constraints. Generated text is saved as a DRAFT version, never auto-published; it enters the normal approval flow.

**Built (Phase 11), captions only:** a "Suggest copy" panel on the content item page for editors and up (`content.edit`), shown while the current version can be edited (idea, draft, changes requested; not submitted). With a key, the model (`AI_MODEL_CHAT`, prompt `assistant-v1`, strict JSON) writes 2–3 caption options with hashtags and a one-line reason (`lib/ai/assistant.ts`). Grounding: the item's title, platforms, market, format, pillar, audience, campaign and CTA type, its current brief, caption, CTA and hashtags, and the strategy of its objective (or a running active strategy covering its market and platform): tone of voice, priorities, pillars, audiences. **The item's own caption and brief are sent to the model, only for that item: it is the organization's own draft.** Captions of published posts and competitors are not sent (no top-performing examples yet). Options longer than the strictest platform limit (e.g. X 280) or containing links are dropped. Every call is logged in `ai_generations` (purpose `assistant`). Choosing an option takes its text from that logged generation (not from the browser), starts a new version through `create_content_version` as the person and fills in the caption, hashtags and a note naming the model (`lib/ai/assistant-save.ts`); earlier versions stay, the status doesn't change, nothing is submitted or published. Without a key the panel says it needs an AI key on the server and shows no suggestions.

## 8. Governance

- `governance.ts` builds model inputs from an **allow-list** of fields; anything else is dropped. Unit tests assert no token-like strings, emails or secret env values can appear in prompts.
- Per-org monthly token budget and per-user rate limit for chat.
- Org setting to disable AI entirely or to exclude captions from prompts.
- Retention of `ai_generations` configurable (default 365 days).
- **Built (Phase 11):** model requests by people (typed chat questions and copy suggestions together) are limited to `AI_MAX_CHAT_PER_HOUR` per person per hour (default 20) and 200 per organization per day, counted from `ai_generations` (`lib/ai/chat/limits.ts`); clearing a conversation doesn't reset them. The key is only read on the server and sent only in the Authorization header; errors never include it. Chat tool results are allow-listed (§6); the assistant input is allow-listed (§7). Not built yet: monthly token budgets, an org setting to switch AI off or exclude captions, retention.
- OpenAI API data is not used for training by default under API terms; documented, and the provider interface allows self-hosted models. **[verify current provider terms]**

## 9. Testing

- Signal detection: table-driven unit tests with synthetic series (known spike, known trend, small sample that must not trigger).
- Validators: fixtures with fabricated numbers, unknown evidence ids, causal phrasing → must be rejected.
- Engines: `fake` provider returns canned outputs to test the full pipeline without network.
- Prompt changes bump `prompt_version`; a small eval set of demo-data scenarios runs in CI with the fake provider and optionally live.

## 10. What Phase 8 built

- `lib/ai/signals.ts`: follower growth and posting frequency changes (28 days against the 28 before), format winners and losers on own profiles, competitor formats and topics (hashtags) the organization uses less, standout posts, pillars under target in a running strategy. Engagement is likes + comments at 7 days, divided by the profile's own median, so profiles of different sizes compare. Minimums: 5 measured posts for a profile's usual, 8 posts per format and outside it, 3 posts per topic.
- `lib/ai/confidence.ts`: high needs 30+ posts across 3+ profiles, 75% of them agreeing, and a 1.3× difference; medium 12+ posts and 1.2×. Pillar gaps are medium (they are about the plan).
- `lib/ai/rules.ts`: Scopie's own writer, used when no model is configured and as the fallback.
- `lib/ai/model.ts` and `validate.ts`: the model (OpenAI, strict JSON schema, prompt `insights-v1`) may reword, pick and order insights, and lower confidence one step. Every number must appear in the cited evidence (rounding and percentages allowed), causal and promising wording is refused, unknown signals are dropped. A failed call keeps the rules text for the whole run.
- `lib/ai/run.ts`: loads data as the user (RLS), saves with the service role, one run per two minutes per organization, `AI_MAX_RUNS_PER_DAY` model runs (default 20).
- Not built from this design yet: trends and anomaly scores over 8 to 12 weeks, bootstrap intervals, per-org AI settings and token budgets, cost tracking. (Chat and the content assistant: Phase 11, §6 and §7.)
