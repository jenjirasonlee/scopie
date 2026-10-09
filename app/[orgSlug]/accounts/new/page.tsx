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
import { publicDataSetup } from '@/lib/public-data/setup';
import { serverEnv } from '@/lib/server-env';

export const metadata: Metadata = { title: 'Add profile' };

export default async function NewAccountPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const [options, viewer] = await Promise.all([
    getAccountFormOptions(org.id),
    getPublicDataViewer(org.id),
  ]);
  const setup = publicDataSetup(serverEnv(), Boolean(viewer));

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
        description="Track public profiles on Instagram, YouTube, X and Bluesky, including competitors. The owner doesn't need to approve anything."
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
            You can add Instagram profiles now, but Scopie can only read them once you{' '}
            <Link className="underline" href={`/${orgSlug}/settings/public-data`}>
              choose a viewer account
            </Link>
            . Instagram previews are switched off until then.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Public profile</CardTitle>
          <CardDescription>
            Read through each platform&apos;s official API: Instagram with your viewer account,
            YouTube and X with a key on the server, Bluesky with no key. Only public numbers are
            collected.{' '}
            <Link className="underline" href={`/${orgSlug}/settings/public-data`}>
              Which platforms have public data
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddPublicProfile
            lookupAction={lookupPublicProfile.bind(null, orgSlug)}
            addAction={addPublicProfile.bind(null, orgSlug)}
            countries={options.countries}
            canPreview={{
              instagram: !setup.instagram && !org.is_demo,
              youtube: !setup.youtube && !org.is_demo,
              x: !setup.x && !org.is_demo,
              bluesky: !setup.bluesky && !org.is_demo,
            }}
            setupNote={
              org.is_demo
                ? undefined
                : {
                    youtube: setup.youtube
                      ? `${setup.youtube} You can add channels now; they are read once it is set.`
                      : undefined,
                    x: setup.x
                      ? `${setup.x} You can add profiles now; they are read once it is set.`
                      : undefined,
                  }
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add several profiles</CardTitle>
          <CardDescription>
            Paste a list or upload a CSV, for one platform at a time. Each profile is checked on its
            first sync; profiles the platform can&apos;t read (for example personal Instagram or
            protected X accounts) are flagged then.
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
            For your own accounts you will connect, and for platforms without public data in Scopie
            (Facebook, LinkedIn, TikTok, Threads, Pinterest, Reddit). Their data comes from a
            connection or CSV import.
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
