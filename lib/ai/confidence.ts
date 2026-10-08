import type { RecommendationConfidence, SignalStats } from './types';

// Confidence in a recommendation is computed from the evidence, never chosen by a writer:
// how many posts, how many profiles, whether the profiles agree, and how big the effect is.
// A model may only lower it (AI_ARCHITECTURE.md §4).

export const CONFIDENCE_RULES = {
  high: { n: 30, accounts: 3, agreement: 0.75, effect: 1.3 },
  medium: { n: 12, agreement: 0.5, effect: 1.2 },
} as const;

export function computeConfidence(stats: SignalStats): RecommendationConfidence {
  const agreement = stats.accounts ? stats.consistentAccounts / stats.accounts : 0;
  const { high, medium } = CONFIDENCE_RULES;
  if (
    stats.n >= high.n &&
    stats.accounts >= high.accounts &&
    agreement >= high.agreement &&
    stats.effect >= high.effect
  ) {
    return 'high';
  }
  if (
    stats.n >= medium.n &&
    stats.effect >= medium.effect &&
    (stats.accounts === 1 || agreement >= medium.agreement)
  ) {
    return 'medium';
  }
  return 'low';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The sentence shown next to the confidence, so anyone can check it. */
export function confidenceBasis(stats: SignalStats, unit = 'post'): string {
  const parts = [`${plural(stats.n, unit)} across ${plural(stats.accounts, 'profile')}`];
  if (stats.accounts > 1) {
    parts.push(`${stats.consistentAccounts} of ${stats.accounts} profiles point the same way`);
  }
  if (stats.effect > 1) parts.push(`difference of ${stats.effect.toFixed(1)}×`);
  return `${parts.join('; ')}.`;
}

const ORDER: RecommendationConfidence[] = ['low', 'medium', 'high'];

/** The lower of two confidences: a writer can make Scopie less sure, never more. */
export function lowerOf(
  a: RecommendationConfidence,
  b: RecommendationConfidence,
): RecommendationConfidence {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}
