import { z } from 'zod';
import type { LlmProvider, ProviderUsage } from './providers/types';
import { checkFields } from './validate';
import type {
  InsightDraft,
  InsightSeverity,
  RecommendationConfidence,
  RecommendationDraft,
  Signal,
} from './types';

// The model writer. The model gets the signals Scopie found (allow-listed fields only, no
// captions, ids of profiles or links) and the texts Scopie's rules wrote, and may reword
// them, pick the most useful insights and order them, and lower a recommendation's
// confidence. It can't add signals, change numbers or raise confidence: every item is
// checked (validate.ts) and anything that fails keeps Scopie's own text.

export const PROMPT_VERSION = 'insights-v1';
export const MAX_INSIGHTS = 10;

const SYSTEM = `You are the analyst in Scopie, a social media analytics tool for a marketing team.
You get signals that Scopie computed from stored data, with their evidence, and draft texts.
Rewrite the drafts so a busy marketer understands them at a glance: plain words, short sentences, no jargon.
Rules:
- Use only numbers that appear in the evidence of the signal you write about, written the same way.
- Describe associations, never causes. Don't write "because", "due to", "caused", "led to", "drives" or similar.
- Don't promise results. Don't invent facts, names, topics or numbers.
- Pick the ${MAX_INSIGHTS} most useful insights at most and order them by importance.
- Keep every recommendation you are given; you may set lowerConfidence when the evidence looks thin.
- Titles under 90 characters, bodies under 400.`;

/** Fields that may reach the model. Ids, links and internal keys are dropped. */
const ALLOWED_FACTS = new Set([
  'profile',
  'role',
  'direction',
  'format',
  'platform',
  'tag',
  'competitors',
  'pillar',
  'strategy',
  'missing',
]);

export function modelInput(
  signals: readonly Signal[],
  insights: readonly InsightDraft[],
  recommendations: readonly RecommendationDraft[],
) {
  return {
    signals: signals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      severity: signal.severity,
      facts: Object.fromEntries(
        Object.entries(signal.facts).filter(([key]) => ALLOWED_FACTS.has(key)),
      ),
      evidence: signal.evidence.map((e) => ({
        label: e.label,
        value: e.display,
        ...(e.n === undefined ? {} : { sampleSize: e.n }),
      })),
      draft: insights.find((i) => i.signalIds[0] === signal.id)
        ? {
            title: insights.find((i) => i.signalIds[0] === signal.id)!.title,
            body: insights.find((i) => i.signalIds[0] === signal.id)!.body,
          }
        : null,
    })),
    recommendations: recommendations.map((r) => ({
      signalId: r.insightSignalId,
      title: r.title,
      observation: r.observation,
      recommendation: r.recommendation,
      expectedImpact: r.expectedImpact,
      confidence: r.confidence,
      confidenceBasis: r.confidenceBasis,
    })),
  };
}

const text = { type: 'string' } as const;
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights', 'recommendations'],
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['signalId', 'title', 'body', 'severity'],
        properties: {
          signalId: text,
          title: text,
          body: text,
          severity: { type: 'string', enum: ['info', 'notable', 'important'] },
        },
      },
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'signalId',
          'title',
          'observation',
          'recommendation',
          'expectedImpact',
          'lowerConfidence',
        ],
        properties: {
          signalId: text,
          title: text,
          observation: text,
          recommendation: text,
          expectedImpact: text,
          lowerConfidence: { type: 'boolean' },
        },
      },
    },
  },
} as const;

const outputSchema = z.object({
  insights: z.array(
    z.object({
      signalId: z.string(),
      title: z.string(),
      body: z.string(),
      severity: z.enum(['info', 'notable', 'important']),
    }),
  ),
  recommendations: z.array(
    z.object({
      signalId: z.string(),
      title: z.string(),
      observation: z.string(),
      recommendation: z.string(),
      expectedImpact: z.string(),
      lowerConfidence: z.boolean(),
    }),
  ),
});

export type Rejection = { what: string; reason: string };

export type ModelWriteResult = {
  insights: InsightDraft[];
  recommendations: RecommendationDraft[];
  rejected: Rejection[];
  generation: {
    input: unknown;
    output: unknown;
    error: string | null;
    usage: ProviderUsage;
    durationMs: number;
  };
};

/** A model can make Scopie one step less sure, never more sure. */
const STEP_DOWN: Record<RecommendationConfidence, RecommendationConfidence> = {
  high: 'medium',
  medium: 'low',
  low: 'low',
};

const LOWER: Record<InsightSeverity, number> = { info: 0, notable: 1, important: 2 };

/**
 * Lets the model reword Scopie's drafts. Never throws for a bad answer: whatever fails the
 * checks keeps the rules text and is listed in `rejected`; a failed call keeps everything.
 */
export async function writeWithModel(input: {
  provider: LlmProvider;
  model: string;
  signals: readonly Signal[];
  insights: readonly InsightDraft[];
  recommendations: readonly RecommendationDraft[];
}): Promise<ModelWriteResult> {
  const payload = modelInput(input.signals, input.insights, input.recommendations);
  const started = Date.now();
  const bySignal = new Map(input.signals.map((s) => [s.id, s]));
  let raw: unknown = null;
  let usage: ProviderUsage = { inputTokens: null, outputTokens: null };
  const fallback = (error: string): ModelWriteResult => ({
    insights: input.insights.slice(0, MAX_INSIGHTS),
    recommendations: [...input.recommendations],
    rejected: [{ what: 'The whole answer', reason: error }],
    generation: { input: payload, output: raw, error, usage, durationMs: Date.now() - started },
  });

  try {
    const answer = await input.provider.generateStructured({
      model: input.model,
      system: SYSTEM,
      user: JSON.stringify(payload),
      schemaName: 'scopie_insights',
      schema: OUTPUT_SCHEMA,
    });
    raw = answer.output;
    usage = answer.usage;
  } catch (error) {
    return fallback(error instanceof Error ? error.message : 'The model call failed.');
  }
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) return fallback("The answer didn't have the expected shape.");

  const rejected: Rejection[] = [];
  const insights: InsightDraft[] = [];
  const seen = new Set<string>();
  for (const item of parsed.data.insights) {
    const signal = bySignal.get(item.signalId);
    const draft = input.insights.find((i) => i.signalIds[0] === item.signalId);
    if (!signal || !draft) {
      rejected.push({
        what: `Insight “${item.title.slice(0, 80)}”`,
        reason: 'cites no known signal',
      });
      continue;
    }
    if (seen.has(signal.id) || insights.length >= MAX_INSIGHTS) continue;
    seen.add(signal.id);
    const check = checkFields(
      [
        { name: 'The title', text: item.title, maxLength: 120 },
        { name: 'The text', text: item.body, maxLength: 600 },
      ],
      [signal],
    );
    if (!check.ok) {
      rejected.push({ what: `Insight “${item.title.slice(0, 80)}”`, reason: check.reason });
      insights.push(draft);
      continue;
    }
    insights.push({
      ...draft,
      title: item.title.trim(),
      body: item.body.trim(),
      // The model may make an insight look less important, never more.
      severity: LOWER[item.severity] <= LOWER[draft.severity] ? item.severity : draft.severity,
    });
  }
  // An empty pick means the model didn't choose; keep Scopie's order.
  if (!insights.length) insights.push(...input.insights.slice(0, MAX_INSIGHTS));

  const recommendations = input.recommendations.map((draft) => {
    const item = parsed.data.recommendations.find((r) => r.signalId === draft.insightSignalId);
    if (!item) return draft;
    const signal = bySignal.get(draft.insightSignalId)!;
    const check = checkFields(
      [
        { name: 'The title', text: item.title, maxLength: 120 },
        { name: 'The observation', text: item.observation, maxLength: 600 },
        { name: 'The recommendation', text: item.recommendation, maxLength: 600 },
        { name: 'The expected impact', text: item.expectedImpact, maxLength: 400 },
      ],
      [signal],
    );
    if (!check.ok) {
      rejected.push({ what: `Recommendation “${item.title.slice(0, 80)}”`, reason: check.reason });
      return draft;
    }
    return {
      ...draft,
      title: item.title.trim(),
      observation: item.observation.trim(),
      recommendation: item.recommendation.trim(),
      expectedImpact: item.expectedImpact.trim(),
      confidence: item.lowerConfidence ? STEP_DOWN[draft.confidence] : draft.confidence,
    };
  });

  return {
    insights,
    recommendations,
    rejected,
    generation: {
      input: payload,
      output: raw,
      error: null,
      usage,
      durationMs: Date.now() - started,
    },
  };
}
