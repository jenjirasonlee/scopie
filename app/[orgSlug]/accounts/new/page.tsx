import { ChevronDown, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountForm } from '@/components/accounts/account-form';
import { AddPublicProfile } from '@/components/public-data/add-public-profile';
import { BulkAddProfiles } from '@/components/public-data/bulk-add-profiles';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { createSocialAccount } from '@/lib/accounts/actions';
import { getAccountFormOptions } from '@/lib/accounts/form-options';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';
import {
  addPublicProfile,
  addPublicProfilesInBulk,
  lookupPublicProfile,
  searchPublicProfiles,
} from '@/lib/public-data/actions';
import { PUBLIC_PROFILE_PLATFORMS, type PublicProfilePlatform } from '@/lib/public-data/shared';
import { getPublicDataViewer } from '@/lib/public-data/queries';
import { publicDataSetup } from '@/lib/public-data/setup';
import { serverEnv } from '@/lib/server-env';

export const metadata: Metadata = { title: 'Add profile' };

export default async function NewAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
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

  const initialPlatform =
    typeof search.platform === 'string' && search.platform in PUBLIC_PROFILE_PLATFORMS
      ? (search.platform as PublicProfilePlatform)
      : 'instagram';
  const settings = (text: string) => (
    <Link className="underline" href={`/${orgSlug}/settings/public-data`}>
      {text}
    </Link>
  );
  const setupNote: Partial<Record<PublicProfilePlatform, React.ReactNode>> = org.is_demo
    ? {}
    : {
        instagram: !setup.instagram ? undefined : viewer || setup.instagram.includes('Meta app') ? (
          <>
            Scopie can&apos;t read Instagram yet: the Meta app isn&apos;t set up on the server
            (go-live guide, step 8). You can still add profiles now; their numbers appear once
            it&apos;s done.
          </>
        ) : (
          <>
            Scopie can&apos;t read Instagram yet: {settings('choose a viewer account')} first. You
            can still add profiles now; their numbers appear once it&apos;s done.
          </>
        ),
        youtube: setup.youtube ? (
          <>
            Scopie can&apos;t read YouTube yet: the YouTube key isn&apos;t set up on the server
            (go-live guide, step 9). You can still add channels by link now.
          </>
        ) : undefined,
        x: setup.x ? (
          <>
            Scopie can&apos;t read X yet: the X key isn&apos;t set up on the server (go-live guide,
            step 10). You can still add profiles now.
          </>
        ) : undefined,
      };

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add profile"
        description="Track any public Instagram, YouTube, X or Bluesky profile, including competitors. They don't need to approve anything."
      />

      {org.is_demo ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>
            This is the DEMO organization. Its profiles hold generated DEMO DATA; live public data
            is only read in your own organization.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <AddPublicProfile
            lookupAction={lookupPublicProfile.bind(null, orgSlug)}
            addAction={addPublicProfile.bind(null, orgSlug)}
            searchAction={searchPublicProfiles.bind(null, orgSlug)}
            countries={options.countries}
            initialPlatform={initialPlatform}
            ready={{
              instagram: !setup.instagram && !org.is_demo,
              youtube: !setup.youtube && !org.is_demo,
              x: !setup.x && !org.is_demo,
              bluesky: !setup.bluesky && !org.is_demo,
            }}
            setupNote={setupNote}
          />
        </CardContent>
      </Card>

      <details className="group bg-card rounded-lg border">
        <summary className="hover:bg-secondary/50 flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 py-4">
          <span>
            <span className="block text-sm font-medium">Add several profiles at once</span>
            <span className="text-muted-foreground block text-[13px]">
              Paste a list of usernames or upload a CSV, one platform at a time.
            </span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t px-5 py-5">
          <BulkAddProfiles action={addPublicProfilesInBulk.bind(null, orgSlug)} />
        </div>
      </details>

      <details className="group bg-card rounded-lg border">
        <summary className="hover:bg-secondary/50 flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 py-4">
          <span>
            <span className="block text-sm font-medium">
              Facebook, LinkedIn, TikTok and other platforms
            </span>
            <span className="text-muted-foreground block text-[13px]">
              These platforms don&apos;t share public data with apps. Add the profile here and fill
              it with a CSV export or, for your own accounts, a connection.
            </span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t px-5 py-5">
          <AccountForm
            action={createSocialAccount.bind(null, orgSlug)}
            submitLabel="Add profile"
            cancelHref={`/${orgSlug}/accounts`}
            {...options}
          />
        </div>
      </details>
    </div>
  );
}
