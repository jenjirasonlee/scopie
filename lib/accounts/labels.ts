import type { Enums } from '@/lib/db/types';

export type ConnectionStatus = Enums<'account_connection_status'>;
export type DataSource = Enums<'data_source'>;

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  not_connected: 'Not connected',
  connected: 'Connected',
  needs_reauth: 'Needs reconnect',
  error: 'Sync error',
  demo: 'Demo data',
};

export const CONNECTION_STATUS_HELP: Record<ConnectionStatus, string> = {
  not_connected:
    'Added manually. Link it to a platform connection in Settings → Connections to sync data, or import a CSV.',
  connected: 'Connected through the platform API.',
  needs_reauth: 'Authorization expired or was revoked. Reconnect to resume syncing.',
  error: 'The last sync failed.',
  demo: 'DEMO DATA for development. Not a real account.',
};

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  authenticated: 'Live',
  public: 'Public',
  manual: 'Manual',
  imported: 'Imported',
  demo: 'DEMO',
};

export const SYNC_STATUS_LABELS: Record<Enums<'sync_status'>, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  partial: 'Partly done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const SYNC_JOB_LABELS: Record<Enums<'sync_job_type'>, string> = {
  account_daily: 'Daily account metrics',
  posts_incremental: 'New posts',
  post_metrics_refresh: 'Post metrics refresh',
  backfill: 'History backfill',
};

export const IMPORT_STATUS_LABELS: Record<Enums<'import_status'>, string> = {
  processing: 'Processing',
  completed: 'Imported',
  completed_with_errors: 'Imported with skipped rows',
  failed: 'Failed',
};
