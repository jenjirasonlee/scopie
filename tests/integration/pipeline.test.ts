import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptToken } from '@/lib/crypto/tokens';
import { ingest } from '@/lib/ingest/ingest';
import { runImport } from '@/lib/imports/run';
import { METRIC_DEFINITIONS, PLATFORM_METRIC_MAP } from '@/lib/metrics/registry';
import { AuthError } from '@/lib/platforms/errors';
import { CONNECTED_PLATFORMS } from '@/lib/platforms/registry';
import type { PlatformAdapter } from '@/lib/platforms/types';
import { loadAccountContext } from '@/lib/sync/credentials';
import { runSyncJob } from '@/lib/sync/engine';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  type TestUser,
} from '../support/supabase';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const admin = adminClient();

let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let manualAccountId: string;
let connectedAccountId: string;
let connectionId: string;
let assetId: string;

async function createAccount(platform: string, handle: string) {
  const { data, error } = await owner.client
    .from('social_accounts')
    .insert({ organization_id: orgId, platform_key: platform, display_name: handle, handle })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  owner = await createUser('pipe-owner');
  viewer = await createUser('pipe-viewer');
  outsider = await createUser('pipe-outsider');
  orgId = (await createOrg(owner, 'Pipeline Org')).id;
  await addMember(orgId, viewer, 'VIEWER');
  await createOrg(outsider, 'Outsider Org');
  manualAccountId = await createAccount('linkedin', 'pipe_linkedin');
  connectedAccountId = await createAccount('facebook', 'pipe_facebook');

  // What the OAuth callback stores (it runs with the service role).
  const { data: connection, error } = await admin
    .from('platform_connections')
    .insert({
      organization_id: orgId,
      provider: 'meta',
      external_user_id: 'fixture-user',
      status: 'active',
    })
    .select('id')
    .single();
  if (error) throw error;
  connectionId = connection.id;
  await admin.from('connection_credentials').insert({
    connection_id: connectionId,
    organization_id: orgId,
    asset_external_id: 'fixture-page-1',
    ciphertext: encryptToken('fixture-page-token', ENCRYPTION_KEY),
    key_version: 1,
  });
  const { data: asset } = await admin
    .from('connection_assets')
    .insert({
      organization_id: orgId,
      connection_id: connectionId,
      platform_key: 'facebook',
      external_id: 'fixture-page-1',
      name: 'Fixture Page',
      account_type: 'page',
    })
    .select('id')
    .single();
  assetId = asset!.id;
});

afterAll(cleanup);

describe('connections', () => {
  it('never lets users read stored tokens', async () => {
    const { data, error } = await owner.client.from('connection_credentials').select('*');
    expect(error ?? data).toBeTruthy();
    expect(data ?? []).toEqual([]);
  });

  it('only lets managers link accounts', async () => {
    const { error } = await viewer.client.rpc('link_connection_asset', {
      asset_id: assetId,
      account_id: connectedAccountId,
    });
    expect(error?.code).toBe('42501');
  });

  it('refuses to link across platforms', async () => {
    const { error } = await owner.client.rpc('link_connection_asset', {
      asset_id: assetId,
      account_id: manualAccountId,
    });
    expect(error?.message).toMatch(/Platform does not match/);
  });

  it('links an account, which marks it live and sets when tracking started', async () => {
    const { error } = await owner.client.rpc('link_connection_asset', {
      asset_id: assetId,
      account_id: connectedAccountId,
    });
    expect(error).toBeNull();
    const { data } = await owner.client
      .from('social_accounts')
      .select('*')
      .eq('id', connectedAccountId)
      .single();
    expect(data).toMatchObject({
      connection_id: connectionId,
      external_id: 'fixture-page-1',
      connection_status: 'connected',
      primary_data_source: 'authenticated',
    });
    expect(data!.tracking_started_at).not.toBeNull();
  });

  it('keeps users from editing connection fields directly', async () => {
    const { data } = await owner.client
      .from('social_accounts')
      .update({ connection_id: null, external_id: 'changed' })
      .eq('id', connectedAccountId)
      .select('connection_id, external_id')
      .single();
    expect(data).toEqual({ connection_id: connectionId, external_id: 'fixture-page-1' });
  });

  it('decrypts the right token for the worker', async () => {
    const { data: account } = await admin
      .from('social_accounts')
      .select('*')
      .eq('id', connectedAccountId)
      .single();
    const ctx = await loadAccountContext(admin, account!, ENCRYPTION_KEY);
    expect(ctx).toMatchObject({ externalId: 'fixture-page-1', accessToken: 'fixture-page-token' });
  });
});

describe('where data may come from', () => {
  const post = (source: string, accountId = manualAccountId, extra = {}) => ({
    organization_id: orgId,
    social_account_id: accountId,
    platform_key: accountId === manualAccountId ? 'linkedin' : 'facebook',
    external_id: `p-${randomBytes(4).toString('hex')}`,
    published_at: '2026-09-01T10:00:00Z',
    published_local_date: '2026-09-01',
    data_source: source as 'imported',
    ...extra,
  });

  it('refuses DEMO data in a real organization', async () => {
    const { error } = await admin.from('posts').insert(post('demo'));
    expect(error?.message).toMatch(/demo/i);
  });

  it('refuses live data for an account that is not connected', async () => {
    const { error } = await admin.from('posts').insert(post('authenticated'));
    expect(error?.message).toMatch(/requires a connected account/);
  });

  it('never lets a user write live data, even for a connected account', async () => {
    const { error } = await owner.client
      .from('posts')
      .insert(post('authenticated', connectedAccountId));
    expect(error?.message).toMatch(/Only imported or manual data/);
  });

  it('needs an import batch for imported data', async () => {
    const { error } = await owner.client.from('posts').insert(post('imported'));
    expect(error?.message).toMatch(/must belong to an import batch/);
  });

  it('rejects a value that disagrees with its availability', async () => {
    const { data: created } = await owner.client
      .from('posts')
      .insert(post('manual'))
      .select('id')
      .single();
    const { error } = await owner.client.from('post_metric_snapshots').insert({
      organization_id: orgId,
      post_id: created!.id,
      metric_key: 'reach',
      source_metric: 'manual',
      post_age_hours: 0, // set by the database
      value: 10,
      availability: 'not_permitted',
      period: 'lifetime',
      data_source: 'manual',
      captured_at: new Date().toISOString(),
    });
    expect(error?.code).toBe('23514'); // check constraint: value and availability must agree
  });
});

describe('CSV import', () => {
  const csv =
    'post_id,published_at,captured_at,impressions,reactions\n' +
    'urn:li:share:1,2026-09-01T09:00:00Z,2026-09-02,100,4\n' +
    'urn:li:share:1,2026-09-01T09:00:00Z,2026-09-08,180,7\n' +
    'urn:li:share:2,2026-09-03,2026-09-08,50,\n' +
    'bad,not-a-date,,1,1\n';

  it('stores rows as imported data tied to a batch, and skips bad rows', async () => {
    const summary = await runImport(owner.client, {
      organizationId: orgId,
      socialAccountId: manualAccountId,
      platformKey: 'linkedin',
      userId: owner.id,
      kind: 'posts',
      fileName: 'linkedin.csv',
      text: csv,
    });
    expect(summary).toMatchObject({
      status: 'completed_with_errors',
      rowsTotal: 4,
      rowsImported: 3,
      rowsSkipped: 1,
    });

    const { data: posts } = await owner.client
      .from('posts')
      .select('external_id, data_source, import_batch_id')
      .eq('social_account_id', manualAccountId)
      .like('external_id', 'urn:%')
      .order('external_id');
    expect(posts).toEqual([
      { external_id: 'urn:li:share:1', data_source: 'imported', import_batch_id: summary.batchId },
      { external_id: 'urn:li:share:2', data_source: 'imported', import_batch_id: summary.batchId },
    ]);
    const { count } = await owner.client
      .from('post_metric_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('import_batch_id', summary.batchId!);
    expect(count).toBe(5); // the empty reactions cell is not stored as 0

    const { data: batch } = await owner.client
      .from('import_batches')
      .select('*')
      .eq('id', summary.batchId!)
      .single();
    expect(batch).toMatchObject({
      status: 'completed_with_errors',
      rows_imported: 3,
      rows_skipped: 1,
    });
  });

  it('skips values already stored when the same file is imported again', async () => {
    const summary = await runImport(owner.client, {
      organizationId: orgId,
      socialAccountId: manualAccountId,
      platformKey: 'linkedin',
      userId: owner.id,
      kind: 'posts',
      fileName: 'linkedin.csv',
      text: csv,
    });
    expect(summary.duplicatesSkipped).toBeGreaterThan(0);
  });

  it('is invisible to other organizations', async () => {
    const { data: posts } = await outsider.client
      .from('posts')
      .select('id')
      .eq('organization_id', orgId);
    const { data: facts } = await outsider.client
      .from('post_metric_snapshots')
      .select('id')
      .eq('organization_id', orgId);
    const { data: batches } = await outsider.client
      .from('import_batches')
      .select('id')
      .eq('organization_id', orgId);
    expect([posts, facts, batches]).toEqual([[], [], []]);
  });

  it('cannot be run by a viewer', async () => {
    const summary = await runImport(viewer.client, {
      organizationId: orgId,
      socialAccountId: manualAccountId,
      platformKey: 'linkedin',
      userId: viewer.id,
      kind: 'posts',
      fileName: 'x.csv',
      text: csv,
    });
    expect(summary.status).toBe('failed');
    expect(summary.batchId).toBeNull();
  });
});

describe('ingest', () => {
  it('skips exact duplicates instead of storing them twice', async () => {
    const input = {
      organizationId: orgId,
      socialAccountId: connectedAccountId,
      platformKey: 'facebook',
      dataSource: 'authenticated' as const,
      capturedAt: '2026-09-10T06:00:00.000Z',
      accountMetrics: [
        {
          metricKey: 'reach',
          sourceMetric: 'page_impressions_unique',
          value: 12,
          availability: 'available' as const,
          period: 'day' as const,
          metricDate: '2026-09-09',
        },
      ],
    };
    const first = await ingest(admin, input, 'sync');
    const second = await ingest(admin, input, 'sync');
    expect(first.accountMetricsWritten).toBe(1);
    expect(second.accountMetricsWritten).toBe(0);
  });
});

describe('sync engine', () => {
  const fakeAdapter = (fail?: Error): PlatformAdapter => ({
    platformKey: 'facebook',
    async getAccountMetrics(_ctx, range) {
      if (fail) throw fail;
      return [
        {
          metricKey: 'followers',
          sourceMetric: 'followers_count',
          value: 500,
          availability: 'available',
          period: 'lifetime',
          metricDate: range.asOf,
        },
      ];
    },
    async listPosts() {
      if (fail) throw fail;
      return {
        posts: [
          {
            externalId: 'fb-post-1',
            publishedAt: '2026-09-20T10:00:00Z',
            permalink: null,
            caption: 'Fixture',
            mediaFormat: 'image',
            nativeType: 'photo',
          },
        ],
        nextCursor: null,
      };
    },
    async getPostMetrics(_ctx, posts) {
      return {
        metrics: posts.flatMap((post) => [
          {
            postExternalId: post.externalId,
            metricKey: 'reach',
            sourceMetric: 'post_impressions_unique',
            value: 40,
            availability: 'available' as const,
            period: 'lifetime' as const,
            metricDate: null,
          },
          {
            postExternalId: post.externalId,
            metricKey: 'link_clicks',
            sourceMetric: 'post_clicks',
            value: null,
            availability: 'not_permitted' as const,
            period: 'lifetime' as const,
            metricDate: null,
          },
        ]),
        failures: [],
      };
    },
  });

  const deps = (adapter: PlatformAdapter) => ({
    db: admin,
    adapterFor: () => adapter,
    contextFor: (account: Parameters<typeof loadAccountContext>[1]) =>
      loadAccountContext(admin, account, ENCRYPTION_KEY),
    now: () => new Date('2026-09-25T08:00:00Z'),
  });

  it('allows only one queued run per account and job', async () => {
    const first = await owner.client.rpc('request_sync', { account_id: connectedAccountId });
    const second = await owner.client.rpc('request_sync', { account_id: connectedAccountId });
    expect(first.error).toBeNull();
    expect(second.data).toBe(first.data);
  });

  it('stores live posts and metrics, keeping withheld numbers as "not permitted"', async () => {
    const { data: runId } = await owner.client.rpc('request_sync', {
      account_id: connectedAccountId,
    });
    const outcome = await runSyncJob(deps(fakeAdapter()), runId!);
    expect(outcome.status).toBe('succeeded');

    const { data: posts } = await owner.client
      .from('posts')
      .select('id, data_source')
      .eq('external_id', 'fb-post-1');
    expect(posts).toEqual([expect.objectContaining({ data_source: 'authenticated' })]);
    const { data: facts } = await owner.client
      .from('post_metric_snapshots')
      .select('metric_key, value, availability, sync_run_id')
      .eq('post_id', posts![0]!.id)
      .order('metric_key');
    expect(facts).toEqual([
      { metric_key: 'link_clicks', value: null, availability: 'not_permitted', sync_run_id: runId },
      { metric_key: 'reach', value: 40, availability: 'available', sync_run_id: runId },
    ]);
    const { data: run } = await owner.client
      .from('sync_runs')
      .select('status')
      .eq('id', runId!)
      .single();
    expect(run!.status).toBe('succeeded');
  });

  it('marks the connection for reconnecting when the platform rejects the token', async () => {
    const { data: runId } = await owner.client.rpc('request_sync', {
      account_id: connectedAccountId,
    });
    const outcome = await runSyncJob(deps(fakeAdapter(new AuthError('Token expired'))), runId!);
    expect(outcome.status).toBe('failed');
    const { data: account } = await owner.client
      .from('social_accounts')
      .select('connection_status')
      .eq('id', connectedAccountId)
      .single();
    const { data: connection } = await owner.client
      .from('platform_connections')
      .select('status')
      .eq('id', connectionId)
      .single();
    expect(account!.connection_status).toBe('needs_reauth');
    expect(connection!.status).toBe('needs_reauth');
  });

  it('disconnecting deletes tokens and stops syncing; collected data stays', async () => {
    await admin.from('platform_connections').update({ status: 'active' }).eq('id', connectionId);
    const { error } = await owner.client.rpc('disconnect_platform_connection', {
      target: connectionId,
    });
    expect(error).toBeNull();
    const { count } = await admin
      .from('connection_credentials')
      .select('*', { count: 'exact', head: true })
      .eq('connection_id', connectionId);
    expect(count).toBe(0);
    const { data: account } = await owner.client
      .from('social_accounts')
      .select('connection_status, connection_id')
      .eq('id', connectedAccountId)
      .single();
    expect(account).toEqual({ connection_status: 'not_connected', connection_id: null });
    const { count: posts } = await owner.client
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('social_account_id', connectedAccountId);
    expect(posts).toBeGreaterThan(0);
  });
});

describe('metric dictionary', () => {
  it('lists the same connected platforms as the code', async () => {
    const { data } = await admin
      .from('platforms')
      .select('key')
      .eq('connector_status', 'available');
    expect(data!.map((row) => row.key).sort()).toEqual([...CONNECTED_PLATFORMS].sort());
  });

  it('matches the database', async () => {
    const { data: definitions } = await admin
      .from('metric_definitions')
      .select('key, unit, aggregation, is_derived');
    expect(
      definitions!.map((row) => [row.key, row.unit, row.aggregation, row.is_derived]).sort(),
    ).toEqual(
      METRIC_DEFINITIONS.map((metric) => [
        metric.key,
        metric.unit,
        metric.aggregation,
        metric.isDerived,
      ]).sort(),
    );

    const { data: map } = await admin
      .from('platform_metric_map')
      .select(
        'platform_key, scope, source_metric, metric_key, comparability_class, value_transform',
      );
    expect(
      map!
        .map((row) => [
          row.platform_key,
          row.scope,
          row.source_metric,
          row.metric_key,
          row.comparability_class,
          row.value_transform,
        ])
        .sort(),
    ).toEqual(
      PLATFORM_METRIC_MAP.map((entry) => [
        entry.platformKey,
        entry.scope,
        entry.sourceMetric,
        entry.metricKey,
        entry.comparabilityClass,
        entry.valueTransform,
      ]).sort(),
    );
  });
});
