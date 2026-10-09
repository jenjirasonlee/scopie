import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/db/server';
import { renderReportPdf, reportPdfFilename } from '@/lib/reports/pdf';
import { getReport } from '@/lib/reports/queries';
import { madeByLine } from '@/lib/reports/shared';

// A weekly report as a PDF download. It runs as the signed-in user, so Row Level Security
// decides whether the report is visible, and it renders the stored snapshot as it is.

const text = (message: string, status: number) =>
  new NextResponse(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return text('Sign in to download this report.', 401);

  const notFound = () => text('This report doesn’t exist, or you don’t have access to it.', 404);
  if (!z.uuid().safeParse(reportId).success) return notFound();

  // Which organization the report belongs to; only members can see the row.
  const { data: row, error } = await supabase
    .from('reports')
    .select('organization_id')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return notFound();

  const report = await getReport(row.organization_id, reportId);
  if (!report) return notFound();

  // Same rule as the report page: a snapshot that can't be read is not shown at all, rather
  // than numbers that might be wrong.
  if (report.snapshot.status !== 'ok') {
    return text(
      report.snapshot.status === 'newer'
        ? 'This report was made by a newer version of Scopie, which this version can’t read yet. Try again in a few minutes.'
        : 'This report can’t be shown: its stored contents couldn’t be read.',
      422,
    );
  }

  const snapshot = report.snapshot.snapshot;
  const pdf = await renderReportPdf({
    title: report.title,
    madeBy: madeByLine(report.madeBy, report.createdByName, report.createdAt, snapshot.timeZone),
    createdAt: report.createdAt,
    snapshot,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportPdfFilename(snapshot.week)}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
