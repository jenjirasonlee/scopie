import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveCaptionAsNewVersion } from '@/lib/ai/assistant-save';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  type TestUser,
} from '../support/supabase';

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let otherOrgId: string;

const say = (user: TestUser, content: string, org = orgId) =>
  user.client.from('ai_chat_messages').insert({
    organization_id: org,
    user_id: user.id,
    role: 'user',
    content,
  });

beforeAll(async () => {
  owner = await createUser('chat-owner');
  editor = await createUser('chat-editor');
  viewer = await createUser('chat-viewer');
  outsider = await createUser('chat-outsider');
  orgId = (await createOrg(owner, 'Chat Org')).id;
  otherOrgId = (await createOrg(outsider, 'Other Org')).id;
  await addMember(orgId, editor, 'EDITOR');
  await addMember(orgId, viewer, 'VIEWER');
});

afterAll(cleanup);

describe('chat messages', () => {
  it('can be written by every member, viewers too, for themselves', async () => {
    expect((await say(viewer, 'How did our followers change this month?')).error).toBeNull();
    const answer = await viewer.client.from('ai_chat_messages').insert({
      organization_id: orgId,
      user_id: viewer.id,
      role: 'assistant',
      content: 'Your profiles gained +12 followers.',
      writer: 'rules',
      data_used: { tools: [], source: 'DEMO', writer: 'rules', model: null, note: null },
    });
    expect(answer.error).toBeNull();
    expect((await say(owner, 'Owner question')).error).toBeNull();
  });

  it('are private to the person, even from the owner', async () => {
    const { data: mine } = await viewer.client
      .from('ai_chat_messages')
      .select('content')
      .eq('organization_id', orgId);
    expect(mine?.map((m) => m.content).sort()).toEqual([
      'How did our followers change this month?',
      'Your profiles gained +12 followers.',
    ]);
    const { data: owners } = await owner.client
      .from('ai_chat_messages')
      .select('content')
      .eq('organization_id', orgId);
    expect(owners?.map((m) => m.content)).toEqual(['Owner question']);
    const { data: outsiders } = await outsider.client
      .from('ai_chat_messages')
      .select('id')
      .eq('organization_id', orgId);
    expect(outsiders).toEqual([]);
  });

  it("can't be written for someone else or in another organization", async () => {
    const forged = await editor.client.from('ai_chat_messages').insert({
      organization_id: orgId,
      user_id: viewer.id,
      role: 'user',
      content: 'Forged',
    });
    expect(forged.error).not.toBeNull();
    expect((await say(editor, 'Not my org', otherOrgId)).error).not.toBeNull();
    // Someone outside the organization can't write to it either.
    expect((await say(outsider, 'Sneaking in')).error).not.toBeNull();
  });

  it("can't be edited, and only the person can clear them", async () => {
    const update = await viewer.client
      .from('ai_chat_messages')
      .update({ content: 'Changed' })
      .eq('user_id', viewer.id)
      .select('id');
    expect(update.error !== null || update.data?.length === 0).toBe(true);

    const byOwner = await owner.client
      .from('ai_chat_messages')
      .delete()
      .eq('user_id', viewer.id)
      .select('id');
    expect(byOwner.data ?? []).toEqual([]);
    const { count } = await adminClient()
      .from('ai_chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', viewer.id);
    expect(count).toBe(2);

    const byViewer = await viewer.client
      .from('ai_chat_messages')
      .delete()
      .eq('user_id', viewer.id)
      .select('id');
    expect(byViewer.data).toHaveLength(2);
  });

  it('keep answers consistent: a question has no writer, an answer has one', async () => {
    const bad = await viewer.client.from('ai_chat_messages').insert({
      organization_id: orgId,
      user_id: viewer.id,
      role: 'assistant',
      content: 'No writer',
    });
    expect(bad.error).not.toBeNull();
  });
});

describe('model call audit', () => {
  it('takes chat and assistant calls from the server only', async () => {
    const row = {
      organization_id: orgId,
      user_id: viewer.id,
      purpose: 'chat',
      provider: 'openai',
      model: 'gpt-test',
      prompt_version: 'chat-v1',
      input: { question: 'q' },
    };
    expect((await viewer.client.from('ai_generations').insert(row)).error).not.toBeNull();
    expect((await adminClient().from('ai_generations').insert(row)).error).toBeNull();
    expect(
      (
        await adminClient()
          .from('ai_generations')
          .insert({ ...row, purpose: 'assistant' })
      ).error,
    ).toBeNull();
    expect(
      (
        await adminClient()
          .from('ai_generations')
          .insert({ ...row, purpose: 'other' })
      ).error,
    ).not.toBeNull();
    // Managers read the audit; viewers don't.
    const { data: seen } = await viewer.client.from('ai_generations').select('id');
    expect(seen).toEqual([]);
    const { data: owners } = await owner.client
      .from('ai_generations')
      .select('purpose')
      .eq('organization_id', orgId);
    expect(owners?.map((r) => r.purpose).sort()).toEqual(['assistant', 'chat']);
  });
});

describe('content assistant: saving a suggestion', () => {
  let itemId: string;

  beforeAll(async () => {
    const { data, error } = await editor.client
      .from('content_items')
      .insert({
        organization_id: orgId,
        title: 'Autumn tips',
        status: 'DRAFT',
        platform_keys: ['instagram'],
      })
      .select('id')
      .single();
    if (error) throw error;
    itemId = data.id;
    await editor.client
      .from('content_versions')
      .update({ caption: 'Original caption', notes: 'Keep it short.' })
      .eq('content_item_id', itemId)
      .eq('version_number', 1);
  });

  const save = (user: TestUser) =>
    saveCaptionAsNewVersion(user.client, {
      orgId,
      itemId,
      caption: 'Suggested caption',
      hashtags: ['canna'],
      notes: (previous) => `${previous ?? ''}\n\nSuggested by the AI model gpt-test.`,
    });

  it('saves it as a new draft version and keeps the old one', async () => {
    const result = await save(editor);
    expect(result).toMatchObject({ status: 'ok', versionNumber: 2 });
    const { data: versions } = await editor.client
      .from('content_versions')
      .select('version_number, caption, hashtags, notes, submitted_at')
      .eq('content_item_id', itemId)
      .order('version_number');
    expect(versions).toEqual([
      {
        version_number: 1,
        caption: 'Original caption',
        hashtags: [],
        notes: 'Keep it short.',
        submitted_at: null,
      },
      {
        version_number: 2,
        caption: 'Suggested caption',
        hashtags: ['canna'],
        notes: 'Keep it short.\n\nSuggested by the AI model gpt-test.',
        submitted_at: null,
      },
    ]);
    const { data: item } = await editor.client
      .from('content_items')
      .select('status')
      .eq('id', itemId)
      .single();
    expect(item?.status).toBe('DRAFT');
  });

  it('is refused for viewers', async () => {
    const result = await save(viewer);
    expect(result.status).toBe('error');
    const { count } = await adminClient()
      .from('content_versions')
      .select('id', { count: 'exact', head: true })
      .eq('content_item_id', itemId);
    expect(count).toBe(2);
  });

  it('is refused once the content is in review', async () => {
    const submit = await editor.client.rpc('submit_content_for_review', { item_id: itemId });
    expect(submit.error).toBeNull();
    const result = await save(editor);
    expect(result).toEqual({
      status: 'error',
      message: 'Suggestions can only be saved on ideas, drafts and content with changes requested.',
    });
    const { count } = await adminClient()
      .from('content_versions')
      .select('id', { count: 'exact', head: true })
      .eq('content_item_id', itemId);
    expect(count).toBe(2);
  });
});
