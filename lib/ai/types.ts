import type { Enums } from '@/lib/db/types';

// Shared shapes for the analysis: signals found in stored data, the evidence behind them,
// and what gets saved as insights and recommendations. Numbers always come from code;
// a writer (Scopie's rules or a model) only chooses the words.

export type InsightSeverity = Enums<'insight_severity'>;
export type RecommendationConfidence = Enums<'recommendation_confidence'>;
export type RecommendationStatus = Enums<'recommendation_status'>;
export type AnalysisWriter = Enums<'analysis_writer'>;

/** One stored, computed value an insight can cite. */
export type Evidence = {
  /** Unique within a run, e.g. "s3.e1". */
  id: string;
  /** What the number is, in plain words. */
  label: string;
  value: number;
  /** The value as shown, e.g. "1.6×", "12 posts", "+340". */
  display: string;
  /** Sample size behind the value, when it is a median or a share. */
  n?: number;
  /** ISO timestamps, half-open. */
  periodStart: string;
  periodEnd: string;
  /** How it was computed, in plain words. */
  method: string;
  accountIds: string[];
};

export type SignalKind =
  | 'growth_change'
  | 'frequency_change'
  | 'format_winner'
  | 'format_loser'
  | 'competitor_format'
  | 'topic_gap'
  | 'pillar_gap'
  | 'standout_post';

/** What confidence is computed from (lib/ai/confidence.ts). */
export type SignalStats = {
  /** Posts or items behind the signal. */
  n: number;
  /** Profiles behind the signal. */
  accounts: number;
  /** Profiles whose own numbers point the same way. */
  consistentAccounts: number;
  /** Size of the effect as a ratio ≥ 1 (1.6 means 60% above, or 1/0.625 below). */
  effect: number;
};

export type Signal = {
  /** Unique within a run, e.g. "s3". */
  id: string;
  kind: SignalKind;
  severity: InsightSeverity;
  /** Used only to order signals. */
  strength: number;
  accountIds: string[];
  evidence: Evidence[];
  stats: SignalStats;
  /** Named facts the rules writer and the model may use (names, formats, platforms). */
  facts: Record<string, string | number>;
  /** Link to where the data can be seen, relative to the organization, e.g. "/accounts/…". */
  path: string | null;
};

export type InsightDraft = {
  kind: SignalKind;
  title: string;
  body: string;
  severity: InsightSeverity;
  signalIds: string[];
  accountIds: string[];
};

export type Experiment = {
  hypothesis: string;
  variant: string;
  control: string;
  accountIds: string[];
  durationDays: number;
  successMetric: string;
};

export type RecommendationDraft = {
  title: string;
  observation: string;
  recommendation: string;
  expectedImpact: string;
  confidence: RecommendationConfidence;
  confidenceBasis: string;
  signalIds: string[];
  accountIds: string[];
  experiment: Experiment | null;
  /** The signal whose insight this recommendation follows from. */
  insightSignalId: string;
};
