import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ViewerForm } from '@/components/public-data/viewer-form';
import { SubmitButton } from '@/components/shared/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { can } from '@/lib/auth/permissions';
import { listConnections } from '@/lib/connections/queries';
import { getOrgContext } from '@/lib/orgs/queries';
import { clearPublicDataViewer, setPublicDataViewer } from '@/lib/public-data/actions';
import { getPublicDataViewer } from '@/lib/public-data/queries';
import { LOOKUPS_PER_HOUR } from '@/lib/public-data/shared';

export const metadata: Metadata = { title: 'Public data' };

export default async function PublicDataPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'accounts.manage');
  const [viewer, { connections, assets }] = await Promise.all([
    getPublicDataViewer(org.id),
    listConnections(org.id),
  ]);
  const active = new Set(connections.filter((c) => c.status === 'active').map((c) => c.id));
  const options = assets
    .filter((asset) => asset.platform_key === 'instagram' && active.has(asset.connection_id))
    .map((asset) => ({
      value: asset.id,
      label: asset.handle ? `@${asset.handle}` : (asset.name ?? asset.external_id),
    }));

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Public data</h2>
        <p className="text-muted-foreground text-[13px]">
          Scopie reads public Instagram profiles, such as competitors, through Instagram&apos;s
          official Business Discovery API. Meta requires the request to come from one Instagram
          professional account of yours: the <strong>viewer account</strong>. It can be any business
          or creator account you control, for example a research account. It does not need to be a
          CANNA brand account, and the profiles you track approve nothing.
        </p>
      </div>

      {org.is_demo ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>
            This is the DEMO organization. It shows generated DEMO DATA and reads nothing live.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="bg-card space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Viewer account</h3>
          {viewer ? (
            <Badge variant={viewer.connectionStatus === 'active' ? 'success' : 'warning'}>
              {viewer.connectionStatus === 'active' ? 'Active' : 'Needs reconnect'}
            </Badge>
          ) : (
            <Badge variant="muted">Not chosen</Badge>
          )}
        </div>
        {viewer ? (
          <p className="text-[13px]">
            Public profiles are read through{' '}
            <strong>{viewer.handle ? `@${viewer.handle}` : (viewer.name ?? 'your account')}</strong>
            .
            {viewer.connectionStatus !== 'active' ? (
              <>
                {' '}
                Meta stopped accepting its login, so public profiles are not being updated.{' '}
                <Link className="underline" href={`/${orgSlug}/settings/connections`}>
                  Reconnect it
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground text-[13px]">
            Until you choose one, added profiles wait and no public data is read.
          </p>
        )}
        {canManage && !org.is_demo ? (
          options.length ? (
            <div className="flex flex-wrap items-center gap-3">
              <ViewerForm
                action={setPublicDataViewer.bind(null, orgSlug)}
                options={options}
                current={viewer?.assetId ?? null}
              />
              {viewer ? (
                <form action={clearPublicDataViewer.bind(null, orgSlug)}>
                  <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
                    Stop reading public data
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          ) : (
            <p className="text-[13px]">
              No Instagram professional account is connected yet.{' '}
              <Link className="underline" href={`/${orgSlug}/settings/connections`}>
                Connect with Meta
              </Link>{' '}
              first, then come back here.
            </p>
          )
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Setting up a viewer account</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px]">
          <li>
            Use an existing Instagram business or creator account, or create one and switch it to a
            professional account in the Instagram app.
          </li>
          <li>Link it to a Facebook Page you manage (Instagram settings → Accounts Center).</li>
          <li>
            In{' '}
            <Link className="underline" href={`/${orgSlug}/settings/connections`}>
              Connections
            </Link>
            , connect with Meta as a Facebook user who manages that Page.
          </li>
          <li>Choose the account above. Tracked profiles are first read on the next sync.</li>
        </ol>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">What is collected, and what isn&apos;t</h3>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-[13px]">
          <li>
            Only public business and creator accounts. Personal and age-restricted accounts
            can&apos;t be read through the official API, and Scopie doesn&apos;t try other ways.
          </li>
          <li>
            Followers are observed once a day from the day you add a profile. Earlier follower
            history isn&apos;t available, so it is never shown or estimated.
          </li>
          <li>
            Reach, saves, shares, demographics and stories are private to the owner and never shown
            for public profiles. Hidden like counts are shown as hidden, not as zero.
          </li>
          <li>
            Meta limits how many requests an app makes per hour. Scopie pauses public reads near
            that limit and allows {LOOKUPS_PER_HOUR} add-profile previews per hour.
          </li>
          <li>
            Removing a profile deletes everything Scopie stored about it, as Meta&apos;s terms
            require.
          </li>
        </ul>
      </div>
    </section>
  );
}
