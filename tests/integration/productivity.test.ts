import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerClient } from '@/lib/db/server';
import { loadTeamProductivity, loadYourImpact } from '@/lib/productivity/queries';
import { productivityPeriod } from '@/lib/productivity/shared';
import { todayIn } from '@/lib/strategy/shared';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  type Client,
  type TestUser,
} from '../support/supabase';

// "Your impact" is only ever the signed-in user's own records, and the team view holds
// counts only, never a name, an email or a person's id.

let alice: TestUser;
let bruno: TestUser;
let viewer: TestUser;
let orgId: string;
let aliceItem: string;
let brunoItem: string;
const now = new Date();

const asServer = (client: Client) => client as unknown as ServerClient;

async function createItem(user: TestUser, title: string, country: string) {
  const { data, error } = await user.client
    .from('content_items')
    .insert({
      organization_id: orgId,
      title,
      status: 'DRAFT',
      country_code: country,
      platform_keys: ['instagram'],
    })
    .select('id')
    .single();
  if (error) throw error;
  // The first version is added by the database after the insert.
  const version = await user.client
    .from('content_items')
    .select('current_version_id')
    .eq('id', data.id)
    .single();
  if (version.error) throw version.error;
  const caption = await user.client
    .from('content_versions')
    .update({ caption: `${title} caption` })
    .eq('id', version.data.current_version_id!);
  if (caption.error) throw caption.error;
  return data.id;
}

function input(client: Client) {
  return {
    orgId,
    isDemoOrg: false,
    timeZone: 'UTC',
    period: productivityPeriod('this_quarter', todayIn('UTC', now)),
    now,
    db: asServer(client),
  };
}

beforeAll(async () => {
  alice = await createUser('prod-alice', 'Alice Productive');
  bruno = await createUser('prod-bruno', 'Bruno Productive');
  viewer = await createUser('prod-viewer', 'Vera Viewer');
  orgId = (await createOrg(alice, 'Productivity Org')).id;
  await addMember(orgId, bruno, 'EDITOR');
  await addMember(orgId, viewer, 'VIEWER');

  aliceItem = await createItem(alice, 'Alice autumn reel', 'NL');
  brunoItem = await createItem(bruno, 'Bruno winter carousel', 'DE');

  // Bruno sends his item for review; Alice approves it.
  const submit = await bruno.client.rpc('submit_content_for_review', { item_id: brunoItem });
  if (submit.error) throw submit.error;
  const approve = await alice.client.rpc('review_content', {
    item_id: brunoItem,
    decision: 'APPROVED',
  });
  if (approve.error) throw approve.error;

  // A recommendation Bruno accepts, and a report Bruno made by hand (saved by the server).
  const admin = adminClient();
  const run = await admin
    .from('analysis_runs')
    .insert({
      organization_id: orgId,
      period_start: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      period_end: now.toISOString(),
      data_source: 'live_public',
      writer: 'rules',
      status: 'succeeded',
      signals: [],
      created_by: bruno.id,
    })
    .select('id')
    .single();
  if (run.error) throw run.error;
  const rec = await admin
    .from('ai_recommendations')
    .insert({
      organization_id: orgId,
      run_id: run.data.id,
      title: 'Post more Reels',
      observation: 'Reels did better.',
      recommendation: 'Post more Reels.',
      expected_impact: 'More engagement.',
      confidence: 'medium',
      confidence_basis: 'Test.',
      signal_ids: ['s1'],
      evidence: [],
    })
    .select('id')
    .single();
  if (rec.error) throw rec.error;
  const accept = await bruno.client.rpc('set_recommendation_status', {
    recommendation_id: rec.data.id,
    new_status: 'accepted',
  });
  if (accept.error) throw accept.error;

  const day = new Date(now);
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000);
  const start = monday.toISOString().slice(0, 10);
  const report = await admin.from('reports').insert({
    organization_id: orgId,
    period_start: start,
    period_end: new Date(monday.getTime() + 6 * 86_400_000).toISOString().slice(0, 10),
    time_zone: 'UTC',
    title: 'Bruno’s report',
    data_source: 'live_public',
    snapshot: {},
    made_by: 'manual',
    created_by: bruno.id,
  });
  if (report.error) throw report.error;
});

afterAll(cleanup);

describe('Your impact', () => {
  it('holds only the signed-in user’s own records', async () => {
    const mine = await loadYourImpact(input(alice.client));
    expect(mine.created.current).toBe(1);
    expect(mine.createdItems.map((i) => i.id)).toEqual([aliceItem]);
    expect(mine.markets.map((m) => m.code)).toEqual(['NL']);
    expect(mine.reviews.current).toBe(1);
    expect(mine.reviewItems[0]).toMatchObject({ id: brunoItem, decision: 'APPROVED' });
    expect(mine.recommendations.current).toBe(0);
    expect(mine.reportsByHand.current).toBe(0);
    expect(mine.analyses.current).toBe(0);
    const text = JSON.stringify(mine);
    expect(text).not.toContain(bruno.id);
    expect(text).not.toContain(bruno.email);
    expect(text).not.toContain('Bruno’s report');
  });

  it('is someone else’s own records when they sign in', async () => {
    const theirs = await loadYourImpact(input(bruno.client));
    expect(theirs.createdItems.map((i) => i.id)).toEqual([brunoItem]);
    expect(theirs.markets.map((m) => m.code)).toEqual(['DE']);
    expect(theirs.reviews.current).toBe(0);
    expect(theirs.recommendations.current).toBe(1);
    expect(theirs.reportsByHand.current).toBe(1);
    expect(theirs.analyses.current).toBe(1);
    const text = JSON.stringify(theirs);
    expect(text).not.toContain(aliceItem);
    expect(text).not.toContain('Alice autumn reel');
    expect(text).not.toContain(alice.id);
  });

  it('is empty for a member with no records, never another person’s', async () => {
    const empty = await loadYourImpact(input(viewer.client));
    expect(empty.created.current).toBe(0);
    expect(empty.createdItems).toEqual([]);
    expect(empty.reviewItems).toEqual([]);
    expect(empty.recommendationItems).toEqual([]);
    expect(empty.reportItems).toEqual([]);
  });
});

describe('Team', () => {
  it('counts the whole team and never names anyone', async () => {
    const team = await loadTeamProductivity(input(viewer.client));
    expect(team.created.current).toBe(2);
    expect(team.sentForReview.current).toBe(1);
    expect(team.reviews.current.approved).toBe(1);
    expect(team.reviews.current.firstTimeShare).toBe(1);
    expect(team.reviews.current.roundsPerApproval).toBe(1);
    expect(team.reviews.current.medianHoursInReview).not.toBeNull();
    expect(team.reports.current).toEqual({ automatic: 0, byHand: 1 });
    expect(team.analyses.current).toBe(1);

    const text = JSON.stringify(team);
    for (const user of [alice, bruno, viewer]) {
      expect(text).not.toContain(user.id);
      expect(text).not.toContain(user.email);
    }
    expect(text).not.toMatch(/Alice|Bruno|Vera|Productive/);
  });

  it('shows nothing to people outside the organization', async () => {
    const outsider = await createUser('prod-outsider');
    const team = await loadTeamProductivity(input(outsider.client));
    expect(team.created.current).toBe(0);
    expect(team.reviews.current.decisions).toBe(0);
  });
});
