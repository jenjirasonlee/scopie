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
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let runId: string;
let recommendationId: string;

const evidence = [
  {
    id: 's1.e1',
    label: 'Reels on Instagram',
    value: 2,
    display: '2.0×',
    n: 30,
    periodStart: '2026-09-01T00:00:00Z',
    periodEnd: '2026-10-01T00:00:00Z',
    method: 'Median ratio.',
    accountIds: [],
  },
];

beforeAll(async () => {
  owner = await createUser('ai-owner');
  editor = await createUser('ai-editor');
  viewer = await createUser('ai-viewer');
  outsider = await createUser('ai-outsider');
  orgId = (await createOrg(owner, 'AI Org')).id;
  await addMember(orgId, editor, 'EDITOR');
  await addMember(orgId, viewer, 'VIEWER');

  // Runs are saved by the server with the service role, as lib/ai/run.ts does.
  const admin = adminClient();
  const run = await admin
    .from('analysis_runs')
    .insert({
      organization_id: orgId,
      period_start: '2026-09-01T00:00:00Z',
      period_end: '2026-10-01T00:00:00Z',
      data_source: 'live_public',
      writer: 'rules',
      status: 'succeeded',
      signals: [],
      created_by: owner.id,
    })
    .select('id')
    .single();
  if (run.error) throw run.error;
  runId = run.data.id;
  const insight = await admin
    .from('ai_insights')
    .insert({
      organization_id: orgId,
      run_id: runId,
      kind: 'format_winner',
      title: 'Reels did better than usual',
      body: 'Reels got 2.0× the usual engagement.',
      signal_ids: ['s1'],
      evidence,
    })
    .select('id')
    .single();
  if (insight.error) throw insight.error;
  const rec = await admin
    .from('ai_recommendations')
    .insert({
      organization_id: orgId,
      run_id: runId,
      insight_id: insight.data.id,
      title: 'Post more Reels',
      observation: 'Reels got 2.0× the usual engagement.',
      recommendation: 'Make half of the posts Reels for four weeks.',
      expected_impact: 'More posts near 2.0× the usual.',
      confidence: 'high',
      confidence_basis: '30 posts across 3 profiles.',
      signal_ids: ['s1'],
      evidence,
    })
    .select('id')
    .single();
  if (rec.error) throw rec.error;
  recommendationId = rec.data.id;
});

afterAll(cleanup);

describe('analysis results', () => {
  it('are readable by members only', async () => {
    const { data } = await viewer.client.from('ai_insights').select('title').eq('run_id', runId);
    expect(data).toEqual([{ title: 'Reels did better than usual' }]);
    const { data: hidden } = await outsider.client
      .from('ai_recommendations')
      .select('id')
      .eq('organization_id', orgId);
    expect(hidden).toEqual([]);
  });

  it("can't be written or changed by users, not even owners", async () => {
    const insert = await owner.client.from('ai_insights').insert({
      organization_id: orgId,
      run_id: runId,
      kind: 'format_winner',
      title: 'Forged',
      body: 'Forged.',
      signal_ids: ['s1'],
      evidence,
    });
    expect(insert.error).not.toBeNull();
    const update = await owner.client
      .from('ai_recommendations')
      .update({ confidence: 'high', title: 'Changed' })
      .eq('id', recommendationId)
      .select('id');
    expect(update.data ?? []).toEqual([]);
    const run = await owner.client.from('analysis_runs').insert({
      organization_id: orgId,
      period_start: '2026-09-01T00:00:00Z',
      period_end: '2026-10-01T00:00:00Z',
      data_source: 'live_public',
      writer: 'rules',
      status: 'succeeded',
    });
    expect(run.error).not.toBeNull();
  });

  it('hides the model audit from people below manager', async () => {
    await adminClient().from('ai_generations').insert({
      organization_id: orgId,
      run_id: runId,
      purpose: 'insights',
      provider: 'fake',
      model: 'test',
      prompt_version: 'insights-v1',
      input: {},
    });
    expect((await editor.client.from('ai_generations').select('id')).data).toEqual([]);
    expect((await owner.client.from('ai_generations').select('id')).data).toHaveLength(1);
  });
});

describe('recommendation status', () => {
  it('is set by editors and up, with who and when', async () => {
    const byViewer = await viewer.client.rpc('set_recommendation_status', {
      recommendation_id: recommendationId,
      new_status: 'dismissed',
    });
    expect(byViewer.error).not.toBeNull();
    const byOutsider = await outsider.client.rpc('set_recommendation_status', {
      recommendation_id: recommendationId,
      new_status: 'dismissed',
    });
    expect(byOutsider.error).not.toBeNull();

    const { error } = await editor.client.rpc('set_recommendation_status', {
      recommendation_id: recommendationId,
      new_status: 'dismissed',
      note: '  Not for this season  ',
    });
    expect(error).toBeNull();
    const { data } = await viewer.client
      .from('ai_recommendations')
      .select('status, status_note, status_changed_by, title')
      .eq('id', recommendationId)
      .single();
    expect(data).toEqual({
      status: 'dismissed',
      status_note: 'Not for this season',
      status_changed_by: editor.id,
      title: 'Post more Reels',
    });
  });

  it('links content ideas to the recommendation for good', async () => {
    const { data: item, error } = await editor.client
      .from('content_items')
      .insert({
        organization_id: orgId,
        title: 'Reel test',
        status: 'IDEA',
        source_recommendation_id: recommendationId,
      })
      .select('id, source_recommendation_id')
      .single();
    expect(error).toBeNull();
    expect(item!.source_recommendation_id).toBe(recommendationId);
    await editor.client
      .from('content_items')
      .update({ source_recommendation_id: null })
      .eq('id', item!.id);
    const { data: after } = await editor.client
      .from('content_items')
      .select('source_recommendation_id')
      .eq('id', item!.id)
      .single();
    expect(after!.source_recommendation_id).toBe(recommendationId);
  });
});
