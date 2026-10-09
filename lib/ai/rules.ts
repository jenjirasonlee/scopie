import { computeConfidence, confidenceBasis } from './confidence';
import type { Experiment, InsightDraft, RecommendationDraft, Signal } from './types';

// Scopie's own writer: fixed sentences filled with the signal's evidence. It is what the
// analysis uses when no model is configured, and the fallback for anything a model writes
// that fails the checks. Every number in the text is an evidence display value.

export const EXPERIMENT_DAYS = 28;
const ENGAGEMENT_METRIC = "Median likes + comments at 7 days, against each profile's usual";

const shown = (signal: Signal, k: number) => signal.evidence[k - 1]?.display ?? '';
const fact = (signal: Signal, key: string) => String(signal.facts[key] ?? '');
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const ids = (value: string) => value.split(',').filter(Boolean);

export function insightFromSignal(signal: Signal): InsightDraft {
  const base = {
    kind: signal.kind,
    severity: signal.severity,
    signalIds: [signal.id],
    accountIds: signal.accountIds,
  };
  const e = (k: number) => shown(signal, k);
  const f = (key: string) => fact(signal, key);
  switch (signal.kind) {
    case 'growth_change':
      return {
        ...base,
        title: `${f('profile')} gained followers ${f('direction') === 'faster' ? 'faster' : 'more slowly'} than in the period before`,
        body: `Follower growth was ${e(2)} this period (${e(1)} followers), against ${e(3)} in the period before. Scopie compares the first and last follower counts it observed in each period.`,
      };
    case 'frequency_change':
      return {
        ...base,
        title: `${f('profile')} posted ${f('direction') === 'more' ? 'more' : 'less'} often`,
        body: `${e(1)} posts a week this period, against ${e(2)} in the period before.`,
      };
    case 'format_winner':
      return {
        ...base,
        title: `${cap(f('format'))} did better than usual on ${f('platform')}`,
        body: `On your ${f('platform')} profiles, ${f('format')} got ${e(1)} the engagement each profile usually gets (${signal.evidence[0]!.n} posts). They were ${e(2)} of your measured posts there.`,
      };
    case 'format_loser':
      return {
        ...base,
        title: `${cap(f('format'))} did worse than usual on ${f('platform')}`,
        body: `On your ${f('platform')} profiles, ${f('format')} got ${e(1)} the engagement each profile usually gets (${signal.evidence[0]!.n} posts). They were ${e(2)} of your measured posts there.`,
      };
    case 'competitor_format':
      return {
        ...base,
        title: `Competitors' ${f('format')} did well on ${f('platform')}`,
        body: `Competitors' ${f('format')} got ${e(1)} their usual engagement (${signal.evidence[0]!.n} posts), and ${e(2)} of their posts were ${f('format')}.${signal.evidence[2] ? ` For your profiles it was ${e(3)}.` : ' Scopie has no measured posts of yours on this platform to compare.'}`,
      };
    case 'topic_gap':
      return {
        ...base,
        title: `${f('tag')} did well for competitors`,
        body: `Competitor posts with ${f('tag')} got ${e(1)} their usual engagement (${signal.evidence[0]!.n} posts, from ${f('competitors')}). Your profiles had ${e(2)} with it in this period.`,
      };
    case 'standout_post':
      return {
        ...base,
        title: `One ${f('format')} by ${f('profile')} did ${e(2)} its usual`,
        body: `It got ${e(1)} likes + comments at 7 days, ${e(2)} what the profile usually gets. One post is a single data point.`,
      };
    case 'pillar_gap':
      return {
        ...base,
        title: `${f('pillar')} is under its target in ${f('strategy')}`,
        body: `${e(1)} of the content planned or published for ${f('strategy')} is ${f('pillar')}, against a target of ${e(2)} (${e(3)}).`,
      };
  }
}

function experiment(input: Omit<Experiment, 'durationDays' | 'successMetric'>): Experiment {
  return { ...input, durationDays: EXPERIMENT_DAYS, successMetric: ENGAGEMENT_METRIC };
}

export function recommendationFromSignal(signal: Signal): RecommendationDraft | null {
  const insight = insightFromSignal(signal);
  const e = (k: number) => shown(signal, k);
  const f = (key: string) => fact(signal, key);
  const base = {
    observation: insight.body,
    signalIds: [signal.id],
    insightSignalId: signal.id,
    confidence: computeConfidence(signal.stats),
    confidenceBasis: confidenceBasis(signal.stats),
  };
  const association =
    'This is an association in past posts, not a promise: other things changed too.';
  switch (signal.kind) {
    case 'format_winner':
      return {
        ...base,
        title: `Post more ${f('format')} on ${f('platform')}`,
        recommendation: `For the next four weeks, make at least half of your ${f('platform')} posts ${f('format')} and compare them with each profile's usual.`,
        expectedImpact: `If the pattern holds, more posts near ${e(1)} the usual likes + comments at 7 days. ${association}`,
        accountIds: signal.accountIds,
        experiment: experiment({
          hypothesis: `${cap(f('format'))} are associated with higher engagement than usual on these profiles.`,
          variant: `At least half of the posts are ${f('format')}.`,
          control: 'The usual mix of formats.',
          accountIds: signal.accountIds,
        }),
      };
    case 'format_loser':
      return {
        ...base,
        title: `Try a different take on ${f('format')} on ${f('platform')}`,
        recommendation: `Before posting fewer ${f('format')}, change one thing (the hook, the length or the time) on half of them for four weeks.`,
        expectedImpact: `Shows whether ${f('format')} can get back to the usual engagement, or should take a smaller share. ${association}`,
        accountIds: signal.accountIds,
        experiment: experiment({
          hypothesis: `A different hook, length or time is associated with better engagement on ${f('format')}.`,
          variant: `Half of the ${f('format')} change one thing.`,
          control: `The other ${f('format')}, made as usual.`,
          accountIds: signal.accountIds,
        }),
      };
    case 'competitor_format': {
      const own = ids(f('ownAccountIds'));
      if (!own.length) return null;
      return {
        ...base,
        title: `Test ${f('format')} on ${f('platform')}`,
        recommendation: `Competitors post more ${f('format')} and they do well for them. Try a few on your ${f('platform')} profiles for four weeks and compare them with your usual.`,
        expectedImpact: `Shows whether ${f('format')} work for your audience too. Competitors' results don't carry over by themselves.`,
        accountIds: own,
        experiment: experiment({
          hypothesis: `${cap(f('format'))} are associated with higher engagement on your profiles, as for competitors.`,
          variant: `One or two ${f('format')} a week.`,
          control: 'Your usual posts in the same weeks.',
          accountIds: own,
        }),
      };
    }
    case 'topic_gap':
      return {
        ...base,
        title: `Try a post on ${f('tag')}`,
        recommendation: `If it fits your strategy, plan one or two posts on this topic and compare them with your usual.`,
        expectedImpact: `Shows whether the topic interests your audience as it does competitors'. ${association}`,
        accountIds: [],
        experiment: experiment({
          hypothesis: `Posts on ${f('tag')} are associated with higher engagement than usual on your profiles.`,
          variant: `One or two posts on ${f('tag')}.`,
          control: 'Your usual posts in the same weeks.',
          accountIds: [],
        }),
      };
    case 'standout_post': {
      const others = ids(f('otherAccountIds'));
      if (!others.length) return null;
      return {
        ...base,
        title: `Try the idea behind ${f('profile')}'s ${f('format')} on other profiles`,
        recommendation: `Adapt the post's idea for your other ${f('platform')} profiles and compare each with its usual.`,
        expectedImpact: `Shows whether the idea travels to other markets. One post is a single data point, so confidence is low.`,
        accountIds: others,
        experiment: experiment({
          hypothesis: `The idea behind this post is associated with higher engagement in other markets too.`,
          variant: 'An adapted version on each profile.',
          control: "Each profile's usual posts in the same weeks.",
          accountIds: others,
        }),
      };
    }
    case 'pillar_gap':
      return {
        ...base,
        title: `Plan ${f('missing')} more ${f('pillar')} ${Number(signal.facts.missing) === 1 ? 'item' : 'items'} for ${f('strategy')}`,
        recommendation: `Add ${f('pillar')} content to the calendar to bring it closer to the target the strategy sets.`,
        expectedImpact: `Brings ${f('pillar')} to its target share of the plan.`,
        confidence: 'medium',
        confidenceBasis: `Based on ${signal.stats.n} items against your own target. It's about the plan, not about how the pillar performs.`,
        accountIds: [],
        experiment: null,
      };
    case 'growth_change':
    case 'frequency_change':
      return null;
  }
}
