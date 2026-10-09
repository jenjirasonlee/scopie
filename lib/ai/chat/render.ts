import type { ToolName } from './tools';
import type { ReadyQuestionId } from './shared';
import { NO_DATA_ANSWER } from './shared';

// Scopie's own wording for tool results: fixed sentences filled with the numbers exactly as
// the tools returned them. Used for the ready questions (no model needed) and when a model's
// answer fails the checks. Nothing here computes a number.

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);

/** The tool calls each ready question runs. */
export const READY_QUESTION_CALLS: Record<
  ReadyQuestionId,
  { tool: ToolName; args: Record<string, unknown> }[]
> = {
  followers: [{ tool: 'get_overview', args: { days: 30 } }],
  competitors: [
    {
      tool: 'rank_profiles',
      args: { metric: 'follower_growth', group: 'own_and_competitors', days: 30, platform: null },
    },
  ],
  top_posts: [{ tool: 'top_posts', args: { days: 30, group: 'own', limit: 5 } }],
  recommendations: [{ tool: 'list_insights', args: {} }],
  strategy: [{ tool: 'strategy_summary', args: {} }],
};

/** "Name (Platform)", unless the name already carries the platform. */
function withPlatform(name: string, platform: string): string {
  return !platform || name.endsWith(`(${platform})`) ? name : `${name} (${platform})`;
}

function kpiLine(label: string, kpi: unknown, previousPeriod: string): string {
  if (!isRec(kpi)) return `- ${label}: N/A`;
  if (s(kpi.display) === 'N/A') {
    return `- ${label}: N/A (${s(kpi.unavailable, 'not available').replace(/\.$/, '')}).`;
  }
  const previous = s(kpi.previousDisplay, 'N/A');
  return `- ${label}: ${s(kpi.display)}, against ${previous} in ${previousPeriod}. ${s(kpi.basis)}`;
}

function renderOverview(r: Rec): string[] {
  const own = typeof r.ownProfiles === 'number' ? r.ownProfiles : 0;
  if (!own) return ['There are no active own profiles, so there are no numbers to show.'];
  const previous = s(r.previousPeriod, 'the period before');
  const lines = [
    `Your ${own === 1 ? 'profile' : `${own} profiles`}, ${s(r.period)} (${s(r.source)} data):`,
    kpiLine('Followers gained', r.followersGained, previous),
    kpiLine('Posts published', r.postsPublished, previous),
    kpiLine('Median likes + comments per post', r.medianLikesComments, previous),
  ];
  const profiles = list(r.profiles);
  if (profiles.length) {
    lines.push('By profile:');
    for (const p of profiles) {
      const followers =
        s(p.followersChange) === 'N/A'
          ? `followers N/A (${s(p.followersNote, 'not available').replace(/\.$/, '')})`
          : `${s(p.followersChange)} followers`;
      const posts = s(p.posts) === 'N/A' ? 'posts N/A' : `${s(p.posts)} posts`;
      lines.push(`- ${withPlatform(s(p.name), s(p.platform))}: ${followers}, ${posts}`);
    }
  }
  return lines;
}

function renderRankings(r: Rec): string[] {
  const rankings = list(r.rankings);
  if (!rankings.length) {
    return ['There are no active profiles in this group to rank.'];
  }
  const lines: string[] = [];
  for (const ranking of rankings) {
    lines.push(`${s(ranking.platform)}: ${s(ranking.basis)}`);
    const rows = list(ranking.profiles);
    if (!rows.length) lines.push('- Nobody could be ranked.');
    for (const row of rows) {
      const role =
        s(row.role) === 'competitor' ? ' (competitor)' : s(row.role) === 'own' ? ' (yours)' : '';
      lines.push(
        `- ${String(row.rank)}. ${s(row.name)}${role}: ${s(row.display)} (${s(row.sample)})`,
      );
    }
    const notRanked = list(ranking.notRanked);
    if (notRanked.length) {
      lines.push(
        `Not ranked: ${notRanked.map((n) => `${s(n.name)} (${s(n.reason)})`).join(', ')}.`,
      );
    }
  }
  return lines;
}

function renderTopPosts(r: Rec): string[] {
  const posts = list(r.posts);
  if (!posts.length) {
    return [
      `No post published ${s(r.postsPublishedIn)} has likes + comments measured at 7 days old yet.`,
    ];
  }
  return [
    `Top posts published ${s(r.postsPublishedIn)}, by likes + comments at 7 days old (${s(r.source)} data, ${String(r.measuredPosts)} posts measured):`,
    ...posts.map(
      (p) =>
        `- ${withPlatform(s(p.profile), s(p.platform))}, ${s(p.format)}, ${s(p.publishedOn)}: ${s(p.display)} likes + comments${p.link ? ` ${s(p.link)}` : ''}`,
    ),
  ];
}

function renderInsights(r: Rec): string[] {
  if (!isRec(r.analysis)) {
    return ['No analysis has been run yet, so there are no insights or recommendations.'];
  }
  const a = r.analysis;
  const lines = [
    `The latest analysis ran on ${s(a.ranOn)} and covers ${s(a.period, 'its period')} (worded by ${s(a.writer)}).`,
  ];
  const recs = list(r.openRecommendations);
  if (recs.length) {
    lines.push('Open recommendations:');
    for (const rec of recs) {
      lines.push(`- ${s(rec.title)} (${s(rec.confidence)} confidence): ${s(rec.recommendation)}`);
    }
  } else {
    lines.push('There are no open recommendations.');
  }
  const insights = list(r.insights);
  if (insights.length) {
    lines.push('What stood out:');
    for (const insight of insights.slice(0, 5)) lines.push(`- ${s(insight.title)}`);
  }
  return lines;
}

function renderStrategies(r: Rec): string[] {
  const strategies = list(r.strategies);
  if (!strategies.length) return ['No active strategy is running today.'];
  const lines: string[] = [];
  for (const strategy of strategies) {
    lines.push(`${s(strategy.name)} (${s(strategy.period)}):`);
    const objectives = list(strategy.objectives);
    if (!objectives.length) lines.push('- No objectives set.');
    for (const o of objectives) {
      lines.push(
        `- ${s(o.name)}: ${s(o.progress)}${o.note ? ` (${s(o.note).replace(/\.$/, '')})` : ''}`,
      );
    }
    lines.push(`Pillars: ${s(strategy.coverage)}`);
  }
  return lines;
}

function renderMetric(r: Rec): string[] {
  if (!r.definition) {
    const keys = Array.isArray(r.knownKeys) ? r.knownKeys.filter((k) => typeof k === 'string') : [];
    return [s(r.note, NO_DATA_ANSWER), keys.length ? `Known metrics: ${keys.join(', ')}.` : ''];
  }
  const platforms = Array.isArray(r.platforms) ? r.platforms.join(', ') : '';
  return [
    `${s(r.label)} (${s(r.key)}): ${s(r.definition)}`,
    r.formula ? `Formula: ${s(r.formula)}` : '',
    platforms ? `Provided for: ${platforms}.` : '',
  ];
}

/** Scopie's own answer for one tool result. */
export function renderToolResult(tool: string, result: Rec | { error: string }): string[] {
  if ('error' in result && typeof result.error === 'string') return [NO_DATA_ANSWER];
  const r = result as Rec;
  switch (tool) {
    case 'get_overview':
      return renderOverview(r);
    case 'rank_profiles':
      return renderRankings(r);
    case 'top_posts':
      return renderTopPosts(r);
    case 'list_insights':
      return renderInsights(r);
    case 'strategy_summary':
      return renderStrategies(r);
    case 'metric_definition':
      return renderMetric(r);
    default:
      return [NO_DATA_ANSWER];
  }
}

/** Scopie's own answer for several tool results, joined. */
export function renderAnswer(results: { tool: string; result: Rec | { error: string } }[]): string {
  if (!results.length) return NO_DATA_ANSWER;
  return results
    .flatMap((r) => renderToolResult(r.tool, r.result))
    .filter(Boolean)
    .join('\n');
}
