import type { Metadata } from 'next';
import Link from 'next/link';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { MakeReportForm } from '@/components/reports/report-buttons';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { can } from '@/lib/auth/permissions';
import { formatDateTime } from '@/lib/content/review';
import { getOrgContext } from '@/lib/orgs/queries';
import { generateReportAction } from '@/lib/reports/actions';
import { reportSetup } from '@/lib/reports/generate';
import { listReports } from '@/lib/reports/queries';
import { formatWeek, madeByShort, reportHref } from '@/lib/reports/shared';
import { lastFullWeek } from '@/lib/reports/week';

export const metadata: Metadata = { title: 'Weekly reports' };

export default async function ReportsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const canMake = can(role, 'strategy.manage');
  const timeZone = org.default_timezone;
  const reports = await listReports(org.id);

  // getOrgContext has already read request data, so the current time is per request.
  const lastWeek = lastFullWeek(new Date(), timeZone);
  const hasLastWeek = reports.some((r) => r.week.start === lastWeek.start);
  // Only read the server's setup when someone could use the button.
  const setup = canMake && !hasLastWeek ? reportSetup() : null;
  const lastWeekLabel = formatWeek(lastWeek) ?? 'last week';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly reports"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {org.is_demo ? <Badge variant="demo">Demo</Badge> : null}
            <span>
              Made every Monday for the week before, Monday to Sunday. The numbers are frozen when a
              report is made, so it reads the same later.
              {org.is_demo ? ' These reports are made from DEMO DATA; none of it is real.' : ''}
            </span>
          </span>
        }
        actions={
          setup ? (
            setup.canRun ? (
              <MakeReportForm
                action={generateReportAction.bind(null, orgSlug)}
                label="Make last week’s report"
              />
            ) : (
              <p className="text-muted-foreground max-w-xs text-xs">
                Last week’s report can’t be made yet. The server is missing:{' '}
                {setup.missing.join(', ')}.
              </p>
            )
          ) : null
        }
      />

      {setup?.canRun ? (
        <p className="text-muted-foreground text-[13px]">
          The report for {lastWeekLabel} hasn’t been made yet. It is made automatically on Monday,
          or you can make it now.
        </p>
      ) : null}

      {reports.length ? (
        <section className="space-y-2">
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead className="hidden md:table-cell">Report</TableHead>
                  <TableHead>Made</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      <Link href={reportHref(orgSlug, report.id)} className="hover:underline">
                        {formatWeek(report.week) ?? `${report.week.start} – ${report.week.end}`}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden max-w-80 min-w-48 text-[13px] md:table-cell">
                      <Link href={reportHref(orgSlug, report.id)} className="hover:underline">
                        {report.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-[13px] whitespace-nowrap">
                      {madeByShort(report.madeBy, report.createdByName)}
                      <span className="text-muted-foreground block text-xs">
                        {formatDateTime(report.createdAt, timeZone)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DataSourceBadge source={report.dataSource} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-xs">Times in {timeZone}.</p>
        </section>
      ) : (
        <div className="bg-card rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="font-medium">No reports yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-[13px]">
            The first report is made automatically on Monday for the week before.{' '}
            {canMake
              ? 'You can also make last week’s report now.'
              : 'Owners, admins and managers can also make last week’s report on request.'}
          </p>
        </div>
      )}
    </div>
  );
}
