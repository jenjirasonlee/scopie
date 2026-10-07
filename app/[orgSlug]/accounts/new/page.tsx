import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountForm } from '@/components/accounts/account-form';
import { AddPublicProfile } from '@/components/public-data/add-public-profile';
import { BulkAddProfiles } from '@/components/public-data/bulk-add-profiles';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createSocialAccount } from '@/lib/accounts/actions';
import { getAccountFormOptions } from '@/lib/accounts/form-options';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';
import {
  addPublicProfile,
  addPublicProfilesInBulk,
  lookupPublicProfile,
} from '@/lib/public-data/actions';
import { getPublicDataViewer } from '@/lib/public-data/queries';
import { serverEnv } from '@/lib/server-env';

export const metadata: Metadata = { title: 'Add profile' };

export default async function NewAccountPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const [options, viewer] = await Promise.all([
    getAccountFormOptions(org.id),
    getPublicDataViewer(org.id),
  ]);

  if (!can(role, 'accounts.manage')) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Add profile" />
        <Alert>
          <AlertDescription>Only owners and admins can add profiles.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add profile"
        description="Track any public Instagram business or creator account, including competitors. The owner doesn't need to approve anything."
      />

      {org.is_demo ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>
            This is the DEMO organization. Its profiles hold generated DEMO DATA; live public data
            is only read in your own organization.
          </AlertDescription>
        </Alert>
      ) : !viewer ? (
        <Alert variant="warning">
          <Info aria-hidden />
          <AlertDescription>
            You can add profiles now, but Scopie can only read them once you{' '}
            <Link className="underline" href={`/${orgSlug}/settings/public-data`}>
              choose a viewer account
            </Link>
            . Previews are switched off until then.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Public Instagram profile or YouTube channel</CardTitle>
          <CardDescription>
            Read through Instagram&apos;s official API with your viewer account. Only public numbers
            are collected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddPublicProfile
            lookupAction={lookupPublicProfile.bind(null, orgSlug)}
            addAction={addPublicProfile.bind(null, orgSlug)}
            countries={options.countries}
            canPreview={{
              instagram: Boolean(viewer) && !org.is_demo,
              youtube: Boolean(serverEnv().YOUTUBE_API_KEY) && !org.is_demo,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add several profiles</CardTitle>
          <CardDescription>
            Paste a list or upload a CSV. Each profile is checked on its first sync; profiles
            Instagram can&apos;t read (personal or age-restricted accounts) are flagged then.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BulkAddProfiles action={addPublicProfilesInBulk.bind(null, orgSlug)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Any other profile</CardTitle>
          <CardDescription>
            For your own accounts you will connect, and for platforms without an official public API
            yet (LinkedIn, TikTok, X). Their data comes from a connection or CSV import.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccountForm
            action={createSocialAccount.bind(null, orgSlug)}
            submitLabel="Add profile"
            cancelHref={`/${orgSlug}/accounts`}
            {...options}
          />
        </CardContent>
      </Card>
    </div>
  );
}
