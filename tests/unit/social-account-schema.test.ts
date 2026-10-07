import { describe, expect, it } from 'vitest';
import { socialAccountSchema, toSocialAccountRow } from '@/schemas/social-account';

const valid = {
  platformKey: 'instagram',
  displayName: 'CANNA Germany',
  handle: '@canna_de',
  externalId: '',
  accountType: 'business',
  countryCode: 'de',
  language: 'de',
  timezone: 'Europe/Berlin',
  ownerUserId: '',
  notes: '',
};

describe('social account validation', () => {
  it('normalizes a valid account', () => {
    const result = socialAccountSchema.parse(valid);
    expect(result).toMatchObject({
      handle: 'canna_de',
      countryCode: 'DE',
      externalId: null,
      ownerUserId: null,
      notes: null,
      isCompetitor: false,
    });
  });

  it('treats a checked competitor box as true', () => {
    expect(socialAccountSchema.parse({ ...valid, isCompetitor: 'on' }).isCompetitor).toBe(true);
  });

  it('requires a platform and an account name', () => {
    const result = socialAccountSchema.safeParse({ ...valid, platformKey: '', displayName: '  ' });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['platformKey', 'displayName']));
  });

  it('rejects invalid language, country, timezone and owner values', () => {
    for (const patch of [
      { language: 'German' },
      { countryCode: 'Germany' },
      { timezone: 'Mars/Olympus' },
      { ownerUserId: 'not-a-uuid' },
      { accountType: 'robot' },
    ]) {
      expect(socialAccountSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });

  it('never maps connection or sync fields from user input', () => {
    const parsed = socialAccountSchema.parse({
      ...valid,
      connection_status: 'connected',
      connectionStatus: 'connected',
      primary_data_source: 'authenticated',
      last_successful_sync_at: '2026-01-01',
    });
    const row = toSocialAccountRow(parsed);
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining([
        'connection_status',
        'primary_data_source',
        'last_successful_sync_at',
      ]),
    );
    expect(row).not.toHaveProperty('connection_status');
    expect(row).not.toHaveProperty('primary_data_source');
    expect(row).not.toHaveProperty('last_successful_sync_at');
  });
});

describe('social account validation of missing fields', () => {
  it('asks to choose a platform when the field is missing entirely', () => {
    const withoutPlatform: Partial<typeof valid> = { ...valid };
    delete withoutPlatform.platformKey;
    const result = socialAccountSchema.safeParse(withoutPlatform);
    expect(result.error?.issues.find((issue) => issue.path[0] === 'platformKey')?.message).toBe(
      'Choose a platform',
    );
  });
});
