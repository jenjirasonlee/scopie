import { CheckCircle2, Circle, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CONNECTION_STATUS_LABELS, type ConnectionStatus } from '@/lib/accounts/labels';
import { getAccountSummary, listCountries, listPlatforms } from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const [summary, countries, platforms] = await Promise.all([
    getAccountSummary(org.id),
    listCountries(),
    listPlatforms(),
  ]);
  const countryName = new Map(countries.map((country) => [country.code, country.name]));
  const platformName = new Map(platforms.map((platform) => [platform.key, platform.name]));
  const withCountry = summary.byCountry.filter((row) => row.code !== null).length;
  const missingCountry = summary.byCountry.find((row) => row.code === null)?.count ?? 0;

  const tiles = [
    { label: 'Social accounts', value: summary.total, note: `${summary.inactive} inactive` },
    { label: 'Active accounts', value: summary.active, note: 'Included in future analytics' },
    {
      label: 'Countries',
      value: withCountry,
      note: missingCountry
        ? `${missingCountry} account(s) without a country`
        : 'All accounts assigned',
    },
    { label: 'Platforms', value: summary.byPlatform.length, note: 'With at least one account' },
  ];

  const checklist = [
    { done: true, label: 'Create your organization' },
    { done: summary.total > 0, label: 'Add your social accounts', href: `/${orgSlug}/accounts` },
    {
      done: summary.total > 0 && missingCountry === 0,
      label: 'Assign a country to every account',
      href: `/${orgSlug}/accounts`,
    },
    {
      done: (summary.byConnection.connected ?? 0) > 0,
      label: 'Connect Instagram and Facebook',
      href: `/${orgSlug}/settings/connections`,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Overview of ${org.name}.`}
        actions={
          can(role, 'accounts.manage') ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/${orgSlug}/accounts/new`}>Add account</Link>
            </Button>
          ) : null
        }
      />

      <Alert variant="info">
        <Info aria-hidden />
        <AlertTitle>Performance analytics aren&apos;t available yet</AlertTitle>
        <AlertDescription>
          Scopie now collects data from connected Instagram and Facebook accounts and from CSV
          imports. Charts of reach, engagement and followers arrive with the analytics dashboard
          (Phase 3). Scopie never shows estimated or sample numbers in their place.
        </AlertDescription>
      </Alert>

      <section
        aria-label="Account overview"
        className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-4"
      >
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-card px-5 py-4">
            <p className="text-muted-foreground text-xs font-medium">{tile.label}</p>
            <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{tile.value}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{tile.note}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Accounts by country</CardTitle>
            <CardDescription>Count of social accounts, all statuses.</CardDescription>
          </CardHeader>
          <BreakdownTable
            emptyLabel="No accounts yet."
            rows={summary.byCountry.map((row) => ({
              key: row.code ?? 'none',
              label: row.code ? (countryName.get(row.code) ?? row.code) : 'No country',
              count: row.count,
            }))}
            total={summary.total}
            column="Country"
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accounts by platform</CardTitle>
            <CardDescription>Count of social accounts, all statuses.</CardDescription>
          </CardHeader>
          <BreakdownTable
            emptyLabel="No accounts yet."
            rows={summary.byPlatform.map((row) => ({
              key: row.key,
              label: (
                <span className="inline-flex items-center gap-2">
                  <PlatformMark platformKey={row.key} />
                  {platformName.get(row.key) ?? row.key}
                </span>
              ),
              count: row.count,
            }))}
            total={summary.total}
            column="Platform"
          />
          {summary.total > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-t px-5 py-3">
              {Object.entries(summary.byConnection).map(([status, count]) => (
                <Badge key={status} variant={status === 'demo' ? 'demo' : 'muted'}>
                  {CONNECTION_STATUS_LABELS[status as ConnectionStatus]}: {count}
                </Badge>
              ))}
            </div>
          ) : null}
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5 text-[13px]">
                  {item.done ? (
                    <CheckCircle2
                      className="text-success mt-px size-4 shrink-0"
                      aria-label="Done"
                    />
                  ) : (
                    <Circle
                      className="text-muted-foreground/60 mt-px size-4 shrink-0"
                      aria-label="Not done"
                    />
                  )}
                  <span className={item.done ? 'text-muted-foreground' : undefined}>
                    {item.href && !item.done ? (
                      <Link href={item.href} className="text-primary font-medium hover:underline">
                        {item.label}
                      </Link>
                    ) : (
                      item.label
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BreakdownTable({
  rows,
  total,
  column,
  emptyLabel,
}: {
  rows: { key: string; label: React.ReactNode; count: number }[];
  total: number;
  column: string;
  emptyLabel: string;
}) {
  if (!rows.length) {
    return <p className="text-muted-foreground px-5 py-6 text-[13px]">{emptyLabel}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{column}</TableHead>
          <TableHead className="w-24 text-right">Accounts</TableHead>
          <TableHead className="w-40">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const share = total ? Math.round((row.count / total) * 100) : 0;
          return (
            <TableRow key={row.key}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="tabular text-right">{row.count}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="bg-muted h-1.5 flex-1 rounded-full">
                    <div
                      className="bg-primary/70 h-1.5 rounded-full"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <span className="tabular text-muted-foreground w-9 text-right text-xs">
                    {share}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
