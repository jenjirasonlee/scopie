import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, keyVersionOf } from '@/lib/crypto/tokens';
import { generateDemoAccount } from '@/lib/demo/generate';
import { checkMetricValue } from '@/lib/ingest/ingest';
import {
  applyTransform,
  comparabilityClass,
  getMetric,
  isStorableMetric,
  METRIC_DEFINITIONS,
  PLATFORM_METRIC_MAP,
} from '@/lib/metrics/registry';
import { backoffMinutes, isSnapshotDue, shiftDay } from '@/lib/sync/schedule';

const key = () => randomBytes(32).toString('base64');

describe('token encryption', () => {
  it('round-trips and never contains the plain token', () => {
    const secret = key();
    const sealed = encryptToken('EAAB-fixture-token', secret);
    expect(sealed).not.toContain('EAAB');
    expect(keyVersionOf(sealed)).toBe(1);
    expect(decryptToken(sealed, secret)).toBe('EAAB-fixture-token');
  });

  it('uses a fresh IV each time', () => {
    const secret = key();
    expect(encryptToken('same', secret)).not.toBe(encryptToken('same', secret));
  });

  it('fails on a tampered value or the wrong key', () => {
    const secret = key();
    const sealed = encryptToken('token', secret);
    const parts = sealed.split(':');
    const tampered = [...parts.slice(0, 3), Buffer.from('other!').toString('base64')].join(':');
    expect(() => decryptToken(tampered, secret)).toThrow();
    expect(() => decryptToken(sealed, key())).toThrow();
    expect(() => decryptToken('garbage', secret)).toThrow(/Malformed/);
    expect(() => encryptToken('x', Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('metric registry', () => {
  it('has unique keys and derived metrics built from known metrics', () => {
    const keys = METRIC_DEFINITIONS.map((metric) => metric.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const metric of METRIC_DEFINITIONS.filter((entry) => entry.isDerived)) {
      for (const input of metric.inputs)
        expect(getMetric(input), `${metric.key} → ${input}`).toBeDefined();
    }
  });

  it('never lets a derived metric be stored', () => {
    expect(isStorableMetric('engagement_rate_reach', 'post')).toBe(false);
    expect(isStorableMetric('follower_change', 'account')).toBe(false);
    expect(isStorableMetric('reach', 'post')).toBe(true);
    expect(isStorableMetric('followers', 'post')).toBe(false);
    expect(isStorableMetric('made_up', 'post')).toBe(false);
  });

  it('maps every platform metric to a storable Scopie metric', () => {
    for (const mapping of PLATFORM_METRIC_MAP) {
      expect(isStorableMetric(mapping.metricKey, mapping.scope), mapping.sourceMetric).toBe(true);
    }
  });

  it('keeps unmapped metrics comparable only within their platform', () => {
    expect(comparabilityClass('instagram', 'post', 'reach')).toBe(
      comparabilityClass('facebook', 'post', 'reach'),
    );
    expect(comparabilityClass('linkedin', 'post', 'impressions')).toBe('linkedin:impressions');
    expect(comparabilityClass('instagram', 'post', 'saves')).not.toBe(
      comparabilityClass('linkedin', 'post', 'saves'),
    );
  });

  it('converts milliseconds to seconds', () => {
    expect(applyTransform(12_500, 'ms_to_seconds')).toBe(12.5);
    expect(applyTransform(7, null)).toBe(7);
  });
});

describe('checkMetricValue', () => {
  const base = {
    metricKey: 'reach',
    value: 5,
    availability: 'available',
    period: 'lifetime',
    metricDate: null,
  };
  it('accepts a valid value and rejects mismatches', () => {
    expect(checkMetricValue(base, 'post')).toBeNull();
    expect(checkMetricValue({ ...base, value: null }, 'post')).toMatch(/without a value/);
    expect(checkMetricValue({ ...base, availability: 'not_permitted' }, 'post')).toMatch(
      /value was given/,
    );
    expect(
      checkMetricValue({ ...base, value: null, availability: 'not_permitted' }, 'post'),
    ).toBeNull();
    expect(checkMetricValue({ ...base, value: -1 }, 'post')).toMatch(/zero or more/);
    expect(checkMetricValue({ ...base, value: Infinity }, 'post')).toMatch(/zero or more/);
    expect(checkMetricValue({ ...base, metricKey: 'engagement_rate_reach' }, 'post')).toMatch(
      /not a stored/,
    );
    expect(checkMetricValue(base, 'account')).toMatch(/date/);
  });
});

describe('sync schedule', () => {
  it('takes snapshots when a post passes each capture age', () => {
    expect(isSnapshotDue(2, null)).toBe(true);
    expect(isSnapshotDue(25, 2)).toBe(true);
    expect(isSnapshotDue(30, 25)).toBe(false);
    expect(isSnapshotDue(24 * 7 + 1, 24 * 3 + 2)).toBe(true);
    expect(isSnapshotDue(24 * 100, 24 * 90 + 1)).toBe(false);
    expect(isSnapshotDue(-1, null)).toBe(false);
  });

  it('backs off exponentially up to a day', () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([15, 30, 60, 120]);
    expect(backoffMinutes(20)).toBe(1440);
  });

  it('shifts days across month ends', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('DEMO data generator', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  const demo = generateDemoAccount({ seed: 'canna_nl_demo', platformKey: 'instagram', now });

  it('is deterministic', () => {
    expect(generateDemoAccount({ seed: 'canna_nl_demo', platformKey: 'instagram', now })).toEqual(
      demo,
    );
  });

  it('labels every post as DEMO and never dates data in the future', () => {
    const posts = demo.captures.flatMap((capture) => capture.posts);
    expect(posts.length).toBeGreaterThan(5);
    for (const post of posts) {
      expect(post.caption).toMatch(/^DEMO post/);
      expect(post.externalId).toMatch(/^demo_/);
    }
    for (const capture of demo.captures) {
      expect(Date.parse(capture.capturedAt)).toBeLessThanOrEqual(now.getTime());
      for (const post of capture.posts)
        expect(Date.parse(post.publishedAt)).toBeLessThan(Date.parse(capture.capturedAt));
    }
    expect(demo.accountMetrics.every((metric) => metric.metricDate! < '2026-10-01')).toBe(true);
  });

  it('only produces values that pass the ingest checks', () => {
    for (const metric of demo.accountMetrics)
      expect(checkMetricValue(metric, 'account')).toBeNull();
    for (const metric of demo.captures.flatMap((capture) => capture.metrics)) {
      expect(checkMetricValue(metric, 'post')).toBeNull();
    }
  });
});
