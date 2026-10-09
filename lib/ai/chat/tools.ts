import { z } from 'zod';
import { DATA_SOURCE_LABELS } from '@/lib/accounts/labels';
import {
  BENCHMARK_METRIC_INFO,
  BENCHMARK_METRICS,
  engagementWindow,
  formatBenchmarkValue,
  platformsOf,
  rankProfiles,
  type BenchmarkProfileData,
} from '@/lib/analytics/benchmark';
import { MEDIA_FORMAT_LABELS } from '@/lib/analytics/content';
import { MIN_POSTS_FOR_COMPARISON, postEngagement } from '@/lib/analytics/engagement';
import { formatCount, formatSignedCount } from '@/lib/analytics/format';
import { postingFrequency } from '@/lib/analytics/frequency';
import { observedGrowth } from '@/lib/analytics/growth';
import { distinctNames, platformName } from '@/lib/analytics/names';
import { formatDate, formatPeriod, inPeriod, periodsFor } from '@/lib/analytics/range';
import { median } from '@/lib/analytics/stats';
import type { DataSource, Period, ProfileRecord } from '@/lib/analytics/types';
import type { ToolDefinition } from '../providers/types';
import type { DataUsedTool } from './shared';

// The chat's tools: read-only, organization-scoped questions over the analytics layer
// (AI_ARCHITECTURE.md §6). The model only picks a tool and its arguments; every number is
// computed here by lib/analytics, the same code the dashboards and the weekly report use.
// Results hold allow-listed fields only: names, platforms, formats, dates, numbers and
// Scopie's own wording. Never captions, bios, emails, tokens or user ids.

export const PERIOD_DAYS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

/** Caps that keep tool results small. */
export const LIMITS = {
  profiles: 15,
  rankedRows: 10,
  notRanked: 10,
  platforms: 4,
  posts: 10,
  insights: 8,
  recommendations: 5,
  strategies: 5,
  objectives: 8,
  text: 400,
  array: 25,
  /** Characters of one result as sent to the model. */
  resultChars: 8000,
} as const;

// ---------------------------------------------------------------------------
// Data the tools read (loaded by ./load.ts as the signed-in user; faked in tests)
// ---------------------------------------------------------------------------

export type ChatBenchmark = {
  profiles: ProfileRecord[];
  data: ReadonlyMap<string, BenchmarkProfileData>;
};

export type ChatAnalysis = {
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  writer: 'rules' | 'model';
  model: string | null;
  insights: { kind: string; title: string; body: string; severity: string }[];
  recommendations: { title: string; recommendation: string; confidence: string }[];
};

export type ChatStrategy = {
  name: string;
  period: string;
  status: string;
  objectives: { name: string; progress: string; note: string | null }[];
  coverage: string;
};

export type ChatMetric = {
  key: string;
  label: string;
  definition: string;
  unit: string;
  formula: string | null;
  platforms: string[];
};

export interface ChatDataLoaders {
  /** Profiles and stored observations for the last `days` days and the days before. */
  benchmark(days: number): Promise<ChatBenchmark>;
  /** The latest finished analysis, or null when none ran yet. */
  analysis(): Promise<ChatAnalysis | null>;
  /** Active strategies whose period is running, measured. */
  strategies(): Promise<ChatStrategy[]>;
  metric(key: string): Promise<ChatMetric | null>;
  metricKeys(): Promise<{ key: string; label: string }[]>;
}

export type ToolContext = {
  now: Date;
  source: DataSource;
  loaders: ChatDataLoaders;
};

export type ToolOutput = {
  /** What the model (and Scopie's templates) get. Allow-listed and size-capped. */
  result: Record<string, unknown>;
  used: DataUsedTool;
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const days = z
  .union([z.literal(7), z.literal(30), z.literal(90)])
  .default(30)
  .describe('Length of the period in days, ending today.');
const group = z.enum(['own', 'competitors', 'own_and_competitors']);

export const TOOL_ARGS = {
  get_overview: z.object({ days }),
  rank_profiles: z.object({
    metric: z.enum(BENCHMARK_METRICS).default('follower_growth'),
    group: group.default('own_and_competitors'),
    days,
    platform: z.string().max(40).nullish(),
  }),
  top_posts: z.object({
    days,
    group: group.default('own'),
    limit: z.number().int().min(1).max(LIMITS.posts).default(5),
  }),
  list_insights: z.object({}),
  strategy_summary: z.object({}),
  metric_definition: z.object({ key: z.string().min(1).max(60) }),
} as const;

export type ToolName = keyof typeof TOOL_ARGS;
export const TOOL_NAMES = Object.keys(TOOL_ARGS) as ToolName[];

export function isToolName(value: string): value is ToolName {
  return Object.hasOwn(TOOL_ARGS, value);
}

const DAYS_SCHEMA = { type: 'integer', enum: [...PERIOD_DAYS], description: 'Days, ending today.' };
const GROUP_SCHEMA = {
  type: 'string',
  enum: ['own', 'competitors', 'own_and_competitors'],
  description: 'Whose profiles: the organization’s own, tracked competitors, or both.',
};

/** Tool descriptions for the model (JSON Schema arguments). */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_overview',
    description:
      'Totals for the organization’s own active profiles over a period and the period before: followers gained, posts published, median likes + comments per post at 7 days old, and per-profile follower change and posts. Values that cannot be measured are N/A with the reason.',
    parameters: {
      type: 'object',
      properties: { days: DAYS_SCHEMA },
      required: ['days'],
      additionalProperties: false,
    },
  },
  {
    name: 'rank_profiles',
    description:
      'Ranks profiles on one metric, one platform at a time, from public (or demo) data only. Profiles that cannot be ranked are listed with the reason.',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: [...BENCHMARK_METRICS],
          description: Object.entries(BENCHMARK_METRIC_INFO)
            .map(([key, info]) => `${key}: ${info.label}`)
            .join('; '),
        },
        group: GROUP_SCHEMA,
        days: DAYS_SCHEMA,
        platform: {
          type: ['string', 'null'],
          description: 'Platform key such as instagram, or null for every platform.',
        },
      },
      required: ['metric', 'group', 'days', 'platform'],
      additionalProperties: false,
    },
  },
  {
    name: 'top_posts',
    description:
      'Posts with the most likes + comments at 7 days old, among posts published in the period (shifted 7 days back so each post is measured). Gives profile, platform, format, date, likes + comments and a link; never the caption.',
    parameters: {
      type: 'object',
      properties: {
        days: DAYS_SCHEMA,
        group: GROUP_SCHEMA,
        limit: { type: 'integer', minimum: 1, maximum: LIMITS.posts },
      },
      required: ['days', 'group', 'limit'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_insights',
    description:
      'The insights of the latest AI analysis and its open recommendations, as stored (titles, texts, confidence).',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'strategy_summary',
    description:
      'Active strategies whose period is running: objectives with their measured progress, and pillar coverage.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'metric_definition',
    description:
      'How Scopie defines a metric (label, definition, unit, formula, platforms that provide it). Unknown keys return the list of known keys.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Metric key, e.g. followers.' } },
      required: ['key'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Allow-list and size caps
// ---------------------------------------------------------------------------

/** The only keys a tool result may carry to the model. Anything else is dropped. */
export const ALLOWED_RESULT_KEYS = new Set([
  'period',
  'previousPeriod',
  'source',
  'ownProfiles',
  'followersGained',
  'postsPublished',
  'medianLikesComments',
  'value',
  'display',
  'previousDisplay',
  'basis',
  'unavailable',
  'profiles',
  'name',
  'platform',
  'country',
  'role',
  'followersChange',
  'followersNote',
  'posts',
  'postsNote',
  'metric',
  'rankings',
  'rank',
  'sample',
  'notRanked',
  'reason',
  'measuredPosts',
  'postsPublishedIn',
  'profile',
  'format',
  'publishedOn',
  'likesPlusComments',
  'link',
  'analysis',
  'ranOn',
  'writer',
  'insights',
  'kind',
  'title',
  'body',
  'severity',
  'openRecommendations',
  'recommendation',
  'confidence',
  'strategies',
  'status',
  'objectives',
  'progress',
  'note',
  'coverage',
  'key',
  'label',
  'definition',
  'unit',
  'formula',
  'platforms',
  'knownKeys',
  'truncated',
]);

function clean(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, LIMITS.text);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, LIMITS.array).map(clean);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => ALLOWED_RESULT_KEYS.has(key))
        .map(([key, inner]) => [key, clean(inner)]),
    );
  }
  return null;
}

/** Halves the longest array (anywhere in the result) and marks the result truncated. */
function shrink(value: Record<string, unknown>): boolean {
  let longest: unknown[] | null = null;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      if (!longest || node.length > longest.length) longest = node;
      node.forEach(visit);
    } else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(value);
  const target = longest as unknown[] | null;
  if (!target || target.length <= 1) return false;
  target.splice(Math.ceil(target.length / 2));
  value.truncated = true;
  return true;
}

/** A tool result as it may reach the model: allow-listed keys, short strings, size-capped. */
export function toModelResult(result: Record<string, unknown>): Record<string, unknown> {
  const out = clean(result) as Record<string, unknown>;
  while (JSON.stringify(out).length > LIMITS.resultChars && shrink(out)) {
    // keep halving
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ROLE = { owned: 'own', competitor: 'competitor' } as const;

function groupProfiles(profiles: readonly ProfileRecord[], which: z.infer<typeof group>) {
  return profiles.filter(
    (p) =>
      p.isActive &&
      ((which !== 'competitors' && p.businessRole === 'owned') ||
        (which !== 'own' && p.businessRole === 'competitor')),
  );
}

const roleOf = (p: ProfileRecord) =>
  p.businessRole === 'owned'
    ? ROLE.owned
    : p.businessRole === 'competitor'
      ? ROLE.competitor
      : 'other';

type Measured = { value: number | null; counted: number; why: string | null };

function overview(bench: ChatBenchmark, periods: { current: Period; previous: Period }) {
  const own = groupProfiles(bench.profiles, 'own');
  const names = distinctNames(bench.profiles);
  const sum = (measure: (p: ProfileRecord) => number | null, why: string): Measured => {
    let value = 0;
    let counted = 0;
    for (const profile of own) {
      const result = measure(profile);
      if (result === null) continue;
      value += result;
      counted += 1;
    }
    return counted ? { value, counted, why: null } : { value: null, counted, why };
  };
  const growthOf = (profile: ProfileRecord, period: Period) =>
    observedGrowth(bench.data.get(profile.id)?.followers ?? [], period);
  const postsOf = (profile: ProfileRecord, period: Period) =>
    postingFrequency({
      publishedAt: (bench.data.get(profile.id)?.posts ?? []).map((p) => p.publishedAt),
      earliestPostAt: profile.earliestPostAt,
      period,
      observedUntil: profile.lastObservedAt,
    });
  const growth = (period: Period) =>
    sum((p) => {
      const r = growthOf(p, period);
      return r.status === 'ok' ? r.change : null;
    }, 'No own profile has two follower observations a day apart in this period.');
  const posting = (period: Period) =>
    sum((p) => {
      const r = postsOf(p, period);
      return r.status === 'ok' ? r.posts : null;
    }, 'No own profile’s post history covers this period.');
  const engagement = (period: Period): Measured & { posts: number } => {
    const window = engagementWindow(period);
    const values = own.flatMap((profile) =>
      (bench.data.get(profile.id)?.posts ?? []).flatMap((post) => {
        if (!inPeriod(post.publishedAt, window)) return [];
        const e = postEngagement(post);
        return e.status === 'ok' ? [e.value] : [];
      }),
    );
    return values.length < MIN_POSTS_FOR_COMPARISON
      ? {
          value: null,
          counted: 0,
          posts: values.length,
          why: `Only ${plural(values.length, 'post')} measured at 7 days old; ${MIN_POSTS_FOR_COMPARISON} are needed.`,
        }
      : { value: median(values)!, counted: own.length, posts: values.length, why: null };
  };

  const kpi = (
    current: Measured,
    previous: Measured,
    format: (n: number) => string,
    basis: string,
  ) => ({
    value: current.value,
    display: current.value === null ? 'N/A' : format(current.value),
    previousDisplay: previous.value === null ? 'N/A' : format(previous.value),
    basis,
    unavailable: current.value === null ? current.why : null,
  });

  const followers = growth(periods.current);
  const posts = posting(periods.current);
  const median7 = engagement(periods.current);
  return {
    period: formatPeriod(periods.current),
    previousPeriod: formatPeriod(periods.previous),
    ownProfiles: own.length,
    followersGained: kpi(
      followers,
      growth(periods.previous),
      formatSignedCount,
      `Sum over ${followers.counted} of ${plural(own.length, 'own profile')}: last follower count observed in the period minus the first.`,
    ),
    postsPublished: kpi(
      posts,
      posting(periods.previous),
      formatCount,
      `Posts on ${posts.counted} of ${plural(own.length, 'own profile')} whose post history covers the period.`,
    ),
    medianLikesComments: kpi(
      median7,
      engagement(periods.previous),
      formatCount,
      `Median likes + comments per post at 7 days old, over ${plural(median7.posts, 'post')} on your profiles.`,
    ),
    profiles: own.slice(0, LIMITS.profiles).map((profile) => {
      const g = growthOf(profile, periods.current);
      const f = postsOf(profile, periods.current);
      return {
        name: names.get(profile.id) ?? profile.name,
        platform: platformName(profile.platformKey),
        followersChange: g.status === 'ok' ? formatSignedCount(g.change) : 'N/A',
        followersNote: g.status === 'ok' ? null : g.detail,
        posts: f.status === 'ok' ? formatCount(f.posts) : 'N/A',
        postsNote: f.status === 'ok' ? null : f.detail,
      };
    }),
    ...(own.length > LIMITS.profiles ? { truncated: true } : {}),
  };
}

function rankings(
  bench: ChatBenchmark,
  args: z.infer<(typeof TOOL_ARGS)['rank_profiles']>,
  period: Period,
  source: DataSource,
) {
  const names = distinctNames(bench.profiles);
  const set = groupProfiles(bench.profiles, args.group);
  const platforms = platformsOf(set)
    .map((p) => p.key)
    .filter((key) => !args.platform || key === args.platform.toLowerCase());
  const setLabel =
    args.group === 'own'
      ? 'your profiles'
      : args.group === 'competitors'
        ? 'competitors'
        : 'your profiles and competitors';
  return {
    metric: BENCHMARK_METRIC_INFO[args.metric].label,
    period: formatPeriod(period),
    source: DATA_SOURCE_LABELS[source],
    rankings: platforms.slice(0, LIMITS.platforms).map((key) => {
      const result = rankProfiles({
        metric: args.metric,
        platformKey: key,
        data: set
          .filter((p) => p.platformKey === key)
          .flatMap((p) => {
            const d = bench.data.get(p.id);
            return d ? [d] : [];
          }),
        period,
        source,
        setLabel,
      });
      const excluded = result.excluded.filter((e) => e.reason !== 'other_platform');
      return {
        platform: platformName(key),
        basis: result.basis,
        profiles: result.ranked.slice(0, LIMITS.rankedRows).map((entry) => ({
          rank: entry.rank,
          name: names.get(entry.profile.id) ?? entry.profile.name,
          role: roleOf(entry.profile),
          country: entry.profile.countryCode,
          display: formatBenchmarkValue(args.metric, entry.value),
          sample: entry.measurement.sample,
        })),
        notRanked: excluded.slice(0, LIMITS.notRanked).map((entry) => ({
          name: names.get(entry.profile.id) ?? entry.profile.name,
          reason: entry.label,
        })),
        ...(result.ranked.length > LIMITS.rankedRows || excluded.length > LIMITS.notRanked
          ? { truncated: true }
          : {}),
      };
    }),
    ...(platforms.length > LIMITS.platforms ? { truncated: true } : {}),
  };
}

const safeLink = (url: string | null) => (url && /^https:\/\//.test(url) ? url : null);

function topPosts(
  bench: ChatBenchmark,
  args: z.infer<(typeof TOOL_ARGS)['top_posts']>,
  period: Period,
) {
  const names = distinctNames(bench.profiles);
  const window = engagementWindow(period);
  const set = groupProfiles(bench.profiles, args.group);
  const measured = set.flatMap((profile) =>
    (bench.data.get(profile.id)?.posts ?? []).flatMap((post) => {
      if (!inPeriod(post.publishedAt, window)) return [];
      const e = postEngagement(post);
      return e.status === 'ok' ? [{ profile, post, value: e.value }] : [];
    }),
  );
  measured.sort(
    (a, b) => b.value - a.value || b.post.publishedAt.localeCompare(a.post.publishedAt),
  );
  return {
    period: formatPeriod(period),
    postsPublishedIn: formatPeriod(window),
    measuredPosts: measured.length,
    basis:
      'Likes + comments when each post was 7 days old; posts with hidden likes or not measured yet are left out.',
    posts: measured.slice(0, args.limit).map(({ profile, post, value }) => ({
      profile: names.get(profile.id) ?? profile.name,
      role: roleOf(profile),
      platform: platformName(profile.platformKey),
      format: MEDIA_FORMAT_LABELS[post.mediaFormat],
      publishedOn: formatDate(post.publishedAt),
      likesPlusComments: value,
      display: formatCount(value),
      link: safeLink(post.permalink),
    })),
  };
}

function short(text: string, max = 300) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Runs one tool. Invalid arguments and unknown tools return an error result, never throw. */
export async function runTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolOutput | { error: string }> {
  if (!isToolName(name)) return { error: `There is no tool called ${name}.` };
  const parsed = TOOL_ARGS[name].safeParse(rawArgs ?? {});
  if (!parsed.success) return { error: `The arguments for ${name} are not valid.` };
  const source = DATA_SOURCE_LABELS[ctx.source];

  switch (name) {
    case 'get_overview': {
      const args = parsed.data as z.infer<(typeof TOOL_ARGS)['get_overview']>;
      const periods = periodsFor(ctx.now, args.days);
      const bench = await ctx.loaders.benchmark(args.days);
      const result = { source, ...overview(bench, periods) };
      return {
        result: toModelResult(result),
        used: {
          tool: name,
          label: 'Overview of your profiles',
          period: result.period,
          profiles: result.ownProfiles,
        },
      };
    }
    case 'rank_profiles': {
      const args = parsed.data as z.infer<(typeof TOOL_ARGS)['rank_profiles']>;
      const { current } = periodsFor(ctx.now, args.days);
      const bench = await ctx.loaders.benchmark(args.days);
      const result = rankings(bench, args, current, ctx.source);
      return {
        result: toModelResult(result),
        used: {
          tool: name,
          label: `Ranking by ${BENCHMARK_METRIC_INFO[args.metric].label.toLowerCase()}`,
          period: result.period,
          profiles: groupProfiles(bench.profiles, args.group).length,
        },
      };
    }
    case 'top_posts': {
      const args = parsed.data as z.infer<(typeof TOOL_ARGS)['top_posts']>;
      const { current } = periodsFor(ctx.now, args.days);
      const bench = await ctx.loaders.benchmark(args.days);
      const result = { source, ...topPosts(bench, args, current) };
      return {
        result: toModelResult(result),
        used: {
          tool: name,
          label: 'Top posts by likes + comments',
          period: result.postsPublishedIn,
          profiles: groupProfiles(bench.profiles, args.group).length,
        },
      };
    }
    case 'list_insights': {
      const analysis = await ctx.loaders.analysis();
      const period = analysis
        ? formatPeriod({ start: new Date(analysis.periodStart), end: new Date(analysis.periodEnd) })
        : null;
      const result = analysis
        ? {
            analysis: {
              ranOn: formatDate(analysis.createdAt),
              period,
              writer: analysis.writer === 'model' ? `AI model ${analysis.model}` : 'Scopie’s rules',
            },
            insights: analysis.insights.slice(0, LIMITS.insights).map((i) => ({
              kind: i.kind,
              title: short(i.title, 160),
              body: short(i.body),
              severity: i.severity,
            })),
            openRecommendations: analysis.recommendations
              .slice(0, LIMITS.recommendations)
              .map((r) => ({
                title: short(r.title, 160),
                recommendation: short(r.recommendation),
                confidence: r.confidence,
              })),
          }
        : { analysis: null, note: 'No analysis has been run yet.' };
      return {
        result: toModelResult(result),
        used: {
          tool: name,
          label: 'Latest analysis and open recommendations',
          period,
          profiles: null,
        },
      };
    }
    case 'strategy_summary': {
      const strategies = await ctx.loaders.strategies();
      const result = strategies.length
        ? {
            strategies: strategies.slice(0, LIMITS.strategies).map((s) => ({
              name: s.name,
              period: s.period,
              status: s.status,
              objectives: s.objectives.slice(0, LIMITS.objectives),
              coverage: s.coverage,
            })),
          }
        : { strategies: [], note: 'No active strategy is running today.' };
      return {
        result: toModelResult(result),
        used: { tool: name, label: 'Running strategies', period: null, profiles: null },
      };
    }
    case 'metric_definition': {
      const args = parsed.data as z.infer<(typeof TOOL_ARGS)['metric_definition']>;
      const key = args.key.trim().toLowerCase();
      const metric = await ctx.loaders.metric(key);
      const result = metric
        ? { ...metric }
        : {
            note: `Scopie has no metric called ${key.slice(0, 40)}.`,
            knownKeys: (await ctx.loaders.metricKeys()).map((m) => m.key),
          };
      return {
        result: toModelResult(result),
        used: {
          tool: name,
          label: `Metric definition: ${metric?.label ?? key.slice(0, 40)}`,
          period: null,
          profiles: null,
        },
      };
    }
  }
}
