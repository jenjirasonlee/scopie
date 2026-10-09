import type { DataSource } from '@/lib/analytics/types';
import type { InsightSeverity, RecommendationConfidence, SignalKind } from '@/lib/ai/types';

// The weekly report as stored: a snapshot of every number and sentence at the moment it was
// made (reports.snapshot). Pages render it as-is and never recompute it, so a report reads
// the same next month as on the Monday it was made.

export const REPORT_SNAPSHOT_VERSION = 1;

/** A week, Monday to Sunday, as dates in the organization's time zone. */
export type ReportWeek = { start: string; end: string };

export type ReportKpi = {
  key: 'followers_gained' | 'posts_published' | 'median_engagement' | 'content_published' | 'reviews';
  label: string;
  /** null when it couldn't be measured; never 0 for "unknown". */
  value: number | null;
  display: string;
  previous: number | null;
  previousDisplay: string;
  /** "+12 on the week before", or null when either week is unknown. */
  change: string | null;
  /** What the number is made of, in plain words. */
  basis: string;
  /** Why it is N/A, when value is null. */
  unavailable: string | null;
};

export type ReportRankingRow = {
  rank: number;
  accountId: string;
  name: string;
  countryCode: string | null;
  role: 'own' | 'competitor' | 'other';
  display: string;
  sample: string;
};

export type ReportRanking = {
  platformKey: string;
  platform: string;
  /** The ranking's basis sentence (what, when, which data). */
  basis: string;
  rows: ReportRankingRow[];
  /** Profiles not ranked, with the short reason. */
  notRanked: { name: string; reason: string }[];
};

export type ReportPost = {
  accountId: string;
  profile: string;
  platform: string;
  format: string;
  publishedAt: string;
  engagement: number;
  display: string;
  permalink: string | null;
};

export type ReportObjective = { name: string; display: string; note: string | null };

export type ReportStrategy = {
  id: string;
  name: string;
  objectives: ReportObjective[];
  /** One line on pillar coverage, or why it can't be compared yet. */
  coverage: string;
};

export type ReportInsight = {
  id: string;
  kind: SignalKind;
  title: string;
  body: string;
  severity: InsightSeverity;
};

export type ReportAction = {
  id: string;
  title: string;
  recommendation: string;
  confidence: RecommendationConfidence;
};

export type ReportSnapshot = {
  version: typeof REPORT_SNAPSHOT_VERSION;
  orgName: string;
  isDemo: boolean;
  dataSource: DataSource;
  timeZone: string;
  week: ReportWeek;
  previousWeek: ReportWeek;
  /** Short sentences written by Scopie's rules from the numbers below. */
  summary: string[];
  kpis: ReportKpi[];
  /** Own profiles ranked by follower growth in the week, one ranking per platform. */
  markets: ReportRanking[];
  /** Own and competitor profiles together, by follower growth, one ranking per platform. */
  competitors: ReportRanking[];
  topContent: ReportPost[];
  strategies: ReportStrategy[];
  /** From the analysis the report used (see analysis). */
  insights: { key: ReportInsight[]; opportunities: ReportInsight[]; risks: ReportInsight[] };
  actions: ReportAction[];
  analysis: {
    runId: string;
    writer: 'rules' | 'model';
    model: string | null;
    createdAt: string;
    periodStart: string;
    periodEnd: string;
  } | null;
  /** Things the report couldn't include, and why. */
  notes: string[];
};
