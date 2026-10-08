import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  cleanup,
  createOrg,
  createUser,
  type Client,
  type TestUser,
} from '../support/supabase';

const TABLES = [
  'content_pillars',
  'content_formats',
  'campaigns',
  'audiences',
  'cta_types',
] as const;
type Table = (typeof TABLES)[number];

let owner: TestUser;
let manager: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;

// The five tables share their columns, so one typed builder covers them all.
const from = (client: Client, table: Table) => client.from(table as 'content_formats');

beforeAll(async () => {
  owner = await createUser('taxonomy-owner');
  manager = await createUser('taxonomy-manager');
  editor = await createUser('taxonomy-editor');
  viewer = await createUser('taxonomy-viewer');
  outsider = await createUser('taxonomy-outsider');
  orgId = (await createOrg(owner, 'Taxonomy Org')).id;
  await addMember(orgId, manager, 'MANAGER');
  await addMember(orgId, editor, 'EDITOR');
  await addMember(orgId, viewer, 'VIEWER');
  await createOrg(outsider, 'Other Org');
});

afterAll(cleanup);

describe.each(TABLES)('%s', (table) => {
  let itemId: string;

  it('can be created, edited and deactivated by a manager', async () => {
    const { data, error } = await from(manager.client, table)
      .insert({ organization_id: orgId, name: `Main ${table}`, description: 'First' })
      .select('id')
      .single();
    expect(error).toBeNull();
    itemId = data!.id;

    const edited = await from(manager.client, table)
      .update({ name: `Renamed ${table}`, description: 'Second' })
      .eq('id', itemId)
      .select('name, description')
      .single();
    expect(edited.error).toBeNull();
    expect(edited.data).toEqual({ name: `Renamed ${table}`, description: 'Second' });

    const deactivated = await from(manager.client, table)
      .update({ is_active: false })
      .eq('id', itemId)
      .select('is_active')
      .single();
    expect(deactivated.error).toBeNull();
    expect(deactivated.data?.is_active).toBe(false);
  });

  it('refuses a duplicate name in a different case', async () => {
    const { error } = await from(manager.client, table).insert({
      organization_id: orgId,
      name: `Renamed ${table}`.toUpperCase(),
    });
    expect(error?.code).toBe('23505');
  });

  it('is read-only for editors and viewers', async () => {
    for (const user of [editor, viewer]) {
      const insert = await from(user.client, table).insert({
        organization_id: orgId,
        name: `By ${user.email}`,
      });
      expect(insert.error).not.toBeNull();
      const update = await from(user.client, table)
        .update({ name: 'Hijacked' })
        .eq('id', itemId)
        .select('id');
      expect(update.data ?? []).toHaveLength(0);
      const read = await from(user.client, table).select('name').eq('id', itemId).single();
      expect(read.data?.name).toBe(`Renamed ${table}`);
    }
  });

  it('cannot be deleted, even by the owner', async () => {
    const { error } = await from(owner.client, table).delete().eq('id', itemId);
    expect(error).not.toBeNull();
    const { data } = await from(owner.client, table).select('id').eq('id', itemId);
    expect(data).toHaveLength(1);
  });

  it('is invisible to other organizations', async () => {
    const { data, error } = await from(outsider.client, table)
      .select('id')
      .eq('organization_id', orgId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('taxonomy extras', () => {
  it('keeps pillar colours to the palette', async () => {
    const ok = await manager.client
      .from('content_pillars')
      .insert({ organization_id: orgId, name: 'Teal pillar', color: 'teal' });
    expect(ok.error).toBeNull();
    const bad = await manager.client
      .from('content_pillars')
      .insert({ organization_id: orgId, name: 'Magenta pillar', color: 'magenta' });
    expect(bad.error?.code).toBe('23514');
  });

  it('refuses a campaign that ends before it starts', async () => {
    const { error } = await manager.client.from('campaigns').insert({
      organization_id: orgId,
      name: 'Backwards',
      starts_on: '2026-03-10',
      ends_on: '2026-03-01',
    });
    expect(error?.code).toBe('23514');
  });
});
