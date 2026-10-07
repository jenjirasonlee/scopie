const INTEGER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const COMPACT = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return INTEGER.format(value);
}

export function formatCompact(value: number): string {
  return Math.abs(value) < 10_000 ? INTEGER.format(value) : COMPACT.format(value);
}

export function formatDecimal(value: number): string {
  return ONE_DECIMAL.format(value);
}

/** 0.0441 → "+4.4%" (always signed, one decimal). */
export function formatSignedPercent(rate: number): string {
  const percent = Math.round(rate * 1000) / 10;
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '±';
  return `${sign}${ONE_DECIMAL.format(Math.abs(percent))}%`;
}

/** 0.6 → "60%" */
export function formatShare(share: number): string {
  return `${INTEGER.format(share * 100)}%`;
}

/** 1200 → "+1,200" */
export function formatSignedCount(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${INTEGER.format(Math.abs(value))}`;
}
