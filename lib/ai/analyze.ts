import { MAX_INSIGHTS, writeWithModel, type ModelWriteResult, type Rejection } from './model';
import type { LlmProvider } from './providers/types';
import { insightFromSignal, recommendationFromSignal } from './rules';
import type { InsightDraft, RecommendationDraft, Signal } from './types';

// From signals to what gets saved: Scopie's rules write every insight and recommendation;
// a model, when one is configured, may reword them (model.ts checks every item).

export const MAX_RECOMMENDATIONS = 6;
/** Signals offered to the model to pick insights from. */
const MAX_OFFERED = 15;

export type AnalysisResult = {
  insights: InsightDraft[];
  recommendations: RecommendationDraft[];
  rejected: Rejection[];
  /** Set when a model was asked. */
  generation: ModelWriteResult['generation'] | null;
};

export function draftsFromSignals(signals: readonly Signal[]) {
  const offered = signals.slice(0, MAX_OFFERED);
  return {
    offered,
    insights: offered.map(insightFromSignal),
    recommendations: signals
      .map(recommendationFromSignal)
      .filter((r): r is RecommendationDraft => r !== null)
      .slice(0, MAX_RECOMMENDATIONS),
  };
}

export async function analyzeSignals(input: {
  signals: readonly Signal[];
  model: { provider: LlmProvider; name: string } | null;
}): Promise<AnalysisResult> {
  const drafts = draftsFromSignals(input.signals);
  if (!input.model || !input.signals.length) {
    return {
      insights: drafts.insights.slice(0, MAX_INSIGHTS),
      recommendations: drafts.recommendations,
      rejected: [],
      generation: null,
    };
  }
  // Signals behind a recommendation are offered too, so its text can be checked.
  const cited = new Set(drafts.recommendations.map((r) => r.insightSignalId));
  const signals = [
    ...drafts.offered,
    ...input.signals.filter((s) => cited.has(s.id) && !drafts.offered.includes(s)),
  ];
  const written = await writeWithModel({
    provider: input.model.provider,
    model: input.model.name,
    signals,
    insights: drafts.insights,
    recommendations: drafts.recommendations,
  });
  return { ...written };
}
