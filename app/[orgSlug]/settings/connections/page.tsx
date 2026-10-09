import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { LinkAssetForm } from '@/components/connections/link-asset-form';
import { SyncStatusBadge } from '@/components/pipeline/sync-status-badge';
import { SubmitButton } from '@/components/shared/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SYNC_JOB_LABELS } from '@/lib/accounts/labels';
import { listAccounts } from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import { formatDateTime } from '@/lib/content/review';
import { disconnectConnection, linkAsset, unlinkAccount } from '@/lib/connections/actions';
import { listConnections } from '@/lib/connections/queries';
import { getOrgContext } from '@/lib/orgs/queries';
import { listRecentRuns } from '@/lib/pipeline/queries';
import { META_SCOPES } from '@/lib/platforms/meta/oauth';
import { pipelineSetupGaps } from '@/lib/server-env';

export const metadata: Metadata = { title: 'Connections' };

const ERRORS: Record<string, string> = {
  state: 'The connection attempt expired or did not match. Please try again.',
  denied: 'Meta did not grant access. Nothing was connected.',
  permission: 'Only owners and admins can connect platforms.',
  not_configured: 'The Meta connection is not set up on this server yet.',
  meta: 'Meta returned an error while connecting. Please try again.',
};

const CONNECTION_VARIANT = {
  active: 'success',
  needs_reauth: 'warning',
  revoked: 'muted',
  error: 'destructive',
} as const;

const CONNECTION_LABEL = {
  active: 'Active',
  needs_reauth: 'Needs reconnect',
  revoked: 'Disconnected',
  error: 'Error',
} as const;

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'accounts.manage');
  const [{ connections, assets }, accounts, runs] = await Promise.all([
    listConnections(org.id),
    listAccounts(org.id, { status: 'active', group: 'none' }),
    listRecentRuns(org.id),
  ]);
  const gaps = pipelineSetupGaps();
  const error = typeof search.error === 'string' ? ERRORS[search.error] : undefined;
  const connected = typeof search.connected === 'string' ? Number(search.connected) : null;
  const linked = typeof search.linked === 'string' ? Number(search.linked) : 0;
  const missing = typeof search.missing === 'string' ? search.missing.split(',') : [];
  const accountName = new Map(accounts.map((account) => [account.id, account.display_name]));
  const live = connections.filter((connection) => connection.status !== 'revoked');

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Connections</h2>
        <p className="text-muted-foreground text-[13px]">
          Connect a Meta login that manages your Facebook Pages and Instagram business accounts.
          Scopie only reads data; it never posts or changes anything. Tokens are stored encrypted on
          the server and never sent to the browser.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {connected !== null && !error ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertDescription>
            Connected. Found {connected} account{connected === 1 ? '' : 's'}
            {linked ? ` and linked ${linked} automatically` : ''}.
            {missing.length ? ` Some permissions were not granted: ${missing.join(', ')}.` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {org.is_demo ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>
            This is the DEMO organization. Its accounts hold generated DEMO DATA and can&apos;t be
            connected to real platforms. Create your own organization to connect real accounts.
          </AlertDescription>
        </Alert>
      ) : gaps.length ? (
        <Alert variant="warning">
          <Info aria-hidden />
          <AlertDescription>
            Connecting to Meta isn&apos;t set up on this server yet. Missing: {gaps.join(', ')}. The
            setup steps are in docs/API_INTEGRATIONS.md. CSV import works without it.
          </AlertDescription>
        </Alert>
      ) : canManage ? (
        <div>
          <Button asChild>
            <a href={`/api/connections/meta/start?org=${encodeURIComponent(orgSlug)}`}>
              {live.length ? 'Connect another Meta login' : 'Connect with Meta'}
            </a>
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Only owners and admins can connect platforms.
        </p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">What Scopie asks Meta for</h3>
        <dl className="bg-card divide-y rounded-lg border text-[13px]">
          {META_SCOPES.map((entry) => (
            <div
              key={entry.scope}
              className="grid gap-1 px-4 py-2 sm:grid-cols-[220px_1fr] sm:gap-3"
            >
              <dt className="font-mono text-xs">{entry.scope}</dt>
              <dd className="text-muted-foreground">{entry.purpose}</dd>
            </div>
          ))}
        </dl>
      </div>

      {connections.map((connection) => {
        const connectionAssets = assets.filter((asset) => asset.connection_id === connection.id);
        return (
          <div key={connection.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">
                  Meta · {connection.display_name ?? 'Meta login'}
                </h3>
                <Badge variant={CONNECTION_VARIANT[connection.status]}>
                  {CONNECTION_LABEL[connection.status]}
                </Badge>
              </div>
              {canManage && connection.status !== 'revoked' ? (
                <form action={disconnectConnection.bind(null, orgSlug)}>
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <SubmitButton variant="ghost" size="sm" pendingLabel="Disconnecting…">
                    Disconnect
                  </SubmitButton>
                </form>
              ) : null}
            </div>
            {connection.status === 'needs_reauth' ? (
              <p className="text-warning-foreground text-[13px]">
                Meta stopped accepting this login. Connect with Meta again using the same Facebook
                user to resume syncing.
              </p>
            ) : null}
            {connection.status !== 'revoked' ? (
              connectionAssets.length ? (
                <div className="bg-card overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Platform account</TableHead>
                        <TableHead>Scopie account</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {connectionAssets.map((asset) => {
                        const label = asset.handle
                          ? `@${asset.handle}`
                          : (asset.name ?? asset.external_id);
                        const candidates = accounts
                          .filter(
                            (account) =>
                              account.platform_key === asset.platform_key &&
                              account.business_role === 'owned' &&
                              !account.connection_id,
                          )
                          .map((account) => ({
                            value: account.id,
                            label: account.handle
                              ? `${account.display_name} (@${account.handle})`
                              : account.display_name,
                          }));
                        return (
                          <TableRow key={asset.id}>
                            <TableCell>
                              <span className="inline-flex items-center gap-2">
                                <PlatformMark platformKey={asset.platform_key} />
                                {label}
                              </span>
                            </TableCell>
                            <TableCell>
                              {asset.linked_account_id ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link
                                    className="hover:underline"
                                    href={`/${orgSlug}/accounts/${asset.linked_account_id}`}
                                  >
                                    {accountName.get(asset.linked_account_id) ?? 'Linked account'}
                                  </Link>
                                  {canManage ? (
                                    <form action={unlinkAccount.bind(null, orgSlug)}>
                                      <input
                                        type="hidden"
                                        name="accountId"
                                        value={asset.linked_account_id}
                                      />
                                      <SubmitButton variant="ghost" size="sm">
                                        Unlink
                                      </SubmitButton>
                                    </form>
                                  ) : null}
                                </div>
                              ) : canManage && connection.status === 'active' ? (
                                <LinkAssetForm
                                  action={linkAsset.bind(null, orgSlug)}
                                  assetId={asset.id}
                                  assetLabel={label}
                                  accounts={candidates}
                                />
                              ) : (
                                <span className="text-muted-foreground">Not linked</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-muted-foreground text-[13px]">
                  This login can&apos;t see any Pages or Instagram business accounts.
                </p>
              )
            ) : null}
          </div>
        );
      })}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Sync health</h3>
        {runs.length ? (
          <div className="bg-card overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{run.social_accounts?.display_name ?? '—'}</TableCell>
                    <TableCell>{SYNC_JOB_LABELS[run.job_type]}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <SyncStatusBadge status={run.status} />
                        {run.error_message ? (
                          <span
                            className="text-muted-foreground max-w-72 truncate text-xs"
                            title={run.error_message}
                          >
                            {run.error_message}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {run.records_processed}
                      {run.records_failed ? ` (${run.records_failed} failed)` : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(run.completed_at ?? run.queued_at, org.default_timezone)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-[13px]">No syncs have run yet.</p>
        )}
      </div>
    </section>
  );
}
