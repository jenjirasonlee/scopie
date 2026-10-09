import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { generateDueReports, reportSetup } from '@/lib/reports/generate';
import { serverEnv } from '@/lib/server-env';

/**
 * Makes the weekly reports that are due. Called every hour by the schedule
 * (trigger/reports.ts) with REPORTS_CRON_SECRET; nobody else can call it.
 */
export async function POST(request: NextRequest) {
  const secret = serverEnv().REPORTS_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Reports schedule is not set up.' }, { status: 503 });
  }
  const sent = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(sent), digest(secret))) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  }
  if (!reportSetup().canRun) {
    return NextResponse.json({ error: 'The server needs the service role key.' }, { status: 503 });
  }
  const result = await generateDueReports();
  return NextResponse.json(result);
}
