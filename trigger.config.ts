import { defineConfig } from '@trigger.dev/sdk';

/**
 * Trigger.dev runs Scopie's scheduled sync (trigger/sync.ts).
 * Set TRIGGER_PROJECT_REF to your Trigger.dev project ref ("proj_...") before deploying.
 * The task needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SCOPIE_ENCRYPTION_KEY,
 * META_APP_ID and META_APP_SECRET set in the Trigger.dev project's environment variables.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? 'proj_set_TRIGGER_PROJECT_REF',
  dirs: ['./trigger'],
  maxDuration: 900,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
