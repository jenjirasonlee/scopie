import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateWeeklyReport } from '@/lib/reports/generate';
import type { ReportSnapshot } from '@/lib/reports/types';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  type TestUser,
} from '../support/supabase';

let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let reportId: string;
// Thursday 8 October 2026: the report covers 28 September to 4 October.
const NOW = new Date('2026-10-08T12:00:00Z');

beforeAll(async () => {
  owner = await createUser('report-owner');
  viewer = await createUser('report-viewer');
  outsider = await createUser('report-outsider');
  orgId = (await createOrg(owner, 'Report Org')).id;
  await addMember(orgId, viewer, 'VIEWER');
});

afterAll(cleanup);

describe('weekly reports', () => {
  it('makes last week’s report once, as a snapshot', async () => {
    const result = await generateWeeklyReport({
      orgId,
      userId: owner.id,
      madeBy: 'manual',
      now: NOW,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    reportId = result.reportId;

    const again = await generateWeeklyReport({ orgId, userId: null, madeBy: 'schedule', now: NOW });
    expect(again).toEqual({ status: 'exists', reportId });

    const { data } = await viewer.client.from('reports').select('*').eq('id', reportId).single();
    expect(data).toMatchObject({
      period_start: '2026-09-28',
      period_end: '2026-10-04',
      made_by: 'manual',
      data_source: 'live_public',
    });
    const snapshot = data!.snapshot as unknown as ReportSnapshot;
    // No profiles yet: numbers are N/A with a reason, never zero.
    const gained = snapshot.kpis.find((k) => k.key === 'followers_gained')!;
    expect(gained.value).toBeNull();
    expect(gained.unavailable).toBeTruthy();
    expect(snapshot.notes.join(' ')).toMatch(/no active own profiles/);
  });

  it('tells every member in the app', async () => {
    for (const member of [owner, viewer]) {
      const { data } = await member.client
        .from('notifications')
        .select('kind, report_id')
        .eq('report_id', reportId);
      expect(data).toEqual([{ kind: 'report_ready', report_id: reportId }]);
    }
  });

  it('is hidden from outsiders and can’t be written by users', async () => {
    const { data } = await outsider.client.from('reports').select('id').eq('id', reportId);
    expect(data).toEqual([]);

    const insert = await owner.client.from('reports').insert({
      organization_id: orgId,
      period_start: '2026-09-21',
      period_end: '2026-09-27',
      time_zone: 'UTC',
      title: 'Forged',
      data_source: 'live_public',
      snapshot: {},
      made_by: 'manual',
    });
    expect(insert.error).not.toBeNull();

    await owner.client.from('reports').update({ title: 'Changed' }).eq('id', reportId);
    await owner.client.from('reports').delete().eq('id', reportId);
    const { data: still } = await adminClient()
      .from('reports')
      .select('title')
      .eq('id', reportId)
      .single();
    expect(still?.title).not.toBe('Changed');
  });

  it('only accepts whole Monday-to-Sunday weeks', async () => {
    const { error } = await adminClient().from('reports').insert({
      organization_id: orgId,
      period_start: '2026-09-22',
      period_end: '2026-09-28',
      time_zone: 'UTC',
      title: 'Tuesday week',
      data_source: 'live_public',
      snapshot: {},
      made_by: 'manual',
    });
    expect(error).not.toBeNull();
  });
});
