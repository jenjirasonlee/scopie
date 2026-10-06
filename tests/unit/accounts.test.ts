import { describe, expect, it } from 'vitest';
import { parseAccountFilters } from '@/lib/accounts/filters';
import { groupByCountry } from '@/lib/accounts/grouping';
import { summarizeAccounts } from '@/lib/accounts/queries';

describe('account grouping', () => {
  it('groups by country name and puts accounts without a country last', () => {
    const names = new Map([
      ['DE', 'Germany'],
      ['ES', 'Spain'],
    ]);
    const groups = groupByCountry(
      [
        { id: 1, country_code: 'ES' },
        { id: 2, country_code: null },
        { id: 3, country_code: 'DE' },
        { id: 4, country_code: 'ES' },
      ],
      names,
    );
    expect(groups.map((group) => group.label)).toEqual(['Germany', 'Spain', 'No country']);
    expect(groups[1]!.accounts.map((account) => account.id)).toEqual([1, 4]);
  });
});

describe('account summary', () => {
  it('counts accounts by status, country, platform and connection', () => {
    const summary = summarizeAccounts([
      {
        country_code: 'DE',
        platform_key: 'instagram',
        is_active: true,
        connection_status: 'not_connected',
        primary_data_source: 'manual',
      },
      {
        country_code: 'DE',
        platform_key: 'facebook',
        is_active: false,
        connection_status: 'not_connected',
        primary_data_source: 'manual',
      },
      {
        country_code: 'ES',
        platform_key: 'instagram',
        is_active: true,
        connection_status: 'demo',
        primary_data_source: 'demo',
      },
    ]);
    expect(summary).toMatchObject({ total: 3, active: 2, inactive: 1, demoCount: 1 });
    expect(summary.byCountry).toEqual([
      { code: 'DE', count: 2 },
      { code: 'ES', count: 1 },
    ]);
    expect(summary.byPlatform[0]).toEqual({ key: 'instagram', count: 2 });
    expect(summary.byConnection).toEqual({ not_connected: 2, demo: 1 });
  });

  it('handles an empty organization', () => {
    expect(summarizeAccounts([])).toMatchObject({
      total: 0,
      active: 0,
      byCountry: [],
      byPlatform: [],
    });
  });
});

describe('account filters', () => {
  it('falls back to safe defaults for unknown values', () => {
    expect(parseAccountFilters({ status: 'weird', group: 'nope', country: 'Germany' })).toEqual({
      q: undefined,
      platform: undefined,
      country: undefined,
      status: 'active',
      group: 'country',
    });
  });

  it('reads valid filters', () => {
    expect(
      parseAccountFilters({ q: ' canna ', country: 'de', status: 'all', group: 'none' }),
    ).toMatchObject({
      q: 'canna',
      country: 'DE',
      status: 'all',
      group: 'none',
    });
  });
});
