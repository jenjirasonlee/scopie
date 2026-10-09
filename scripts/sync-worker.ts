/**
 * Runs the sync engine without Trigger.dev, for local development and self-hosting.
 *
 *   pnpm sync:worker          # one tick: queue due jobs, run the queue, exit
 *   pnpm sync:worker --watch  # repeat every 15 minutes
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SCOPIE_ENCRYPTION_KEY,
 * plus META_APP_ID and META_APP_SECRET for Instagram and Facebook.
 */
import { config } from 'dotenv';
import { syncTick, workerDepsFromEnv } from '../lib/sync/worker';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

async function tick() {
  const { queued, results } = await syncTick(workerDepsFromEnv());
  console.log(`[${new Date().toISOString()}] queued ${queued}, ran ${results.length}`);
  for (const { runId, outcome } of results) {
    console.log(
      `  ${runId}: ${outcome.status} (${outcome.processed} written, ${outcome.failed} failed${outcome.errorCode ? `, ${outcome.errorCode}` : ''})`,
    );
  }
}

async function main() {
  await tick();
  if (!process.argv.includes('--watch')) return;
  setInterval(() => {
    tick().catch((error: unknown) => console.error('Sync tick failed:', error));
  }, 15 * 60_000);
}

main().catch((error: unknown) => {
  console.error('Sync worker failed:', error);
  process.exit(1);
});
