import { logger, schedules } from '@trigger.dev/sdk';
import { syncTick, workerDepsFromEnv } from '../lib/sync/worker';

/**
 * Every 15 minutes: queue the sync jobs that are due and run the queue.
 * Retries happen inside the sync engine (per request and per job, with backoff),
 * so the task itself is not retried.
 */
export const scheduledSync = schedules.task({
  id: 'scopie-scheduled-sync',
  cron: '*/15 * * * *',
  run: async () => {
    const { queued, results } = await syncTick(workerDepsFromEnv());
    const summary = results.map((result) => result.outcome.status);
    logger.info('Sync tick finished', { queued, ran: results.length, summary });
    return { queued, ran: results.length };
  },
});
