import type { Pair, TeamProductivity, YourImpact } from './queries';
import {
  formatCount,
  formatHours,
  formatOne,
  formatPercent,
  type ImpactCounts,
  type Tile,
} from './shared';

// Turns loaded numbers into tiles: a value or N/A with the reason, the comparison, and one
// line on what was counted. Pure, so it can be tested without a database.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countTile(
  key: string,
  label: string,
  pair: Pair<number>,
  basis: string,
  href?: string,
): Tile {
  return {
    key,
    label,
    value: pair.current,
    display: formatCount(pair.current),
    previous: pair.previous,
    previousDisplay: pair.previous === null ? undefined : formatCount(pair.previous),
    basis,
    href,
  };
}

/** A tile whose value may be unmeasurable, in either period. */
function measuredTile(
  key: string,
  label: string,
  current: number | null,
  previous: number | null | undefined,
  format: (n: number) => string,
  unavailable: string,
  basis: string,
): Tile {
  return {
    key,
    label,
    value: current,
    display: current === null ? 'N/A' : format(current),
    unavailable: current === null ? unavailable : undefined,
    previous: previous === undefined ? undefined : previous,
    previousDisplay: previous === null || previous === undefined ? undefined : format(previous),
    basis,
  };
}

export type TeamTiles = {
  output: Tile[];
  review: Tile[];
  consistency: Tile[];
  automation: Tile[];
  automaticReports: number;
};

export function teamTiles(team: TeamProductivity, orgSlug: string): TeamTiles {
  const r = team.reviews;
  const c = team.consistency;
  const prev = <T>(pair: Pair<T>) => pair.previous;
  return {
    output: [
      countTile(
        'created',
        'Content items created',
        team.created,
        'Items added to Scopie in the period, by anyone on the team.',
        `/${orgSlug}/content`,
      ),
      countTile(
        'sent_for_review',
        'Sent for review',
        team.sentForReview,
        'Times content was sent for review. Sending again after changes counts again.',
        `/${orgSlug}/approvals`,
      ),
      countTile(
        'approved',
        'Approved',
        { current: r.current.approved, previous: prev(r)?.approved ?? null },
        'Approval decisions made in the period.',
        `/${orgSlug}/approvals?tab=approved`,
      ),
      countTile(
        'published',
        'Marked published',
        team.published,
        'Content marked published in Scopie, by its publish time. Posts never marked here aren’t counted.',
        `/${orgSlug}/content?status=PUBLISHED`,
      ),
    ],
    review: [
      measuredTile(
        'rounds',
        'Review rounds per approval',
        r.current.roundsPerApproval,
        r.previous ? r.previous.roundsPerApproval : undefined,
        formatOne,
        'No content was approved in this period.',
        r.current.approved
          ? `Average decisions behind each of ${plural(r.current.approved, 'approval')}, the approval included. 1 means approved the first time.`
          : 'Decisions behind each approval, the approval included. 1 means approved the first time.',
      ),
      measuredTile(
        'first_time',
        'Approved the first time',
        r.current.firstTimeShare,
        r.previous ? r.previous.firstTimeShare : undefined,
        formatPercent,
        'No content was approved in this period.',
        'Share of approvals that came on the first review, without changes asked for first.',
      ),
      measuredTile(
        'time_in_review',
        'Time in review (median)',
        r.current.medianHoursInReview,
        r.previous ? r.previous.medianHoursInReview : undefined,
        formatHours,
        'No review decisions in this period.',
        r.current.timedDecisions
          ? `Middle value of the time from sent for review to a decision, across ${plural(r.current.timedDecisions, 'decision')}.`
          : 'Middle value of the time from sent for review to a decision.',
      ),
      countTile(
        'decisions',
        'Review decisions',
        { current: r.current.decisions, previous: prev(r)?.decisions ?? null },
        `${r.current.approved} approved, ${r.current.changesRequested} sent back for changes, ${r.current.rejected} rejected.`,
      ),
    ],
    consistency: [
      {
        key: 'weeks_published',
        label: 'Weeks with something published',
        value: c.current.weeksWithPublished,
        display: `${c.current.weeksWithPublished} of ${c.current.weeks}`,
        previous: c.previous ? c.previous.weeksWithPublished : undefined,
        previousDisplay: c.previous
          ? `${c.previous.weeksWithPublished} of ${c.previous.weeks}`
          : undefined,
        basis:
          'Calendar weeks (Monday to Sunday) in the period with at least one item marked published. Part weeks at either end count.',
      },
      measuredTile(
        'per_week',
        'Published per week',
        c.current.perWeek,
        c.previous ? c.previous.perWeek : undefined,
        formatOne,
        '',
        `${plural(c.current.published, 'item')} marked published, divided by the days in the period over 7.`,
      ),
    ],
    automation: [
      countTile(
        'reports_auto',
        'Reports made automatically',
        {
          current: team.reports.current.automatic,
          previous: team.reports.previous?.automatic ?? null,
        },
        'Weekly reports made by the Monday schedule.',
        `/${orgSlug}/reports`,
      ),
      countTile(
        'reports_manual',
        'Reports made on request',
        { current: team.reports.current.byHand, previous: team.reports.previous?.byHand ?? null },
        'Weekly reports a manager asked for with the button.',
        `/${orgSlug}/reports`,
      ),
      countTile(
        'analyses',
        'Analyses run',
        team.analyses,
        'AI analyses that finished, run on request or for a report.',
        `/${orgSlug}/insights`,
      ),
    ],
    automaticReports: team.reports.current.automatic,
  };
}

export function impactTiles(impact: YourImpact): Tile[] {
  return [
    countTile(
      'created',
      'Content you created',
      impact.created,
      'Content items you added to Scopie.',
      '#your-content',
    ),
    countTile(
      'published',
      'Content you marked published',
      impact.published,
      'Items you marked as published, counted once each.',
      '#your-content',
    ),
    countTile(
      'recommendations',
      'Recommendations you acted on',
      impact.recommendations,
      'AI recommendations you last set to accepted or done.',
      '#recommendations',
    ),
    countTile(
      'ideas',
      'Ideas from recommendations',
      impact.ideasFromRecommendations,
      'Content items you created from an AI recommendation.',
      '#recommendations',
    ),
    {
      key: 'campaigns',
      label: 'Campaigns',
      value: impact.campaigns.length,
      display: formatCount(impact.campaigns.length),
      basis: 'Campaigns of the content you created in the period.',
      href: '#campaigns-markets',
    },
    {
      key: 'markets',
      label: 'Markets',
      value: impact.markets.length,
      display: formatCount(impact.markets.length),
      basis: 'Countries of the content you created in the period.',
      href: '#campaigns-markets',
    },
    countTile(
      'reviews',
      'Review decisions you made',
      impact.reviews,
      'Approvals, change requests and rejections you made.',
      '#reviews',
    ),
    countTile(
      'reports',
      'Reports you made by hand',
      impact.reportsByHand,
      'Weekly reports you made with the button.',
      '#reports',
    ),
  ];
}

export function impactCounts(impact: YourImpact): ImpactCounts {
  const compared = impact.performance.filter((p) => p.result.status === 'compared');
  return {
    recommendationsActedOn: impact.recommendations.current,
    ideasFromRecommendations: impact.ideasFromRecommendations.current,
    created: impact.created.current,
    published: impact.published.current,
    campaigns: impact.campaigns.length,
    markets: impact.markets.length,
    reviews: impact.reviews.current,
    approvedByYou: impact.reviewItems.filter((r) => r.decision === 'APPROVED').length,
    reportsByHand: impact.reportsByHand.current,
    postsCompared: compared.length || null,
    postsAboveUsual: compared.filter((p) => p.result.status === 'compared' && p.result.above)
      .length,
  };
}
