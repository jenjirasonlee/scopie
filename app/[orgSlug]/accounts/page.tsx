import { CheckCircle2, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActiveToggle } from '@/components/accounts/active-toggle';
import { ConnectionStatusBadge } from '@/components/accounts/connection-status-badge';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { parseAccountFilters } from '@/lib/accounts/filters';
import { groupByCountry } from '@/lib/accounts/grouping';
import {
  listAccounts,
  listCountries,
  listPlatforms,
  type SocialAccountListItem,
} from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Accounts' };

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, rawSearch] = await Promise.all([params, searchParams]);
  const filters = parseAccountFilters(rawSearch);
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'accounts.manage');
  const [accounts, platforms, countries] = await Promise.all([
    listAccounts(org.id, filters),
    listPlatforms(),
    listCountries(),
  ]);
  const countryName = new Map(countries.map((country) => [country.code, country.name]));
  const platformName = new Map(platforms.map((platform) => [platform.key, platform.name]));
  const groups =
    filters.group === 'country'
      ? groupByCountry(accounts, countryName)
      : [{ key: 'all', label: '', accounts }];
  const isFiltered = Boolean(
    filters.q || filters.platform || filters.country || filters.status !== 'active',
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounts"
        description="Social accounts in this organization, grouped by country. Accounts are added manually for now; platform connections arrive in Phase 4."
        actions={
          canManage ? (
            <Button asChild>
              <Link href={`/${orgSlug}/accounts/new`}>
                <Plus aria-hidden />
                Add account
              </Link>
            </Button>
          ) : null
        }
      />

      {rawSearch.created ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertDescription>
            Account added. It shows as “Not connected” until a platform connector exists.
          </AlertDescription>
        </Alert>
      ) : null}

      {!canManage ? (
        <p className="text-muted-foreground text-[13px]">
          You have read-only access to accounts. Owners and admins can add or edit them.
        </p>
      ) : null}

      <form className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter accounts">
        <div className="w-full sm:w-56">
          <label htmlFor="q" className="sr-only">
            Search
          </label>
          <Input id="q" name="q" placeholder="Search name or handle" defaultValue={filters.q} />
        </div>
        <FilterSelect
          name="platform"
          label="Platform"
          value={filters.platform}
          allLabel="All platforms"
          options={platforms.map((platform) => ({ value: platform.key, label: platform.name }))}
        />
        <FilterSelect
          name="country"
          label="Country"
          value={filters.country}
          allLabel="All countries"
          options={countries.map((country) => ({ value: country.code, label: country.name }))}
        />
        <FilterSelect
          name="status"
          label="Status"
          value={filters.status}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'all', label: 'All statuses' },
          ]}
        />
        <FilterSelect
          name="group"
          label="Grouping"
          value={filters.group}
          options={[
            { value: 'country', label: 'Group by country' },
            { value: 'none', label: 'No grouping' },
          ]}
        />
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {isFiltered ? (
          <Button asChild variant="ghost">
            <Link href={`/${orgSlug}/accounts`}>Reset</Link>
          </Button>
        ) : null}
        <p className="text-muted-foreground tabular ml-auto self-center text-xs">
          {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
        </p>
      </form>

      {accounts.length === 0 ? (
        <div className="bg-card rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="font-medium">
            {isFiltered ? 'No accounts match these filters.' : 'No social accounts yet.'}
          </p>
          <p className="text-muted-foreground mt-1 text-[13px]">
            {isFiltered
              ? 'Try another filter or reset them.'
              : 'Add each of your social accounts with its platform and country.'}
          </p>
          {!isFiltered && canManage ? (
            <Button asChild className="mt-4">
              <Link href={`/${orgSlug}/accounts/new`}>Add your first account</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="bg-card overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <GroupRows
                  key={group.key}
                  label={group.label}
                  accounts={group.accounts}
                  orgSlug={orgSlug}
                  canManage={canManage}
                  platformName={platformName}
                  countryName={countryName}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function GroupRows({
  label,
  accounts,
  orgSlug,
  canManage,
  platformName,
  countryName,
}: {
  label: string;
  accounts: SocialAccountListItem[];
  orgSlug: string;
  canManage: boolean;
  platformName: Map<string, string>;
  countryName: Map<string, string>;
}) {
  return (
    <>
      {label ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={canManage ? 9 : 8} className="py-1.5 text-xs font-semibold">
            {label}{' '}
            <span className="text-muted-foreground ml-1 font-normal">{accounts.length}</span>
          </TableCell>
        </TableRow>
      ) : null}
      {accounts.map((account) => (
        <TableRow
          key={account.id}
          className={account.is_active ? undefined : 'text-muted-foreground'}
        >
          <TableCell>
            <Link href={`/${orgSlug}/accounts/${account.id}`} className="group flex flex-col">
              <span className="text-foreground font-medium group-hover:underline">
                {account.display_name}
              </span>
              <span className="text-muted-foreground text-xs">
                {account.handle ? `@${account.handle}` : 'No handle'}
                {account.is_competitor ? ' · Competitor' : ''}
              </span>
            </Link>
          </TableCell>
          <TableCell>
            <span className="inline-flex items-center gap-2">
              <PlatformMark platformKey={account.platform_key} />
              {platformName.get(account.platform_key) ?? account.platform_key}
            </span>
          </TableCell>
          <TableCell>
            {account.country_code
              ? (countryName.get(account.country_code) ?? account.country_code)
              : '—'}
          </TableCell>
          <TableCell>{account.language ?? '—'}</TableCell>
          <TableCell>{account.owner?.full_name ?? account.owner?.email ?? '—'}</TableCell>
          <TableCell>
            <ConnectionStatusBadge status={account.connection_status} />
          </TableCell>
          <TableCell className="text-muted-foreground">
            {account.last_successful_sync_at
              ? new Date(account.last_successful_sync_at).toLocaleString('en-GB')
              : 'Never'}
          </TableCell>
          <TableCell>
            <Badge variant={account.is_active ? 'success' : 'muted'}>
              {account.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </TableCell>
          {canManage ? (
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/${orgSlug}/accounts/${account.id}`}>Edit</Link>
                </Button>
                <ActiveToggle
                  orgSlug={orgSlug}
                  accountId={account.id}
                  isActive={account.is_active}
                />
              </div>
            </TableCell>
          ) : null}
        </TableRow>
      ))}
    </>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <div className="w-[calc(50%-0.25rem)] sm:w-44">
      <label htmlFor={`filter-${name}`} className="sr-only">
        {label}
      </label>
      <NativeSelect id={`filter-${name}`} name={name} defaultValue={value ?? ''}>
        {allLabel ? <option value="">{allLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
