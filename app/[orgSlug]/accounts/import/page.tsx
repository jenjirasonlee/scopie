import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import { ImportForm } from '@/components/pipeline/import-form';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IMPORT_STATUS_LABELS } from '@/lib/accounts/labels';
import { listAccounts, listPlatforms } from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import { formatDateTime } from '@/lib/content/review';
import { importCsv } from '@/lib/imports/actions';
import { TEMPLATES } from '@/lib/imports/templates';
import { getOrgContext } from '@/lib/orgs/queries';
import { listImportBatches } from '@/lib/pipeline/queries';

export const metadata: Metadata = { title: 'Import data' };

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'accounts.manage');
  const [accounts, platforms, batches] = await Promise.all([
    listAccounts(org.id, { status: 'active', group: 'none' }),
    listPlatforms(),
    listImportBatches(org.id),
  ]);
  const platformName = new Map(platforms.map((platform) => [platform.key, platform.name]));
  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: `${account.display_name} · ${platformName.get(account.platform_key) ?? account.platform_key}`,
  }));
  const preselect = typeof search.account === 'string' ? search.account : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import data"
        description="Upload metrics exported from a platform as CSV. Imported numbers are labelled “Imported” everywhere, so they're never mistaken for live data."
      />

      {canManage ? (
        <Card>
          <CardContent className="pt-6">
            <ImportForm
              action={importCsv.bind(null, orgSlug)}
              accounts={accountOptions}
              defaultAccountId={preselect}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Only owners and admins can import data. You can see past imports below.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {Object.entries(TEMPLATES).map(([kind, template]) => (
          <Card key={kind}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>{template.title}</CardTitle>
              <a
                className="text-primary inline-flex items-center gap-1 text-[13px] hover:underline"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(template.example)}`}
                download={`scopie-${kind.replace('_', '-')}-example.csv`}
              >
                <Download className="size-3.5" aria-hidden />
                Example CSV
              </a>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-[13px]">
                {template.columns.map((column) => (
                  <div key={column.name} className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
                    <dt className="font-mono text-xs">
                      {column.name}
                      {column.required ? <span className="text-destructive"> *</span> : null}
                    </dt>
                    <dd className="text-muted-foreground">{column.description}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-muted-foreground mt-3 text-xs">
                Leave a cell empty when a number isn&apos;t known. Empty is stored as “not
                provided”, never as zero. Common export names such as “Post link”, “Clicks” and
                “Reposts” are recognised.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Import history</h2>
        {batches.length ? (
          <div className="bg-card overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="max-w-56 truncate">{batch.file_name}</TableCell>
                    <TableCell>{batch.social_accounts?.display_name ?? '—'}</TableCell>
                    <TableCell>
                      {batch.rows_imported} of {batch.rows_total}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          batch.status === 'completed'
                            ? 'success'
                            : batch.status === 'failed'
                              ? 'destructive'
                              : 'warning'
                        }
                      >
                        {IMPORT_STATUS_LABELS[batch.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(batch.created_at, org.default_timezone)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-[13px]">No imports yet.</p>
        )}
      </section>
    </div>
  );
}
