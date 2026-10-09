import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanup, createOrg, createUser, type TestUser } from '../support/supabase';

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let otherOrgId: string;
let itemId: string;
let firstVersionId: string;

const asset = (versionId: string, name = 'cover.png') => ({
  organization_id: orgId,
  content_item_id: itemId,
  content_version_id: versionId,
  storage_path: `org/${orgId}/content/${itemId}/abc-${name}`,
  file_name: name,
  mime_type: 'image/png',
  bytes: 1200,
});

beforeAll(async () => {
  owner = await createUser('content-owner');
  editor = await createUser('content-editor');
  viewer = await createUser('content-viewer');
  outsider = await createUser('content-outsider');
  orgId = (await createOrg(owner, 'Content Org')).id;
  otherOrgId = (await createOrg(outsider, 'Other Content Org')).id;
  await addMember(orgId, editor, 'EDITOR');
  await addMember(orgId, viewer, 'VIEWER');
});

afterAll(cleanup);

describe('content items', () => {
  it('are created by editors with a first version', async () => {
    const { data, error } = await editor.client
      .from('content_items')
      .insert({
        organization_id: orgId,
        title: 'Autumn feeding tips',
        status: 'IDEA',
        platform_keys: ['instagram', 'youtube'],
        planned_publish_at: '2026-10-20T07:00:00Z',
      })
      .select('id, current_version_id, created_by')
      .single();
    expect(error).toBeNull();
    itemId = data!.id;
    expect(data!.created_by).toBe(editor.id);
    const { data: versions } = await editor.client
      .from('content_versions')
      .select('id, version_number')
      .eq('content_item_id', itemId);
    expect(versions).toHaveLength(1);
    expect(versions![0]!.version_number).toBe(1);
    firstVersionId = versions![0]!.id;
    // The current version is set by the database, after the insert returned.
    const { data: item } = await editor.client
      .from('content_items')
      .select('current_version_id')
      .eq('id', itemId)
      .single();
    expect(item!.current_version_id).toBe(firstVersionId);
  });

  it('are read-only for viewers and invisible to other organizations', async () => {
    const { error } = await viewer.client
      .from('content_items')
      .insert({ organization_id: orgId, title: 'Viewer idea' });
    expect(error).not.toBeNull();
    const { data: updated } = await viewer.client
      .from('content_items')
      .update({ title: 'Changed by viewer' })
      .eq('id', itemId)
      .select('id');
    expect(updated).toEqual([]);
    const { data: seen } = await outsider.client
      .from('content_items')
      .select('id')
      .eq('id', itemId);
    expect(seen).toEqual([]);
    const { error: crossOrg } = await outsider.client
      .from('content_items')
      .insert({ organization_id: orgId, title: 'Sneaky' });
    expect(crossOrg).not.toBeNull();
  });

  it('only accept known platforms and owners who are members', async () => {
    const { error: platform } = await editor.client
      .from('content_items')
      .update({ platform_keys: ['myspace'] })
      .eq('id', itemId);
    expect(platform?.message).toMatch(/Unknown platform/);
    const { error: owner_ } = await editor.client
      .from('content_items')
      .update({ owner_user_id: outsider.id })
      .eq('id', itemId);
    expect(owner_?.message).toMatch(/member/);
  });

  it('move between idea and draft, and can be archived and restored, but not approved yet', async () => {
    const move = (status: 'DRAFT' | 'IDEA' | 'ARCHIVED' | 'APPROVED') =>
      editor.client.from('content_items').update({ status }).eq('id', itemId);
    expect((await move('DRAFT')).error).toBeNull();
    expect((await move('APPROVED')).error?.message).toMatch(/can't move from DRAFT to APPROVED/);
    expect((await move('ARCHIVED')).error).toBeNull();
    expect((await move('IDEA')).error).not.toBeNull();
    expect((await move('DRAFT')).error).toBeNull();
    const { error } = await editor.client
      .from('content_items')
      .insert({ organization_id: orgId, title: 'Straight to published', status: 'PUBLISHED' });
    expect(error).not.toBeNull();
  });

  it('can never be deleted, only archived', async () => {
    await owner.client.from('content_items').delete().eq('id', itemId);
    const { count } = await owner.client
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .eq('id', itemId);
    expect(count).toBe(1);
  });
});

describe('versions and assets', () => {
  it('lets editors change the current version and add files to it', async () => {
    const { error } = await editor.client
      .from('content_versions')
      .update({ caption: 'Feed little and often #hydro', hashtags: ['hydro'] })
      .eq('id', firstVersionId);
    expect(error).toBeNull();
    const { error: assetError } = await editor.client
      .from('content_assets')
      .insert(asset(firstVersionId));
    expect(assetError).toBeNull();
  });

  it('refuses files stored outside the item’s folder', async () => {
    const { error } = await editor.client.from('content_assets').insert({
      ...asset(firstVersionId),
      storage_path: `org/${otherOrgId}/content/${itemId}/x.png`,
    });
    expect(error).not.toBeNull();
  });

  it('keeps earlier versions unchanged when a new version starts', async () => {
    const { data: newId, error } = await editor.client.rpc('create_content_version', {
      item_id: itemId,
    });
    expect(error).toBeNull();
    const { data: second } = await editor.client
      .from('content_versions')
      .select('version_number, caption, content_assets(file_name)')
      .eq('id', newId!)
      .single();
    expect(second).toMatchObject({
      version_number: 2,
      caption: 'Feed little and often #hydro',
      content_assets: [{ file_name: 'cover.png' }],
    });

    const { error: oldEdit } = await editor.client
      .from('content_versions')
      .update({ caption: 'Rewriting history' })
      .eq('id', firstVersionId);
    expect(oldEdit?.message).toMatch(/Only the current version/);
    const { error: oldAsset } = await editor.client
      .from('content_assets')
      .insert(asset(firstVersionId, 'late.png'));
    expect(oldAsset?.message).toMatch(/current version/);
  });

  it('never lets anyone add versions directly or start one for another organization', async () => {
    const { error } = await editor.client.from('content_versions').insert({
      organization_id: orgId,
      content_item_id: itemId,
      version_number: 9,
    });
    expect(error).not.toBeNull();
    const { error: rpc } = await outsider.client.rpc('create_content_version', { item_id: itemId });
    expect(rpc).not.toBeNull();
    const { error: viewerRpc } = await viewer.client.rpc('create_content_version', {
      item_id: itemId,
    });
    expect(viewerRpc).not.toBeNull();
  });

  it('hides files from other organizations', async () => {
    const { data } = await outsider.client
      .from('content_assets')
      .select('id')
      .eq('content_item_id', itemId);
    expect(data).toEqual([]);
  });
});
