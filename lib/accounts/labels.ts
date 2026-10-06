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
    'Added manually. No data is synced until a platform connector is connected (Phase 4).',
  connected: 'Connected through the platform API.',
  needs_reauth: 'Authorization expired or was revoked. Reconnect to resume syncing.',
  error: 'The last sync failed.',
  demo: 'DEMO DATA for development. Not a real account.',
};

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  live_api: 'Live',
  public_api: 'Public',
  manual: 'Manual',
  import: 'Imported',
  demo: 'DEMO',
};
