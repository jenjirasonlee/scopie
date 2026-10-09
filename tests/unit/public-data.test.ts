import { describe, expect, it } from 'vitest';
import { coverageLine } from '@/components/pipeline/account-data-panels';
import type { SocialAccount } from '@/lib/accounts/queries';
import {
  PUBLIC_DATA_UNAVAILABLE_REASONS,
  parseHandleList,
  publicDataUnavailableReason,
  publicPlatform,
} from '@/lib/public-data/shared';
import { parseServerEnv, publicApiCredential, readyApiKeyPlatforms } from '@/lib/server-env';

describe('handle lists for bulk add', () => {
  it('reads usernames, profile links and optional country codes', () => {
    const { handles, invalid } = parseHandleList(
      'username,country\n@Hydro_Rival,nl\nhttps://www.instagram.com/growco.example/\nbad handle!\n\nhydro_rival,DE',
    );
    expect(handles).toEqual([
      { handle: 'hydro_rival', countryCode: 'NL' },
      { handle: 'growco.example', countryCode: null },
    ]);
    expect(invalid).toEqual(['bad handle!']);
  });

  it('ignores a country column that is not a two-letter code', () => {
    expect(parseHandleList('brand;Netherlands').handles).toEqual([
      { handle: 'brand', countryCode: null },
    ]);
  });
});

describe('coverage line', () => {
  const account = (fields: Partial<SocialAccount>) =>
    ({
      access_type: 'public',
      first_observed_at: null,
      earliest_post_at: null,
      ...fields,
    }) as SocialAccount;

  it('says when nothing was observed yet', () => {
    expect(coverageLine(account({}), null)).toMatch(/Not observed yet/);
  });

  it('states both how long it was observed and how far back posts are complete', () => {
    expect(
      coverageLine(
        account({
          first_observed_at: '2026-10-07T06:00:00Z',
          earliest_post_at: '2025-03-03T10:00:00Z',
        }),
        '2025-03-03T10:00:00Z',
      ),
    ).toBe('Observed since 07/10/2026; posts complete back to 03/03/2025.');
  });

  it('never presents demo data as observed', () => {
    expect(coverageLine(account({ access_type: 'demo' }), null)).toMatch(/^DEMO DATA/);
  });
});

describe('public platforms', () => {
  it('reads the platform from a form, falling back to Instagram', () => {
    expect(publicPlatform('x')).toBe('x');
    expect(publicPlatform('bluesky')).toBe('bluesky');
    expect(publicPlatform('tiktok')).toBe('instagram');
  });

  it('knows which server key each platform needs; Bluesky needs none', () => {
    const none = parseServerEnv({});
    expect(publicApiCredential(none, 'x')).toBeNull();
    expect(publicApiCredential(none, 'bluesky')).toBe('');
    expect(readyApiKeyPlatforms(none)).toEqual(['bluesky']);
    const keyed = parseServerEnv({
      X_BEARER_TOKEN: 'AAAAAAAAAAAAAAAAAAAAAFixtureToken%2Fnot%3Dreal',
      YOUTUBE_API_KEY: 'AIzaFixtureKey000000000000000000000000',
    });
    expect(readyApiKeyPlatforms(keyed)).toEqual(['youtube', 'x', 'bluesky']);
  });

  it('gives a plain reason for every platform without public data', () => {
    for (const key of ['facebook', 'linkedin', 'threads', 'tiktok', 'pinterest', 'reddit']) {
      expect(PUBLIC_DATA_UNAVAILABLE_REASONS[key], key).toBeTruthy();
    }
    expect(publicDataUnavailableReason('reddit')).toMatch(/written approval/);
    expect(publicDataUnavailableReason('myspace')).toMatch(/no official way/);
  });
});
