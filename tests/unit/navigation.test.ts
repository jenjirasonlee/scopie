import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/lib/navigation';

describe('navigation', () => {
  it('has the twelve primary sections in order', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Dashboard',
      'Analytics',
      'Accounts',
      'Content',
      'Calendar',
      'Approvals',
      'Strategy',
      'Benchmarks',
      'Reports',
      'AI Insights',
      'Productivity',
      'Settings',
    ]);
  });

  it('has a page for every section', () => {
    for (const item of NAV_ITEMS) {
      expect(
        existsSync(join(process.cwd(), 'app/[orgSlug]', item.segment, 'page.tsx')),
        item.segment,
      ).toBe(true);
    }
  });

  it('states the roadmap phase of every unfinished module', () => {
    for (const item of NAV_ITEMS.filter((candidate) => candidate.status === 'planned')) {
      expect(item.phase, item.key).toBeGreaterThan(1);
      expect(item.planned?.length, item.key).toBeGreaterThan(0);
    }
  });
});
