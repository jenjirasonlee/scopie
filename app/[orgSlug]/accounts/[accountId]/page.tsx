import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AccountForm } from '@/components/accounts/account-form';
import { ActiveToggle } from '@/components/accounts/active-toggle';
import { ConnectionStatusBadge } from '@/components/accounts/connection-status-badge';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { updateSocialAccount } from '@/lib/accounts/actions';
import { getAccountFormOptions } from '@/lib/accounts/form-options';
import {
  ACCESS_TYPE_HELP,
  ACCESS_TYPE_LABELS,
  BUSINESS_ROLE_LABELS,
  CONNECTION_STATUS_HELP,
} from '@/lib/accounts/labels';
import { getAccount } from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';
import { getAccountPipeline, getObservationHistory, listRecentPosts } from '@/lib/pipeline/queries';
import {
  ObservationHistoryCard,
  RecentPosts,
  SyncCard,
} from '@/components/pipeline/account-data-panels';
import { RemoveProfileCard } from '@/components/public-data/remove-profile-card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug, accountId }, search] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(accountId).success) notFound();
  const { org, role } = await getOrgContext(orgSlug);
  const [account, options, pipeline, posts, history] = await Promise.all([
    getAccount(org.id, accountId),
    getAccountFormOptions(org.id),
    getAccountPipeline(org.id, accountId),
    listRecentPosts(org.id, accountId),
    getObservationHistory(org.id, accountId),
  ]);
  if (!account) notFound();
  const canManage = can(role, 'accounts.manage');
  const platformLabel =
    options.platforms.find((p) => p.value === account.platform_key)?.label ?? account.platform_key;
  const countryLabel = options.countries.find((c) => c.value === account.country_code)?.label;
  const ownerLabel = options.members.find((m) => m.value === account.owner_user_id)?.label;

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.display_name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <PlatformMark platformKey={account.platform_key} />
            {platformLabel}
            {account.handle ? <span>· @{account.handle}</span> : null}
            <Badge variant="outline">{BUSINESS_ROLE_LABELS[account.business_role]}</Badge>
            <Badge variant={account.is_active ? 'success' : 'muted'}>
              {account.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </span>
        }
        actions={
          canManage ? (
            <ActiveToggle
              orgSlug={orgSlug}
              accountId={account.id}
              isActive={account.is_active}
              size="default"
            />
          ) : null
        }
      />

      {search.added === '1' ? (
        <Alert variant="success">
          <AlertDescription>
            Added. Scopie makes its first observation on the next sync; history starts then.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <ObservationHistoryCard history={history} />
          <RecentPosts posts={posts} publicOnly={account.access_type !== 'connected'} />
          {canManage ? (
            <AccountForm
              action={updateSocialAccount.bind(null, orgSlug, account.id)}
              submitLabel="Save changes"
              cancelHref={`/${orgSlug}/accounts`}
              defaults={{
                platformKey: account.platform_key,
                displayName: account.display_name,
                handle: account.handle,
                externalId: account.external_id,
                accountType: account.account_type,
                countryCode: account.country_code,
                language: account.language,
                timezone: account.timezone,
                ownerUserId: account.owner_user_id,
                businessRole: account.business_role,
                notes: account.notes,
              }}
              {...options}
            />
          ) : (
            <Card>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                  <Detail label="Country" value={countryLabel} />
                  <Detail label="Language" value={account.language} />
                  <Detail label="Timezone" value={account.timezone ?? 'Organization default'} />
                  <Detail label="Account type" value={account.account_type} />
                  <Detail label="Owner" value={ownerLabel} />
                  <Detail label="Platform account ID" value={account.external_id} />
                  <Detail label="Notes" value={account.notes} />
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-[13px]">
              <ConnectionStatusBadge status={account.connection_status} />
              <p className="text-muted-foreground">
                {CONNECTION_STATUS_HELP[account.connection_status]}
              </p>
              <dl className="grid grid-cols-2 gap-y-2 border-t pt-3">
                <dt className="text-muted-foreground">Access</dt>
                <dd title={ACCESS_TYPE_HELP[account.access_type]}>
                  {ACCESS_TYPE_LABELS[account.access_type]}
                </dd>
                <dt className="text-muted-foreground">Last successful sync</dt>
                <dd>
                  {account.last_successful_sync_at
                    ? new Date(account.last_successful_sync_at).toLocaleString('en-GB')
                    : 'Never'}
                </dd>
              </dl>
            </CardContent>
          </Card>
          <SyncCard
            orgSlug={orgSlug}
            account={account}
            runs={pipeline.runs}
            earliestPostAt={pipeline.earliestPostAt}
            canManage={canManage}
          />
          {canManage ? (
            <RemoveProfileCard
              orgSlug={orgSlug}
              accountId={account.id}
              name={account.display_name}
              status={typeof search.remove === 'string' ? search.remove : null}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value || '—'}</dd>
    </div>
  );
}
