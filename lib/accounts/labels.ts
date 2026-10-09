import type { Enums } from '@/lib/db/types';

export type ConnectionStatus = Enums<'account_connection_status'>;
export type DataSource = Enums<'data_source'>;
export type BusinessRole = Enums<'business_role'>;
export type AccessType = Enums<'profile_access_type'>;
export type MetricAvailability = Enums<'metric_availability'>;

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  not_connected: 'Not connected',
  connected: 'Connected',
  needs_reauth: 'Needs reconnect',
  error: 'Sync error',
  demo: 'Demo data',
};

export const CONNECTION_STATUS_HELP: Record<ConnectionStatus, string> = {
  not_connected:
    'Not connected. Public data is collected where the platform allows it; connecting adds private metrics for your own profiles.',
  connected: 'Connected through the platform API.',
  needs_reauth: 'Authorization expired or was revoked. Reconnect to resume syncing.',
  error: 'The last sync failed.',
  demo: 'DEMO DATA for development. Not a real account.',
};

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  live_public: 'PUBLIC',
  live_connected: 'CONNECTED',
  imported: 'IMPORTED',
  estimated: 'ESTIMATED',
  demo: 'DEMO',
};

export const DATA_SOURCE_HELP: Record<DataSource, string> = {
  live_public: 'Observed from public platform data, without the owner’s login',
  live_connected: 'Read through your account connection, including private metrics',
  imported: 'Uploaded from a CSV file',
  estimated: 'Estimated, not reported by the platform. Never shown as a live value.',
  demo: 'DEMO DATA: generated for testing, not real',
};

export const BUSINESS_ROLE_LABELS: Record<BusinessRole, string> = {
  owned: 'Own profile',
  competitor: 'Competitor',
  industry: 'Industry',
  influencer: 'Influencer / creator',
  other: 'Other',
};

export const BUSINESS_ROLES = Object.keys(BUSINESS_ROLE_LABELS) as BusinessRole[];

export const ACCESS_TYPE_LABELS: Record<AccessType, string> = {
  public: 'Public',
  connected: 'Connected',
  imported: 'Imported',
  demo: 'Demo',
};

export const ACCESS_TYPE_HELP: Record<AccessType, string> = {
  public:
    'Scopie observes this profile’s public data through the platform’s official API. The owner doesn’t need to authorize anything.',
  connected:
    'Connected with the owner’s permission. Scopie keeps observing its public data too, so comparisons with competitors stay like for like.',
  imported: 'This platform has no public data collector yet. Add data by importing a CSV.',
  demo: 'DEMO DATA for development. Not a real profile.',
};

/** Why a number is missing. Shown instead of a value, never as zero. */
export const AVAILABILITY_LABELS: Record<MetricAvailability, string> = {
  available: '',
  not_permitted: 'not shared',
  not_applicable: 'n/a',
  pending: 'pending',
  error: 'error',
  hidden_by_owner: 'hidden by owner',
  not_public: 'not public',
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
  public_profile_daily: 'Daily public observation',
  public_posts_refresh: 'Public post metrics',
  public_backfill: 'Public post history',
};

export const IMPORT_STATUS_LABELS: Record<Enums<'import_status'>, string> = {
  processing: 'Processing',
  completed: 'Imported',
  completed_with_errors: 'Imported with skipped rows',
  failed: 'Failed',
};
