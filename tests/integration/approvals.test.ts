import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanup, createOrg, createUser, type TestUser } from '../support/supabase';

let owner: TestUser;
let manager: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let itemId: string;

const status = async () =>
  (await editor.client.from('content_items').select('status').eq('id', itemId).single()).data!
    .status;
const notificationsOf = async (user: TestUser) =>
  (
    await user.client
      .from('notifications')
      .select('kind, content_item_id, excerpt, read_at')
      .eq('content_item_id', itemId)
      .order('created_at')
  ).data!;

beforeAll(async () => {
  owner = await createUser('approval-owner');
  manager = await createUser('approval-manager');
  editor = await createUser('approval-editor');
  viewer = await createUser('approval-viewer');
  outsider = await createUser('approval-outsider');
  orgId = (await createOrg(owner, 'Approval Org')).id;
  await addMember(orgId, manager, 'MANAGER');
  await addMember(orgId, editor, 'EDITOR');
  await addMember(orgId, viewer, 'VIEWER');

  const { data, error } = await editor.client
    .from('content_items')
    .insert({
      organization_id: orgId,
      title: 'Autumn reel',
      status: 'DRAFT',
      owner_user_id: editor.id,
    })
    .select('id')
    .single();
  if (error) throw error;
  itemId = data.id;
});

afterAll(cleanup);

describe('submitting for review', () => {
  it('needs a platform and something to review', async () => {
    const first = await editor.client.rpc('submit_content_for_review', { item_id: itemId });
    expect(first.error?.message).toMatch(/at least one platform/);
    await editor.client
      .from('content_items')
      .update({ platform_keys: ['instagram'] })
      .eq('id', itemId);
    const second = await editor.client.rpc('submit_content_for_review', { item_id: itemId });
    expect(second.error?.message).toMatch(/caption, a brief or a file/);
    await editor.client
      .from('content_versions')
      .update({ caption: 'Feed little and often' })
      .eq('content_item_id', itemId);
  });

  it('is not open to viewers', async () => {
    const { error } = await viewer.client.rpc('submit_content_for_review', { item_id: itemId });
    expect(error).not.toBeNull();
  });

  it('locks the version and what reviewers see, and tells the reviewers', async () => {
    const { error } = await editor.client.rpc('submit_content_for_review', {
      item_id: itemId,
      note: 'Ready for Monday',
    });
    expect(error).toBeNull();
    expect(await status()).toBe('IN_REVIEW');

    const caption = await editor.client
      .from('content_versions')
      .update({ caption: 'Sneaky edit' })
      .eq('content_item_id', itemId);
    expect(caption.error?.message).toMatch(/submitted version/);
    const title = await editor.client
      .from('content_items')
      .update({ title: 'Other title' })
      .eq('id', itemId);
    expect(title.error?.message).toMatch(/locked/);
    const date = await editor.client
      .from('content_items')
      .update({ planned_publish_at: '2026-11-02T08:00:00Z' })
      .eq('id', itemId);
    expect(date.error).toBeNull();

    expect(await notificationsOf(manager)).toMatchObject([
      { kind: 'review_requested', excerpt: 'Ready for Monday' },
    ]);
    expect(await notificationsOf(owner)).toMatchObject([{ kind: 'review_requested' }]);
    expect(await notificationsOf(editor)).toEqual([]);
    expect(await notificationsOf(viewer)).toEqual([]);
  });

  it('can be withdrawn, which unlocks the version', async () => {
    expect(
      (await editor.client.rpc('withdraw_content_from_review', { item_id: itemId })).error,
    ).toBeNull();
    expect(await status()).toBe('DRAFT');
    const { error } = await editor.client
      .from('content_versions')
      .update({ caption: 'Feed little and often, autumn edition' })
      .eq('content_item_id', itemId);
    expect(error).toBeNull();
    expect(
      (await editor.client.rpc('submit_content_for_review', { item_id: itemId })).error,
    ).toBeNull();
  });
});

describe('deciding', () => {
  it('only reviewers decide, and nobody skips a stage directly', async () => {
    const byEditor = await editor.client.rpc('review_content', {
      item_id: itemId,
      decision: 'APPROVED',
    });
    expect(byEditor.error).not.toBeNull();
    const direct = await manager.client
      .from('content_items')
      .update({ status: 'APPROVED' })
      .eq('id', itemId);
    expect(direct.error).not.toBeNull();
    const byOutsider = await outsider.client.rpc('review_content', {
      item_id: itemId,
      decision: 'APPROVED',
    });
    expect(byOutsider.error).not.toBeNull();
  });

  it('asks for a reason when requesting changes', async () => {
    const empty = await manager.client.rpc('review_content', {
      item_id: itemId,
      decision: 'CHANGES_REQUESTED',
      comment: '  ',
    });
    expect(empty.error?.message).toMatch(/what needs to change/);
    const { error } = await manager.client.rpc('review_content', {
      item_id: itemId,
      decision: 'CHANGES_REQUESTED',
      comment: 'Shorter caption please',
    });
    expect(error).toBeNull();
    expect(await status()).toBe('CHANGES_REQUESTED');
    expect((await notificationsOf(editor)).map((n) => n.kind)).toEqual(['changes_requested']);
  });

  it('needs a new version before resubmitting', async () => {
    const same = await editor.client.rpc('submit_content_for_review', { item_id: itemId });
    expect(same.error?.message).toMatch(/Start a new version/);
    expect(
      (await editor.client.rpc('create_content_version', { item_id: itemId })).error,
    ).toBeNull();
    expect(await status()).toBe('CHANGES_REQUESTED');
    await editor.client
      .from('content_versions')
      .update({ caption: 'Feed little, often' })
      .eq('content_item_id', itemId)
      .eq('version_number', 2);
  });

  it('stops managers approving their own submission, but not admins or owners', async () => {
    expect(
      (await manager.client.rpc('submit_content_for_review', { item_id: itemId })).error,
    ).toBeNull();
    const own = await manager.client.rpc('review_content', {
      item_id: itemId,
      decision: 'APPROVED',
    });
    expect(own.error?.message).toMatch(/someone else/);
    const { error } = await owner.client.rpc('review_content', {
      item_id: itemId,
      decision: 'APPROVED',
      comment: 'Lovely',
    });
    expect(error).toBeNull();
    expect(await status()).toBe('APPROVED');
  });

  it('keeps every decision and stage change, read-only', async () => {
    const { data: reviews } = await viewer.client
      .from('content_reviews')
      .select('decision, comment, content_versions(version_number)')
      .eq('content_item_id', itemId)
      .order('created_at');
    expect(reviews).toMatchObject([
      { decision: 'CHANGES_REQUESTED', content_versions: { version_number: 1 } },
      { decision: 'APPROVED', comment: 'Lovely', content_versions: { version_number: 2 } },
    ]);
    const { data: events } = await viewer.client
      .from('content_events')
      .select('from_status, to_status')
      .eq('content_item_id', itemId)
      .order('created_at');
    expect(events!.map((e) => `${e.from_status ?? ''}>${e.to_status}`)).toEqual([
      '>DRAFT',
      'DRAFT>IN_REVIEW',
      'IN_REVIEW>DRAFT',
      'DRAFT>IN_REVIEW',
      'IN_REVIEW>CHANGES_REQUESTED',
      'CHANGES_REQUESTED>IN_REVIEW',
      'IN_REVIEW>APPROVED',
    ]);
    const { error } = await owner.client
      .from('content_reviews')
      .delete()
      .eq('content_item_id', itemId);
    expect(error).not.toBeNull();
  });
});

describe('after approval', () => {
  it('schedules only with a date, then publishes', async () => {
    expect(
      (await editor.client.rpc('set_content_scheduled', { item_id: itemId, scheduled: true }))
        .error,
    ).toBeNull();
    expect(await status()).toBe('SCHEDULED');
    const future = await editor.client.rpc('mark_content_published', {
      item_id: itemId,
      published: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(future.error?.message).toMatch(/future/);
  });

  it('goes back to draft when a new version starts', async () => {
    expect(
      (await editor.client.rpc('create_content_version', { item_id: itemId })).error,
    ).toBeNull();
    expect(await status()).toBe('DRAFT');
    const { data } = await editor.client
      .from('content_events')
      .select('note')
      .eq('content_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(data!.note).toMatch(/Approval no longer applies/);
  });

  it('can be marked published once approved again', async () => {
    await editor.client.rpc('submit_content_for_review', { item_id: itemId });
    await manager.client.rpc('review_content', { item_id: itemId, decision: 'APPROVED' });
    const { error } = await editor.client.rpc('mark_content_published', { item_id: itemId });
    expect(error).toBeNull();
    expect(await status()).toBe('PUBLISHED');
    const archive = await owner.client
      .from('content_items')
      .update({ status: 'ARCHIVED' })
      .eq('id', itemId);
    expect(archive.error).not.toBeNull();
  });
});

describe('comments and notifications', () => {
  it('lets editors comment and mention members, who get notified', async () => {
    const { data, error } = await editor.client
      .from('content_comments')
      .insert({
        organization_id: orgId,
        content_item_id: itemId,
        body: 'Can you check the hashtags?',
        mentions: [manager.id],
      })
      .select('id, author_id, content_version_id')
      .single();
    expect(error).toBeNull();
    expect(data!.author_id).toBe(editor.id);
    expect(data!.content_version_id).not.toBeNull();
    const mentions = (await notificationsOf(manager)).filter((n) => n.kind === 'mentioned');
    expect(mentions).toHaveLength(1);

    const outsiderMention = await editor.client.from('content_comments').insert({
      organization_id: orgId,
      content_item_id: itemId,
      body: 'Hi',
      mentions: [outsider.id],
    });
    expect(outsiderMention.error?.message).toMatch(/only mention members/);

    const reply = await manager.client.from('content_comments').insert({
      organization_id: orgId,
      content_item_id: itemId,
      parent_id: data!.id,
      body: 'Done',
    });
    expect(reply.error).toBeNull();
    expect((await notificationsOf(editor)).some((n) => n.kind === 'commented')).toBe(true);

    const notMine = await manager.client
      .from('content_comments')
      .update({ body: 'Rewritten' })
      .eq('id', data!.id);
    expect(notMine.error?.message).toMatch(/Only the author/);
    const resolve = await manager.client
      .from('content_comments')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', data!.id)
      .select('resolved_by')
      .single();
    expect(resolve.data!.resolved_by).toBe(manager.id);
  });

  it('keeps viewers to reading', async () => {
    const { error } = await viewer.client.from('content_comments').insert({
      organization_id: orgId,
      content_item_id: itemId,
      body: 'Viewer comment',
    });
    expect(error).not.toBeNull();
  });

  it('shows people only their own notifications, which only they can mark read', async () => {
    const { data: theirs } = await editor.client
      .from('notifications')
      .select('id')
      .eq('user_id', manager.id);
    expect(theirs).toEqual([]);
    const { data: mine } = await manager.client
      .from('notifications')
      .select('id')
      .limit(1)
      .single();
    const read = await manager.client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', mine!.id);
    expect(read.error).toBeNull();
    const tamper = await manager.client
      .from('notifications')
      .update({ excerpt: 'changed' })
      .eq('id', mine!.id);
    expect(tamper.error).not.toBeNull();
    const insert = await manager.client.from('notifications').insert({
      organization_id: orgId,
      user_id: manager.id,
      kind: 'mentioned',
    });
    expect(insert.error).not.toBeNull();
  });
});
