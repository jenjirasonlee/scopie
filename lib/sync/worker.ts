import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { createAdapter, createPublicCollector, needsViewer } from '@/lib/platforms/registry';
import { metaConfig, parseServerEnv } from '@/lib/server-env';
import { loadAccountContext, loadPublicContext } from './credentials';
import type { EngineDeps } from './engine';
import { enqueueDueJobs, failStaleRuns, processQueue, pruneRawPayloads } from './scheduler';

/**
 * Builds the sync engine's dependencies from environment variables. Used by the
 * Trigger.dev task and by `pnpm sync:worker`; both run outside the web app.
 */
export function workerDepsFromEnv(
  env: Record<string, string | undefined> = process.env,
): EngineDeps {
  const server = parseServerEnv(env);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !server.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('The sync worker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!server.SCOPIE_ENCRYPTION_KEY) throw new Error('The sync worker needs SCOPIE_ENCRYPTION_KEY');
  const encryptionKey = server.SCOPIE_ENCRYPTION_KEY;
  const meta = metaConfig(server);

  const db = createClient<Database>(url, server.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    db,
    adapterFor: (platformKey) =>
      createAdapter(platformKey, { version: meta?.version, appSecret: meta?.appSecret }),
    contextFor: (account) => loadAccountContext(db, account, encryptionKey),
    collectorFor: (platformKey) =>
      createPublicCollector(platformKey, { version: meta?.version, appSecret: meta?.appSecret }),
    publicContextFor: async (organizationId, platformKey) =>
      needsViewer(platformKey)
        ? loadPublicContext(db, organizationId, platformKey, encryptionKey)
        : { viewerId: null, credential: server.YOUTUBE_API_KEY ?? '' },
  };
}

/** One scheduler tick: tidy up, queue what is due, run the queue. */
export async function syncTick(deps: EngineDeps, now: Date = new Date()) {
  await failStaleRuns(deps.db, now);
  const queued = await enqueueDueJobs(deps.db, now, {
    apiKeyPlatforms: process.env.YOUTUBE_API_KEY ? ['youtube'] : [],
  });
  const results = await processQueue(deps);
  await pruneRawPayloads(deps.db, now);
  return { queued, results };
}
