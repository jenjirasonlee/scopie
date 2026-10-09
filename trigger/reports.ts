import { logger, schedules } from '@trigger.dev/sdk';

/**
 * Every hour: asks the app to make the weekly reports that are due (from Monday 06:00 in
 * each organization's time zone). The report itself is made by the app
 * (app/api/reports/weekly), so this task only needs SCOPIE_APP_URL and REPORTS_CRON_SECRET.
 */
export const weeklyReports = schedules.task({
  id: 'scopie-weekly-reports',
  cron: '5 * * * *',
  run: async () => {
    const url = process.env.SCOPIE_APP_URL;
    const secret = process.env.REPORTS_CRON_SECRET;
    if (!url || !secret) {
      throw new Error('The reports schedule needs SCOPIE_APP_URL and REPORTS_CRON_SECRET');
    }
    const response = await fetch(new URL('/api/reports/weekly', url), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!response.ok) throw new Error(`The app answered ${response.status}`);
    const result = (await response.json()) as { made: number; failed: number };
    logger.info('Weekly reports checked', result);
    return result;
  },
});
