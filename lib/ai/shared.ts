import type {
  AnalysisWriter,
  Evidence,
  Experiment,
  InsightSeverity,
  RecommendationConfidence,
  RecommendationStatus,
} from './types';

// Labels and small helpers for the AI Insights page. Safe to use in the browser.

export const SEVERITY_LABELS: Record<InsightSeverity, string> = {
  important: 'Important',
  notable: 'Notable',
  info: 'For information',
};

export const SEVERITY_VARIANT: Record<InsightSeverity, 'warning' | 'outline' | 'muted'> = {
  important: 'warning',
  notable: 'outline',
  info: 'muted',
};

export const CONFIDENCE_LABELS: Record<RecommendationConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export const CONFIDENCE_VARIANT: Record<RecommendationConfidence, 'success' | 'outline' | 'muted'> =
  {
    high: 'success',
    medium: 'outline',
    low: 'muted',
  };

/** What kind of finding an insight is, in plain words. */
const KIND_LABELS: Record<string, string> = {
  growth_change: 'Follower growth',
  frequency_change: 'Posting frequency',
  format_winner: 'Format doing well',
  format_loser: 'Format doing less well',
  competitor_format: 'Competitors',
  topic_gap: 'Topic gap',
  pillar_gap: 'Pillar gap',
  standout_post: 'Standout post',
};

/** Unknown kinds (from a newer analysis) fall back to their key in words. */
export function insightKindLabel(kind: string): string {
  const known = KIND_LABELS[kind];
  if (known) return known;
  const words = kind.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Insight';
}

// ---------------------------------------------------------------------------
// Recommendation tabs
// ---------------------------------------------------------------------------

export const RECOMMENDATION_TABS = [
  'open',
  'accepted',
  'done',
  'dismissed',
] as const satisfies readonly RecommendationStatus[];

export const RECOMMENDATION_TAB_LABELS: Record<RecommendationStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  done: 'Done',
  dismissed: 'Dismissed',
};

/** What each tab holds, shown when it's empty. */
export const RECOMMENDATION_TAB_EMPTY: Record<RecommendationStatus, string> = {
  open: 'No open recommendations. New ones appear here after each analysis.',
  accepted: 'Nothing accepted yet. Recommendations you turn into a content idea show up here.',
  done: 'Nothing marked done yet. Mark a recommendation done once you have acted on it.',
  dismissed: 'Nothing dismissed. Recommendations you decide not to follow show up here.',
};

export function parseRecommendationTab(value: unknown): RecommendationStatus {
  return RECOMMENDATION_TABS.includes(value as RecommendationStatus)
    ? (value as RecommendationStatus)
    : 'open';
}

/** Link to a tab of the recommendations list ("open" is the default tab). */
export function recommendationTabHref(orgSlug: string, status: RecommendationStatus): string {
  return status === 'open' ? `/${orgSlug}/insights` : `/${orgSlug}/insights?tab=${status}`;
}

/** "Dismissed by Sam, 3 Oct 2026", without the parts that aren't known. */
export function statusChangeLabel(
  status: RecommendationStatus,
  by: string | null,
  when: string | null,
): string | null {
  if (status === 'open' || (!by && !when)) return null;
  const verb: Record<Exclude<RecommendationStatus, 'open'>, string> = {
    accepted: 'Accepted',
    done: 'Marked done',
    dismissed: 'Dismissed',
  };
  return [verb[status], by ? ` by ${by}` : '', when ? `, ${when}` : ''].join('');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function dayParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: get('day'), month: get('month'), year: get('year') };
}

/**
 * A half-open period ("2026-09-01T00:00Z" up to "2026-10-01T00:00Z") as the days it covers,
 * in the organization's time zone: "1 – 30 Sep 2026", "25 Aug – 7 Sep 2026",
 * "28 Dec 2025 – 3 Jan 2026". Null when the dates can't be read.
 */
export function formatPeriod(start: string, end: string, timeZone: string): string | null {
  const from = new Date(start);
  // The end is not included, so the last day shown is the one just before it.
  const to = new Date(new Date(end).getTime() - 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null;
  const a = dayParts(from, timeZone);
  const b = dayParts(to, timeZone);
  const last = `${b.day} ${b.month} ${b.year}`;
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${last}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${last}`;
  if (a.day !== b.day) return `${a.day} – ${last}`;
  return last;
}

// ---------------------------------------------------------------------------
// Evidence and experiments
// ---------------------------------------------------------------------------

/** Profile names for evidence rows. Ids not found (deleted profiles) read "Removed profile". */
export function profileNames(ids: readonly string[], names: ReadonlyMap<string, string>): string[] {
  const result: string[] = [];
  let removed = 0;
  for (const id of new Set(ids)) {
    const name = names.get(id);
    if (name) result.push(name);
    else removed += 1;
  }
  if (removed === 1) result.push('Removed profile');
  if (removed > 1) result.push(`${removed} removed profiles`);
  return result;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(isString) : [];

/**
 * Evidence rows as stored (jsonb). Rows missing the parts the page needs are left out
 * rather than shown with made-up values; a missing sample size stays missing.
 */
export function readEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((row) => {
    if (!isString(row.id) || !isString(row.label) || !isString(row.display)) return [];
    return [
      {
        id: row.id,
        label: row.label,
        value: typeof row.value === 'number' ? row.value : Number.NaN,
        display: row.display,
        n: typeof row.n === 'number' && Number.isFinite(row.n) ? row.n : undefined,
        periodStart: isString(row.periodStart) ? row.periodStart : '',
        periodEnd: isString(row.periodEnd) ? row.periodEnd : '',
        method: isString(row.method) ? row.method : '',
        accountIds: stringList(row.accountIds),
      },
    ];
  });
}

/** A stored experiment (jsonb), or null when there is none or it can't be read. */
export function readExperiment(value: unknown): Experiment | null {
  if (!isRecord(value)) return null;
  const { hypothesis, variant, control, successMetric, durationDays } = value;
  if (!isString(hypothesis) || !isString(variant)) return null;
  return {
    hypothesis,
    variant,
    control: isString(control) ? control : '',
    accountIds: stringList(value.accountIds),
    durationDays: typeof durationDays === 'number' && durationDays > 0 ? durationDays : Number.NaN,
    successMetric: isString(successMetric) ? successMetric : '',
  };
}

/** Signal id → link path, from a run's stored signals. Paths are relative to the organization. */
export function readSignalPaths(value: unknown): Map<string, string> {
  const paths = new Map<string, string>();
  if (!Array.isArray(value)) return paths;
  for (const signal of value) {
    if (isRecord(signal) && isString(signal.id) && isString(signal.path)) {
      // Only paths inside the organization; never a full URL.
      if (signal.path.startsWith('/') && !signal.path.startsWith('//')) {
        paths.set(signal.id, signal.path);
      }
    }
  }
  return paths;
}

/** What the analysis left out (shown to managers). */
export function readRejected(value: unknown): { what: string; reason: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((row) => isString(row.what) && isString(row.reason))
    .map((row) => ({ what: row.what as string, reason: row.reason as string }));
}

/** "14 days", or null when the length isn't known. */
export function formatDuration(days: number): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return days === 1 ? '1 day' : `${days} days`;
}

/** One line on who wrote a run's words, for the "Who wrote this" note. */
export function writerSentence(writer: AnalysisWriter, model: string | null): string {
  if (writer === 'model') {
    return `The words were written by the AI model ${model ?? '(name not recorded)'}. Scopie computed every number itself and checked each one the model used against the evidence before saving.`;
  }
  return 'Written from your numbers by Scopie’s own rules. No AI model is connected, so no AI wrote these words.';
}

// ---------------------------------------------------------------------------
// Content idea from a recommendation
// ---------------------------------------------------------------------------

/** Text for version 1 of a content idea made from a recommendation. */
export function ideaFromRecommendation(
  rec: {
    title: string;
    observation: string;
    recommendation: string;
    expectedImpact: string;
    experiment: Experiment | null;
  },
  names: ReadonlyMap<string, string>,
): { title: string; description: string; notes: string } {
  const description = [
    rec.recommendation,
    `What the data shows: ${rec.observation}`,
    `Expected impact: ${rec.expectedImpact}`,
  ].join('\n\n');

  const notes = [`Created from the AI recommendation “${rec.title}”.`];
  const experiment = rec.experiment;
  if (experiment) {
    const profiles = profileNames(experiment.accountIds, names);
    const duration = formatDuration(experiment.durationDays);
    notes.push(
      [
        'Suggested experiment',
        `Hypothesis: ${experiment.hypothesis}`,
        `Try: ${experiment.variant}`,
        experiment.control ? `Compare with: ${experiment.control}` : null,
        profiles.length ? `Profiles: ${profiles.join(', ')}` : null,
        duration ? `Run for: ${duration}` : null,
        experiment.successMetric ? `Success measure: ${experiment.successMetric}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return {
    title: rec.title.trim().slice(0, 200),
    description: description.slice(0, 5000),
    notes: notes.join('\n\n').slice(0, 5000),
  };
}
