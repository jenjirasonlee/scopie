import { defineConfig } from '@trigger.dev/sdk';

/**
 * Trigger.dev runs Scopie's scheduled sync (trigger/sync.ts) and the weekly reports
 * schedule (trigger/reports.ts, which needs SCOPIE_APP_URL and REPORTS_CRON_SECRET).
 * Set TRIGGER_PROJECT_REF to your Trigger.dev project ref ("proj_...") before deploying.
 * The sync task needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SCOPIE_ENCRYPTION_KEY,
 * META_APP_ID and META_APP_SECRET set in the Trigger.dev project's environment variables.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? 'proj_set_TRIGGER_PROJECT_REF',
  dirs: ['./trigger'],
  maxDuration: 900,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
