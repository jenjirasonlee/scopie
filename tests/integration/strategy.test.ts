import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  type TestUser,
} from '../support/supabase';

let owner: TestUser;
let manager: TestUser;
let editor: TestUser;
let outsider: TestUser;
let orgId: string;
let otherOrgId: string;
let strategyId: string;
let pillarA: string;
let pillarB: string;

beforeAll(async () => {
  owner = await createUser('strategy-owner');
  manager = await createUser('strategy-manager');
  editor = await createUser('strategy-editor');
  outsider = await createUser('strategy-outsider');
  orgId = (await createOrg(owner, 'Strategy Org')).id;
  otherOrgId = (await createOrg(outsider, 'Other Strategy Org')).id;
  await addMember(orgId, manager, 'MANAGER');
  await addMember(orgId, editor, 'EDITOR');
  const { data, error } = await owner.client
    .from('content_pillars')
    .insert([
      { organization_id: orgId, name: 'Grow knowledge' },
      { organization_id: orgId, name: 'Product stories' },
    ])
    .select('id, name')
    .order('name');
  if (error) throw error;
  pillarA = data![0]!.id;
  pillarB = data![1]!.id;
});

afterAll(cleanup);

describe('strategies', () => {
  it('are written by managers and up, and read by every member', async () => {
    const { data, error } = await manager.client
      .from('strategies')
      .insert({
        organization_id: orgId,
        name: '  Autumn in the Netherlands ',
        period_start: '2026-10-01',
        period_end: '2026-12-31',
        country_codes: ['nl', 'NL', 'BE'],
        platform_keys: ['instagram'],
        priorities: ['Grow Reels', ' ', 'More grower stories'],
      })
      .select('id, name, country_codes, priorities, created_by')
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      name: 'Autumn in the Netherlands',
      country_codes: ['BE', 'NL'],
      priorities: ['Grow Reels', 'More grower stories'],
      created_by: manager.id,
    });
    strategyId = data!.id;

    const byEditor = await editor.client.from('strategies').insert({
      organization_id: orgId,
      name: 'Editor plan',
      period_start: '2026-10-01',
      period_end: '2026-10-31',
    });
    expect(byEditor.error).not.toBeNull();
    const { data: seen } = await editor.client.from('strategies').select('id').eq('id', strategyId);
    expect(seen).toHaveLength(1);
    const { data: hidden } = await outsider.client
      .from('strategies')
      .select('id')
      .eq('id', strategyId);
    expect(hidden).toEqual([]);
  });

  it('check periods, countries and platforms', async () => {
    const backwards = await manager.client.from('strategies').insert({
      organization_id: orgId,
      name: 'Backwards',
      period_start: '2026-12-01',
      period_end: '2026-11-01',
    });
    expect(backwards.error).not.toBeNull();
    const country = await manager.client
      .from('strategies')
      .update({ country_codes: ['XX'] })
      .eq('id', strategyId);
    expect(country.error?.message).toMatch(/Unknown country/);
    const platform = await manager.client
      .from('strategies')
      .update({ platform_keys: ['myspace'] })
      .eq('id', strategyId);
    expect(platform.error?.message).toMatch(/Unknown platform/);
  });

  it('keep pillar targets at or under 100% in total', async () => {
    const ok = await manager.client.from('strategy_pillars').insert([
      { organization_id: orgId, strategy_id: strategyId, pillar_id: pillarA, target_share: 60 },
      { organization_id: orgId, strategy_id: strategyId, pillar_id: pillarB, target_share: 40 },
    ]);
    expect(ok.error).toBeNull();
    const over = await manager.client
      .from('strategy_pillars')
      .update({ target_share: 70 })
      .eq('strategy_id', strategyId)
      .eq('pillar_id', pillarA)
      .select();
    expect(over.error?.message).toMatch(/more than 100/);
  });

  it('only take objectives with a target unless tracked by hand', async () => {
    const missing = await manager.client.from('strategy_objectives').insert({
      organization_id: orgId,
      strategy_id: strategyId,
      name: 'Publish more',
      kpi: 'published_content',
    });
    expect(missing.error).not.toBeNull();
    const { data, error } = await manager.client
      .from('strategy_objectives')
      .insert({
        organization_id: orgId,
        strategy_id: strategyId,
        name: 'Publish 24 pieces',
        kpi: 'published_content',
        target_value: 24,
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    // Editors link content to an objective of their own organization only.
    const { data: item } = await editor.client
      .from('content_items')
      .insert({ organization_id: orgId, title: 'Autumn tips', strategy_objective_id: data!.id })
      .select('id')
      .single();
    expect(item).not.toBeNull();
    const { data: foreign } = await adminClient()
      .from('strategies')
      .insert({
        organization_id: otherOrgId,
        name: 'Theirs',
        period_start: '2026-10-01',
        period_end: '2026-10-31',
      })
      .select('id')
      .single();
    const { data: foreignObjective } = await adminClient()
      .from('strategy_objectives')
      .insert({ organization_id: otherOrgId, strategy_id: foreign!.id, name: 'Theirs' })
      .select('id')
      .single();
    const cross = await editor.client
      .from('content_items')
      .update({ strategy_objective_id: foreignObjective!.id })
      .eq('id', item!.id);
    expect(cross.error).not.toBeNull();
  });

  it('only list competitor profiles as competitors', async () => {
    const admin = adminClient();
    const { data: accounts, error } = await admin
      .from('social_accounts')
      .insert([
        {
          organization_id: orgId,
          platform_key: 'instagram',
          handle: 'rival_strategy',
          display_name: 'Rival',
          business_role: 'competitor',
        },
        {
          organization_id: orgId,
          platform_key: 'instagram',
          handle: 'own_strategy',
          display_name: 'Own',
          business_role: 'owned',
        },
      ])
      .select('id, business_role, handle')
      .order('handle');
    expect(error).toBeNull();
    const own = accounts!.find((a) => a.business_role === 'owned')!;
    const rival = accounts!.find((a) => a.business_role === 'competitor')!;
    const okRival = await manager.client
      .from('strategy_competitors')
      .insert({ organization_id: orgId, strategy_id: strategyId, social_account_id: rival.id });
    expect(okRival.error).toBeNull();
    const notRival = await manager.client
      .from('strategy_competitors')
      .insert({ organization_id: orgId, strategy_id: strategyId, social_account_id: own.id });
    expect(notRival.error?.message).toMatch(/competitors/);
  });
});
