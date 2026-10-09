import 'server-only';
import { loadBenchmarkData } from '@/lib/analytics/queries';
import { DAY_MS } from '@/lib/analytics/range';
import type { Period, PostRecord } from '@/lib/analytics/types';
import { utcToZonedParts } from '@/lib/calendar/time';
import { createClient, type ServerClient } from '@/lib/db/server';
import { measureStrategy, type StrategyMeasures } from '@/lib/strategy/measure';
import { getStrategy, listStrategies } from '@/lib/strategy/queries';
import {
  inInstants,
  postVersusUsual,
  publishingConsistency,
  rangeInstants,
  reviewStats,
  type Consistency,
  type ProductivityPeriod,
  type PostVersusUsual,
  type ReviewDecision,
  type ReviewRecord,
  type ReviewStats,
} from './shared';

// Loads the Productivity page's numbers as the signed-in user, so Row Level Security
// applies to every read. The team view returns counts only: it never selects a name, an
// email or a person's id. "Your impact" only ever reads the records of the user the
// client is signed in as; there is no way to ask for anyone else.

const MAX_ROWS = 10_000;

type Windows = { current: Period; previous: Period | null };

function windowsFor(period: ProductivityPeriod, timeZone: string): Windows {
  return {
    current: rangeInstants(period.range, timeZone),
    previous: period.comparison ? rangeInstants(period.comparison, timeZone) : null,
  };
}

/** From the start of the comparison (or the period) to the end of the period. */
function span(w: Windows): { from: string; to: string } {
  return {
    from: (w.previous?.start ?? w.current.start).toISOString(),
    to: w.current.end.toISOString(),
  };
}

const countIn = (dates: readonly (string | null)[], period: Period | null) =>
  period ? dates.filter((d) => inInstants(d, period)).length : null;

const localDay = (iso: string, timeZone: string) => utcToZonedParts(new Date(iso), timeZone).date;

export type Pair<T> = { current: T; previous: T | null };

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export type StrategyCoverageSummary = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  hasPillarTargets: boolean;
} & StrategyMeasures;

export type TeamProductivity = {
  created: Pair<number>;
  sentForReview: Pair<number>;
  published: Pair<number>;
  reviews: Pair<ReviewStats>;
  consistency: Pair<Consistency>;
  strategies: StrategyCoverageSummary[];
  reports: Pair<{ automatic: number; byHand: number }>;
  analyses: Pair<number>;
};

export async function loadTeamProductivity(input: {
  orgId: string;
  isDemoOrg: boolean;
  timeZone: string;
  period: ProductivityPeriod;
  now?: Date;
  db?: ServerClient;
}): Promise<TeamProductivity> {
  const supabase = input.db ?? (await createClient());
  const now = input.now ?? new Date();
  const { orgId, timeZone, period } = input;
  const w = windowsFor(period, timeZone);
  const { from, to } = span(w);

  // Only ids and times: nothing that names a person.
  const [items, published, submissions, decided, reports, analyses] = await Promise.all([
    supabase
      .from('content_items')
      .select('created_at')
      .eq('organization_id', orgId)
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
    supabase
      .from('content_items')
      .select('published_at')
      .eq('organization_id', orgId)
      .gte('published_at', from)
      .lt('published_at', to)
      .limit(MAX_ROWS),
    supabase
      .from('content_events')
      .select('created_at')
      .eq('organization_id', orgId)
      .eq('to_status', 'IN_REVIEW')
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
    supabase
      .from('content_reviews')
      .select('id, content_item_id, decision, created_at, content_versions(submitted_at)')
      .eq('organization_id', orgId)
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
    supabase
      .from('reports')
      .select('made_by, created_at')
      .eq('organization_id', orgId)
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
    supabase
      .from('analysis_runs')
      .select('created_at')
      .eq('organization_id', orgId)
      .eq('status', 'succeeded')
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
  ]);
  for (const result of [items, published, submissions, decided, reports, analyses]) {
    if (result.error) throw result.error;
  }

  // Rounds behind an approval reach back before the period: load every decision on the
  // items approved in it.
  const toRecord = (r: NonNullable<typeof decided.data>[number]): ReviewRecord => ({
    id: r.id,
    itemId: r.content_item_id,
    decision: r.decision as ReviewDecision,
    decidedAt: r.created_at,
    submittedAt: r.content_versions?.submitted_at ?? null,
  });
  const reviews = decided.data!.map(toRecord);
  const approvedItems = [
    ...new Set(reviews.filter((r) => r.decision === 'APPROVED').map((r) => r.itemId)),
  ];
  if (approvedItems.length) {
    const earlier = await supabase
      .from('content_reviews')
      .select('id, content_item_id, decision, created_at, content_versions(submitted_at)')
      .eq('organization_id', orgId)
      .in('content_item_id', approvedItems)
      .lt('created_at', from)
      .limit(MAX_ROWS);
    if (earlier.error) throw earlier.error;
    reviews.push(...earlier.data.map(toRecord));
  }

  const publishedAt = published.data!.map((r) => r.published_at);
  const publishedDays = publishedAt
    .filter((d): d is string => d !== null)
    .map((d) => localDay(d, timeZone));
  const reportRows = reports.data!;
  const reportCounts = (p: Period) => ({
    automatic: reportRows.filter((r) => r.made_by === 'schedule' && inInstants(r.created_at, p))
      .length,
    byHand: reportRows.filter((r) => r.made_by === 'manual' && inInstants(r.created_at, p)).length,
  });

  return {
    created: pair(
      items.data!.map((r) => r.created_at),
      w,
    ),
    sentForReview: pair(
      submissions.data!.map((r) => r.created_at),
      w,
    ),
    published: pair(publishedAt, w),
    reviews: {
      current: reviewStats(reviews, w.current),
      previous: w.previous ? reviewStats(reviews, w.previous) : null,
    },
    consistency: {
      current: publishingConsistency(publishedDays, period.range),
      previous: period.comparison ? publishingConsistency(publishedDays, period.comparison) : null,
    },
    strategies: await loadStrategyCoverage(supabase, input, now),
    reports: {
      current: reportCounts(w.current),
      previous: w.previous ? reportCounts(w.previous) : null,
    },
    analyses: pair(
      analyses.data!.map((r) => r.created_at),
      w,
    ),
  };
}

function pair(dates: readonly (string | null)[], w: Windows): Pair<number> {
  return { current: countIn(dates, w.current)!, previous: countIn(dates, w.previous) };
}

/** Active strategies whose period overlaps the one shown, measured with the strategy code. */
async function loadStrategyCoverage(
  db: ServerClient,
  input: { orgId: string; isDemoOrg: boolean; timeZone: string; period: ProductivityPeriod },
  now: Date,
): Promise<StrategyCoverageSummary[]> {
  const { range } = input.period;
  const overlapping = (await listStrategies(input.orgId, db)).filter(
    (s) => s.status === 'active' && s.periodStart <= range.end && s.periodEnd >= range.start,
  );
  const out: StrategyCoverageSummary[] = [];
  for (const summary of overlapping) {
    const strategy = await getStrategy(input.orgId, summary.id, db);
    if (!strategy) continue;
    const { coverage, progress } = await measureStrategy({
      orgId: input.orgId,
      isDemoOrg: input.isDemoOrg,
      timeZone: input.timeZone,
      now,
      strategy,
      db,
    });
    out.push({
      id: strategy.id,
      name: strategy.name,
      periodStart: strategy.periodStart,
      periodEnd: strategy.periodEnd,
      hasPillarTargets: strategy.pillars.length > 0,
      coverage,
      progress,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Your impact
// ---------------------------------------------------------------------------

export type ImpactItem = {
  id: string;
  title: string;
  status: string;
  at: string;
};

export type ImpactRecommendation = {
  id: string;
  title: string;
  status: 'accepted' | 'done';
  at: string;
};

export type ImpactReview = ImpactItem & { decision: ReviewDecision };

export type ImpactPerformance = {
  itemId: string;
  title: string;
  profileName: string;
  platformKey: string;
  permalink: string | null;
  result: PostVersusUsual;
};

export type YourImpact = {
  created: Pair<number>;
  createdItems: ImpactItem[];
  published: Pair<number>;
  publishedItems: ImpactItem[];
  recommendations: Pair<number>;
  recommendationItems: ImpactRecommendation[];
  ideasFromRecommendations: Pair<number>;
  ideaItems: ImpactItem[];
  campaigns: { id: string; name: string; items: number }[];
  markets: { code: string; name: string; items: number }[];
  reviews: Pair<number>;
  reviewItems: ImpactReview[];
  reportsByHand: Pair<number>;
  reportItems: { id: string; title: string; at: string }[];
  analyses: Pair<number>;
  /** Your published content in the period that is linked to a post. */
  linkedPosts: number;
  performance: ImpactPerformance[];
};

/**
 * The signed-in user's own recorded work. The user is the one the client is signed in
 * as, read from the session: callers can't pass anyone else's id.
 */
export async function loadYourImpact(input: {
  orgId: string;
  isDemoOrg: boolean;
  timeZone: string;
  period: ProductivityPeriod;
  now?: Date;
  db?: ServerClient;
}): Promise<YourImpact> {
  const supabase = input.db ?? (await createClient());
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Not signed in');
  const me = user.id;
  const { orgId, timeZone, period } = input;
  const w = windowsFor(period, timeZone);
  const { from, to } = span(w);

  const [created, publishedEvents, recs, reviews, reports, analyses] = await Promise.all([
    supabase
      .from('content_items')
      .select(
        'id, title, status, created_at, country_code, campaign_id, source_recommendation_id, campaigns(id, name)',
      )
      .eq('organization_id', orgId)
      .eq('created_by', me)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('content_events')
      .select('content_item_id, created_at, content_items(id, title, status)')
      .eq('organization_id', orgId)
      .eq('actor_id', me)
      .eq('to_status', 'PUBLISHED')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('ai_recommendations')
      .select('id, title, status, status_changed_at')
      .eq('organization_id', orgId)
      .eq('status_changed_by', me)
      .in('status', ['accepted', 'done'])
      .gte('status_changed_at', from)
      .lt('status_changed_at', to)
      .order('status_changed_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('content_reviews')
      .select('id, decision, created_at, content_items(id, title, status)')
      .eq('organization_id', orgId)
      .eq('reviewer_id', me)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('reports')
      .select('id, title, created_at')
      .eq('organization_id', orgId)
      .eq('made_by', 'manual')
      .eq('created_by', me)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('analysis_runs')
      .select('created_at')
      .eq('organization_id', orgId)
      .eq('created_by', me)
      .eq('status', 'succeeded')
      .gte('created_at', from)
      .lt('created_at', to)
      .limit(MAX_ROWS),
  ]);
  for (const result of [created, publishedEvents, recs, reviews, reports, analyses]) {
    if (result.error) throw result.error;
  }

  const inCurrent = <T>(rows: readonly T[], at: (row: T) => string | null) =>
    rows.filter((row) => inInstants(at(row), w.current));

  const createdRows = created.data!;
  const createdNow = inCurrent(createdRows, (r) => r.created_at);
  const ideaRows = createdRows.filter((r) => r.source_recommendation_id !== null);
  const ideasNow = inCurrent(ideaRows, (r) => r.created_at);

  // Published by you: one per item, the latest time it was marked published.
  const publishedRows = publishedEvents.data!.filter((e) => e.content_items);
  const publishedNow = inCurrent(publishedRows, (e) => e.created_at);
  const publishedItems = [
    ...new Map(
      publishedNow.map((e) => [
        e.content_item_id,
        {
          id: e.content_items!.id,
          title: e.content_items!.title,
          status: e.content_items!.status,
          at: e.created_at,
        },
      ]),
    ).values(),
  ];

  const campaigns = new Map<string, { id: string; name: string; items: number }>();
  const marketCounts = new Map<string, number>();
  for (const row of createdNow) {
    if (row.campaigns) {
      const entry = campaigns.get(row.campaigns.id) ?? { ...row.campaigns, items: 0 };
      entry.items += 1;
      campaigns.set(row.campaigns.id, entry);
    }
    if (row.country_code)
      marketCounts.set(row.country_code, (marketCounts.get(row.country_code) ?? 0) + 1);
  }
  let countryNames = new Map<string, string>();
  if (marketCounts.size) {
    const countries = await supabase
      .from('countries')
      .select('code, name')
      .in('code', [...marketCounts.keys()]);
    if (countries.error) throw countries.error;
    countryNames = new Map(countries.data.map((c) => [c.code, c.name]));
  }

  const recRows = recs.data!;
  const reviewRows = reviews.data!.filter((r) => r.content_items);
  const reportRows = reports.data!;

  const countPair = <T>(rows: readonly T[], at: (row: T) => string | null): Pair<number> => ({
    current: countIn(rows.map(at), w.current)!,
    previous: countIn(rows.map(at), w.previous),
  });

  return {
    created: countPair(createdRows, (r) => r.created_at),
    createdItems: createdNow.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      at: r.created_at,
    })),
    published: {
      current: publishedItems.length,
      previous: w.previous
        ? new Set(
            publishedRows
              .filter((e) => inInstants(e.created_at, w.previous!))
              .map((e) => e.content_item_id),
          ).size
        : null,
    },
    publishedItems,
    recommendations: countPair(recRows, (r) => r.status_changed_at),
    recommendationItems: inCurrent(recRows, (r) => r.status_changed_at).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as 'accepted' | 'done',
      at: r.status_changed_at!,
    })),
    ideasFromRecommendations: countPair(ideaRows, (r) => r.created_at),
    ideaItems: ideasNow.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      at: r.created_at,
    })),
    campaigns: [...campaigns.values()].sort(
      (a, b) => b.items - a.items || a.name.localeCompare(b.name),
    ),
    markets: [...marketCounts]
      .map(([code, items]) => ({ code, name: countryNames.get(code) ?? code, items }))
      .sort((a, b) => b.items - a.items || a.name.localeCompare(b.name)),
    reviews: countPair(reviewRows, (r) => r.created_at),
    reviewItems: inCurrent(reviewRows, (r) => r.created_at).map((r) => ({
      id: r.content_items!.id,
      title: r.content_items!.title,
      status: r.content_items!.status,
      at: r.created_at,
      decision: r.decision as ReviewDecision,
    })),
    reportsByHand: countPair(reportRows, (r) => r.created_at),
    reportItems: inCurrent(reportRows, (r) => r.created_at).map((r) => ({
      id: r.id,
      title: r.title,
      at: r.created_at,
    })),
    analyses: countPair(analyses.data!, (r) => r.created_at),
    ...(await loadPerformance(supabase, { ...input, me, window: w.current })),
  };
}

/**
 * Results of your content: items you created, published in the period and linked to the
 * post they became, each compared with its profile's usual post.
 */
async function loadPerformance(
  db: ServerClient,
  input: { orgId: string; isDemoOrg: boolean; now?: Date; me: string; window: Period },
): Promise<{ linkedPosts: number; performance: ImpactPerformance[] }> {
  const linked = await db
    .from('content_items')
    .select('id, title, published_post_id')
    .eq('organization_id', input.orgId)
    .eq('created_by', input.me)
    .not('published_post_id', 'is', null)
    .gte('published_at', input.window.start.toISOString())
    .lt('published_at', input.window.end.toISOString())
    .limit(200);
  if (linked.error) throw linked.error;
  if (!linked.data.length) return { linkedPosts: 0, performance: [] };

  const now = input.now ?? new Date();
  // loadBenchmarkData reads twice `days` back (plus the 7-day engagement age).
  const daysBack = Math.ceil((now.getTime() - input.window.start.getTime()) / DAY_MS) + 1;
  const data = await loadBenchmarkData({
    orgId: input.orgId,
    isDemoOrg: input.isDemoOrg,
    days: Math.max(1, Math.ceil(daysBack / 2) + 1),
    now,
    db,
  });
  const postIndex = new Map<string, { post: PostRecord; accountId: string }>();
  for (const [accountId, entry] of data.data) {
    for (const post of entry.posts) postIndex.set(post.id, { post, accountId });
  }

  const performance: ImpactPerformance[] = linked.data.map((item) => {
    const found = postIndex.get(item.published_post_id!);
    const entry = found ? data.data.get(found.accountId) : undefined;
    if (!found || !entry) {
      return {
        itemId: item.id,
        title: item.title,
        profileName: '',
        platformKey: '',
        permalink: null,
        result: {
          status: 'not_compared',
          reason: 'The linked post has no results stored from a source this view compares.',
        },
      };
    }
    return {
      itemId: item.id,
      title: item.title,
      profileName: entry.profile.name,
      platformKey: entry.profile.platformKey,
      permalink: found.post.permalink,
      result: postVersusUsual(found.post, entry.posts, input.window),
    };
  });
  return { linkedPosts: linked.data.length, performance };
}
