import type { Signal } from './types';

// Checks on anything a model writes, before it is saved (AI_ARCHITECTURE.md §3): it cites
// only signals of this run, every number in it appears in the cited evidence, it stays
// short, and it doesn't claim causes. Anything that fails is replaced by Scopie's own text.

/** Phrases that claim a cause. Scopie's data shows associations only. */
const CAUSAL =
  /\b(caus(e|ed|es|ing)|because|due to|led to|leads to|lead to|result(ed|s)? in|drives?|drove|driven by|thanks to|guarantee[sd]?|will (increase|grow|boost|double))\b/i;

/** Numbers any text may use: durations and counts in the fixed wording. */
const ALWAYS_ALLOWED = [1, 2, 4, 7, 28];

const NUMBER = /[-+−]?\d[\d,]*(\.\d+)?/g;

function numbersIn(text: string): number[] {
  return [...text.matchAll(NUMBER)]
    .map((match) => Number(match[0].replace(/,/g, '').replace('−', '-')))
    .filter((value) => Number.isFinite(value));
}

/** Every number the cited signals justify: evidence values, displays, sample sizes, facts. */
export function allowedNumbers(signals: readonly Signal[]): number[] {
  const out = new Set<number>(ALWAYS_ALLOWED);
  for (const signal of signals) {
    for (const value of Object.values(signal.facts)) {
      if (typeof value === 'number') out.add(value);
      else numbersIn(value).forEach((n) => out.add(n));
    }
    for (const evidence of signal.evidence) {
      out.add(evidence.value);
      if (evidence.n !== undefined) out.add(evidence.n);
      numbersIn(evidence.display).forEach((n) => out.add(n));
      numbersIn(evidence.label).forEach((n) => out.add(n));
    }
  }
  return [...out];
}

function matches(value: number, allowed: readonly number[]): boolean {
  const size = Math.abs(value);
  return allowed.some((candidate) => {
    const abs = Math.abs(candidate);
    // Same number, the same number rounded, or a share written as a percentage.
    return [abs, abs * 100].some(
      (option) => Math.abs(option - size) <= Math.max(0.051, option * 0.005),
    );
  });
}

export type TextCheck = { ok: true } | { ok: false; reason: string };

export function checkText(
  text: string,
  input: { allowed: readonly number[]; maxLength: number },
): TextCheck {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length > input.maxLength) {
    return { ok: false, reason: `longer than ${input.maxLength} characters` };
  }
  const causal = trimmed.match(CAUSAL);
  if (causal) return { ok: false, reason: `claims a cause ("${causal[0]}")` };
  const unknown = numbersIn(trimmed).find((value) => !matches(value, input.allowed));
  if (unknown !== undefined) {
    return { ok: false, reason: `uses a number that isn't in the evidence (${unknown})` };
  }
  return { ok: true };
}

/** Checks several fields of one item; the first failure wins. */
export function checkFields(
  fields: readonly { name: string; text: string; maxLength: number }[],
  signals: readonly Signal[],
): TextCheck {
  const allowed = allowedNumbers(signals);
  for (const field of fields) {
    const result = checkText(field.text, { allowed, maxLength: field.maxLength });
    if (!result.ok) return { ok: false, reason: `${field.name} ${result.reason}` };
  }
  return { ok: true };
}
