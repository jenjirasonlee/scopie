/** Median of a list of numbers; null for an empty list (never zero). */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Mean of a list of numbers; null for an empty list (never zero). */
export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Relative change (b − a) / a, or null when a is zero or missing. */
export function relativeChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return (to - from) / from;
}
