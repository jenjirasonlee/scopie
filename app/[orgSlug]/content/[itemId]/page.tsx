import { Archive, ArchiveRestore, CalendarDays, CheckCircle2, CopyPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ContentAssets } from '@/components/content/content-assets';
import { ContentForm } from '@/components/content/content-form';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { can } from '@/lib/auth/permissions';
import { utcToZonedParts } from '@/lib/calendar/time';
import { setContentArchived, startNewVersion, updateContentItem } from '@/lib/content/actions';
import { getContentOptionLists } from '@/lib/content/form-options';
import { getContentDetail } from '@/lib/content/queries';
import {
  CONTENT_STATUS_HELP,
  CONTENT_STATUS_LABELS,
  CONTENT_STATUS_VARIANT,
  isEditableStatus,
} from '@/lib/content/shared';
import { assetStore } from '@/lib/content/store';
import { getOrgContext } from '@/lib/orgs/queries';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Content' };

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContentItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug, itemId }, search] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(itemId).success) notFound();
  const requested = Number(single(search.version));
  const { org, role } = await getOrgContext(orgSlug);
  const [detail, options] = await Promise.all([
    getContentDetail(
      org.id,
      itemId,
      Number.isInteger(requested) && requested > 0 ? requested : undefined,
    ),
    getContentOptionLists(org.id),
  ]);
  if (!detail) notFound();
  const { item, version, isCurrentVersion, assets, versions } = detail;

  const canEdit = can(role, 'content.edit');
  const editable =
    canEdit && isCurrentVersion && isEditableStatus(item.status) && !version.submitted_at;
  const planned = item.planned_publish_at
    ? utcToZonedParts(new Date(item.planned_publish_at), org.default_timezone)
    : null;
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: org.default_timezone,
    });
  const uploaded = Number(single(search.uploaded) ?? 0);
  const uploadError = single(search.uploadError)?.slice(0, 300);

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant={CONTENT_STATUS_VARIANT[item.status]}>
              {CONTENT_STATUS_LABELS[item.status]}
            </Badge>
            {org.is_demo ? <Badge variant="demo">Demo</Badge> : null}
            <span>
              Version {versions[0]?.version_number ?? 1}
              {planned
                ? ` · planned for ${dateLabel(item.planned_publish_at!)}`
                : ' · not planned yet'}
            </span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/${orgSlug}/calendar${planned ? `?view=month&date=${planned.date}&item=${item.id}` : ''}`}
              >
                <CalendarDays aria-hidden />
                Calendar
              </Link>
            </Button>
            {canEdit && item.status !== 'ARCHIVED' && isEditableStatus(item.status) ? (
              <form action={setContentArchived.bind(null, orgSlug)}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="status" value="ARCHIVED" />
                <Button type="submit" variant="ghost" size="sm">
                  <Archive aria-hidden />
                  Archive
                </Button>
              </form>
            ) : null}
            {canEdit && item.status === 'ARCHIVED' ? (
              <form action={setContentArchived.bind(null, orgSlug)}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="status" value="DRAFT" />
                <Button type="submit" variant="outline" size="sm">
                  <ArchiveRestore aria-hidden />
                  Restore as draft
                </Button>
              </form>
            ) : null}
          </>
        }
      />

      {search.created ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertDescription>Created. Add files below, or keep editing.</AlertDescription>
        </Alert>
      ) : null}
      {search.versioned ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertDescription>
            Started version {versions[0]?.version_number}. The previous version is kept as it was.
          </AlertDescription>
        </Alert>
      ) : null}
      {!isCurrentVersion ? (
        <Alert>
          <AlertDescription>
            You’re looking at version {version.version_number}, an earlier version. It can’t be
            changed.{' '}
            <Link href={`/${orgSlug}/content/${item.id}`} className="font-medium underline">
              Go to the current version
            </Link>
          </AlertDescription>
        </Alert>
      ) : item.status === 'ARCHIVED' ? (
        <Alert>
          <AlertDescription>{CONTENT_STATUS_HELP.ARCHIVED}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardContent className="pt-6">
              <ContentForm
                key={version.id}
                action={updateContentItem.bind(null, orgSlug, item.id)}
                readOnly={!editable}
                defaults={{
                  title: item.title,
                  status: isEditableStatus(item.status) ? item.status : 'DRAFT',
                  platformKeys: item.platform_keys,
                  countryCode: item.country_code,
                  ownerUserId: item.owner_user_id,
                  pillarId: item.pillar_id,
                  contentFormatId: item.content_format_id,
                  campaignId: item.campaign_id,
                  audienceId: item.audience_id,
                  ctaTypeId: item.cta_type_id,
                  plannedDate: planned?.date ?? '',
                  plannedTime: planned?.time ?? '',
                  description: version.description,
                  caption: version.caption,
                  cta: version.cta,
                  hashtags: version.hashtags.map((tag) => `#${tag}`).join(' '),
                  notes: version.notes,
                }}
                options={options}
                timeZone={org.default_timezone}
                taxonomyHref={`/${orgSlug}/settings/taxonomy`}
                submitLabel="Save"
              />
            </CardContent>
          </Card>

          <ContentAssets
            orgSlug={orgSlug}
            itemId={item.id}
            assets={assets}
            canEdit={editable}
            uploadsReady={assetStore() !== null}
            versionLabel={isCurrentVersion ? 'this version' : `version ${version.version_number}`}
            uploaded={Number.isFinite(uploaded) ? uploaded : 0}
            uploadError={uploadError}
          />
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Versions</CardTitle>
              <CardDescription>
                Earlier versions are never overwritten. Start a new version before big changes you
                may want to compare later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="space-y-1.5 text-[13px]">
                {versions.map((v) => {
                  const isCurrent = v.id === item.current_version_id;
                  const isShown = v.id === version.id;
                  return (
                    <li key={v.id}>
                      <Link
                        href={`/${orgSlug}/content/${item.id}${isCurrent ? '' : `?version=${v.version_number}`}`}
                        aria-current={isShown ? 'page' : undefined}
                        className={cn(
                          'hover:bg-muted/60 flex items-baseline justify-between gap-2 rounded px-2 py-1',
                          isShown && 'bg-muted',
                        )}
                      >
                        <span className="font-medium">
                          Version {v.version_number}
                          {isCurrent ? (
                            <span className="text-muted-foreground font-normal"> · current</span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {v.assetCount} {v.assetCount === 1 ? 'file' : 'files'}
                        </span>
                      </Link>
                      <p className="text-muted-foreground px-2 text-xs">
                        {v.authorName ? `${v.authorName}, ` : ''}
                        {dateLabel(isCurrent ? v.updated_at : v.created_at)}
                      </p>
                    </li>
                  );
                })}
              </ol>
              {canEdit && isEditableStatus(item.status) ? (
                <form action={startNewVersion.bind(null, orgSlug)}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button type="submit" variant="outline" size="sm" className="w-full">
                    <CopyPlus aria-hidden />
                    Start version {(versions[0]?.version_number ?? 1) + 1}
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
          <p className="text-muted-foreground text-xs">
            Review and approval come next: soon you’ll submit a version for review here.
          </p>
        </aside>
      </div>
    </div>
  );
}
