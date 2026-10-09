import 'server-only';
import { z } from 'zod';
import { createClient } from '@/lib/db/server';
import type { Enums } from '@/lib/db/types';
import { readSnapshot, type SnapshotResult } from './shared';
import type { ReportWeek } from './types';

// Reads for the weekly report pages. They run as the signed-in user, so Row Level Security
// decides what is visible; reports are written only by the server.

export type ReportSummary = {
  id: string;
  week: ReportWeek;
  title: string;
  madeBy: Enums<'report_trigger'>;
  dataSource: Enums<'data_source'>;
  timeZone: string;
  createdAt: string;
  createdByName: string | null;
};

export type Report = ReportSummary & { snapshot: SnapshotResult };

type ProfileRef = { full_name: string | null; email: string } | null;
const personName = (profile: ProfileRef) => profile?.full_name || profile?.email || null;

const SUMMARY_FIELDS =
  'id, period_start, period_end, title, made_by, data_source, time_zone, created_at, creator:profiles!reports_created_by_fkey(full_name, email)';

function summary(row: {
  id: string;
  period_start: string;
  period_end: string;
  title: string;
  made_by: Enums<'report_trigger'>;
  data_source: Enums<'data_source'>;
  time_zone: string;
  created_at: string;
  creator: ProfileRef;
}): ReportSummary {
  return {
    id: row.id,
    week: { start: row.period_start, end: row.period_end },
    title: row.title,
    madeBy: row.made_by,
    dataSource: row.data_source,
    timeZone: row.time_zone,
    createdAt: row.created_at,
    createdByName: personName(row.creator),
  };
}

/** The organization's reports, newest week first. */
export async function listReports(orgId: string, limit = 104): Promise<ReportSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select(SUMMARY_FIELDS)
    .eq('organization_id', orgId)
    .order('period_start', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map(summary);
}

/** One report with its snapshot, or null when it doesn't exist (or isn't visible). */
export async function getReport(orgId: string, reportId: string): Promise<Report | null> {
  if (!z.uuid().safeParse(reportId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select(`${SUMMARY_FIELDS}, snapshot`)
    .eq('organization_id', orgId)
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...summary(data), snapshot: readSnapshot(data.snapshot) };
}
