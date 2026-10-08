import { ArrowLeft, Plus, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AddMembersForm, GroupNameForm } from '@/components/benchmarks/group-forms';
import { ProfileLink } from '@/components/dashboard/values';
import { PageHeader } from '@/components/shared/page-header';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BUSINESS_ROLE_LABELS } from '@/lib/accounts/labels';
import { platformsOf } from '@/lib/analytics/benchmark';
import { platformName } from '@/lib/analytics/names';
import type { ProfileRecord } from '@/lib/analytics/types';
import { can } from '@/lib/auth/permissions';
import {
  addBenchmarkGroupMembers,
  createBenchmarkGroup,
  deleteBenchmarkGroup,
  removeBenchmarkGroupMember,
  renameBenchmarkGroup,
} from '@/lib/benchmarks/actions';
import { listBenchmarkGroups, listGroupableProfiles } from '@/lib/benchmarks/queries';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Benchmark groups' };

export default async function BenchmarkGroupsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'strategy.manage');
  const [groups, profiles] = await Promise.all([
    listBenchmarkGroups(org.id),
    listGroupableProfiles(org.id),
  ]);
  const byId = new Map(profiles.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Benchmark groups"
        description="Named sets of monitored profiles, such as “Spain competitors” or “Top creators”. Rank and compare a group on the Benchmarks page."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={`/${orgSlug}/benchmarks`}>
              <ArrowLeft aria-hidden />
              Benchmarks
            </Link>
          </Button>
        }
      />

      {!canManage ? (
        <p className="text-muted-foreground text-[13px]">
          You have read-only access to benchmark groups. Owners, admins and managers can create and
          change them.
        </p>
      ) : null}

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <h2 className="text-base font-semibold">No profiles to group yet</h2>
            <p className="text-muted-foreground mx-auto max-w-lg text-[13px]">
              Groups are made of the profiles Scopie monitors. Add competitors, industry accounts,
              creators or your own profiles first.
            </p>
            {canManage ? (
              <Button asChild size="sm">
                <Link href={`/${orgSlug}/accounts/new`}>
                  <Plus aria-hidden />
                  Accounts → Add profile
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canManage && profiles.length ? (
        <Card>
          <CardHeader>
            <CardTitle>New group</CardTitle>
            <CardDescription>Give it a name, then add profiles to it.</CardDescription>
          </CardHeader>
          <CardContent>
            <GroupNameForm
              action={createBenchmarkGroup.bind(null, orgSlug)}
              submitLabel="Create group"
              idPrefix="new-group"
            />
          </CardContent>
        </Card>
      ) : null}

      {groups.length === 0 && profiles.length ? (
        <p className="text-muted-foreground bg-card rounded-lg border border-dashed px-6 py-10 text-center text-[13px]">
          No benchmark groups yet.
          {canManage
            ? ' Create one above.'
            : ' Ask an owner, admin or manager of this organization to create one.'}
        </p>
      ) : null}

      {groups.map((group) => {
        const members = group.memberIds
          .map((id) => byId.get(id))
          .filter((p): p is ProfileRecord => Boolean(p))
          .sort(
            (a, b) => a.platformKey.localeCompare(b.platformKey) || a.name.localeCompare(b.name),
          );
        const candidates = profiles.filter((p) => p.isActive && !group.memberIds.includes(p.id));
        const options = platformsOf(candidates).map((platform) => ({
          platform: platformName(platform.key),
          profiles: candidates
            .filter((p) => p.platformKey === platform.key)
            .map((p) => ({
              id: p.id,
              label: p.name,
              detail: [
                p.handle ? `@${p.handle.replace(/^@/, '')}` : null,
                BUSINESS_ROLE_LABELS[p.businessRole],
                p.countryCode,
              ]
                .filter(Boolean)
                .join(' · '),
            })),
        }));
        const platforms = platformsOf(members);
        return (
          <Card key={group.id} className="min-w-0">
            <CardHeader>
              <CardTitle>{group.name}</CardTitle>
              <CardDescription>
                {members.length} profile{members.length === 1 ? '' : 's'}
                {platforms.length
                  ? `: ${platforms.map((p) => `${p.count} on ${platformName(p.key)}`).join(', ')}`
                  : ''}
                . Rankings use one platform at a time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {members.length ? (
                <ul className="divide-y rounded-md border">
                  {members.map((profile) => (
                    <li
                      key={profile.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <ProfileLink orgSlug={orgSlug} profile={profile} showRole />
                        {!profile.isActive ? (
                          <span className="text-muted-foreground text-xs italic">
                            {' '}
                            monitoring paused
                          </span>
                        ) : null}
                      </span>
                      {canManage ? (
                        <form action={removeBenchmarkGroupMember.bind(null, orgSlug)}>
                          <input type="hidden" name="groupId" value={group.id} />
                          <input type="hidden" name="accountId" value={profile.id} />
                          <SubmitButton
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${profile.name} from ${group.name}`}
                          >
                            <X aria-hidden />
                            Remove
                          </SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-[13px]">No profiles in this group yet.</p>
              )}

              {canManage ? (
                <div className="space-y-4">
                  {options.length ? (
                    <details className="group rounded-md border px-3 py-2">
                      <summary className="text-primary cursor-pointer text-[13px] font-medium">
                        Add profiles
                      </summary>
                      <div className="pt-3">
                        <AddMembersForm
                          action={addBenchmarkGroupMembers.bind(null, orgSlug)}
                          groupId={group.id}
                          options={options}
                        />
                      </div>
                    </details>
                  ) : null}
                  <details className="rounded-md border px-3 py-2">
                    <summary className="text-primary cursor-pointer text-[13px] font-medium">
                      Rename or delete
                    </summary>
                    <div className="space-y-4 pt-3">
                      <GroupNameForm
                        action={renameBenchmarkGroup.bind(null, orgSlug, group.id)}
                        defaultName={group.name}
                        submitLabel="Rename"
                        idPrefix={`rename-${group.id}`}
                      />
                      <form
                        action={deleteBenchmarkGroup.bind(null, orgSlug)}
                        className="flex flex-wrap items-center gap-3"
                      >
                        <input type="hidden" name="groupId" value={group.id} />
                        <SubmitButton variant="destructive" size="sm">
                          Delete group
                        </SubmitButton>
                        <span className="text-muted-foreground text-xs">
                          The profiles and their data stay; only the group is removed.
                        </span>
                      </form>
                    </div>
                  </details>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
