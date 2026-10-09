import { ArrowRight, ImageIcon, X } from 'lucide-react';
import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { platformName } from '@/lib/analytics/names';
import { canReschedule, dayKeyIn, formatDayYear, parseDateKey, timeIn } from '@/lib/calendar/dates';
import type { CalendarItemDetail } from '@/lib/calendar/queries';
import { pillarColorClass } from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';
import { RescheduleForm } from './reschedule-form';
import { StatusBadge } from './status-badge';

const EXCERPT_LENGTH = 280;

/**
 * The item opened from the calendar (`?item=<id>`), rendered on the server. Closing it is a
 * link back to the same calendar without the item.
 */
export function ItemPanel({
  orgSlug,
  item,
  closeHref,
  timeZone,
  countryName,
  canEdit,
  isDemo,
}: {
  orgSlug: string;
  item: CalendarItemDetail;
  closeHref: string;
  timeZone: string;
  countryName: string | null;
  canEdit: boolean;
  isDemo: boolean;
}) {
  const caption = item.caption?.trim();
  const excerpt =
    caption && caption.length > EXCERPT_LENGTH
      ? `${caption.slice(0, EXCERPT_LENGTH).trimEnd()}…`
      : caption;
  const movable = canEdit && canReschedule(item);

  return (
    <>
      <Link
        href={closeHref}
        scroll={false}
        aria-label="Close"
        tabIndex={-1}
        className="fixed inset-0 z-40 bg-black/20"
      />
      <aside
        aria-labelledby="item-panel-title"
        className="bg-card fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l shadow-xl"
      >
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={item.status} />
              {isDemo ? <Badge variant="demo">Demo</Badge> : null}
            </div>
            <h2 id="item-panel-title" className="text-base font-semibold break-words">
              {item.title}
            </h2>
          </div>
          <Button asChild size="icon" variant="ghost" className="-mr-2 size-8">
            <Link href={closeHref} scroll={false} aria-label="Close">
              <X aria-hidden />
            </Link>
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {item.imageAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element -- private asset served by our own route
            <img
              src={`/api/content-assets/${item.imageAssetId}`}
              alt=""
              className="bg-muted aspect-video w-full rounded-md border object-cover"
            />
          ) : null}

          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
            <Row label="Planned for">{when(item.plannedPublishAt, timeZone)}</Row>
            {item.publishedAt ? (
              <Row label="Published">{when(item.publishedAt, timeZone)}</Row>
            ) : null}
            <Row label="Platforms">
              {item.platformKeys.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {item.platformKeys.map((key) => (
                    <span key={key} className="inline-flex items-center gap-1">
                      <PlatformMark platformKey={key} />
                      {platformName(key)}
                    </span>
                  ))}
                </span>
              ) : (
                <Muted>None yet</Muted>
              )}
            </Row>
            <Row label="Country">{countryName ?? <Muted>Not set</Muted>}</Row>
            <Row label="Pillar">
              {item.pillar ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn('size-2 rounded-full', pillarColorClass(item.pillar.color))}
                  />
                  {item.pillar.name}
                </span>
              ) : (
                <Muted>Not set</Muted>
              )}
            </Row>
            <Row label="Campaign">{item.campaign ?? <Muted>Not set</Muted>}</Row>
            <Row label="Owner">{item.owner ?? <Muted>No owner</Muted>}</Row>
            <Row label="Files">
              <span className="inline-flex items-center gap-1.5">
                <ImageIcon className="text-muted-foreground size-3.5" aria-hidden />
                {item.assetCount === 1 ? '1 file' : `${item.assetCount} files`}
              </span>
            </Row>
          </dl>

          <div className="space-y-1">
            <h3 className="text-muted-foreground text-xs font-medium">Caption</h3>
            {excerpt ? (
              <p className="text-[13px] break-words whitespace-pre-line">{excerpt}</p>
            ) : (
              <p className="text-muted-foreground text-[13px]">No caption yet.</p>
            )}
          </div>

          {movable ? (
            <RescheduleForm
              orgSlug={orgSlug}
              itemId={item.id}
              defaultDate={item.plannedPublishAt ? dayKeyIn(item.plannedPublishAt, timeZone) : ''}
            />
          ) : canEdit ? (
            <p className="text-muted-foreground text-xs">
              {item.status === 'ARCHIVED'
                ? 'Archived content can’t be moved. Restore it first.'
                : 'Published content keeps its publish date.'}
            </p>
          ) : null}
        </div>

        <div className="border-t px-5 py-3">
          <Button asChild size="sm">
            <Link href={`/${orgSlug}/content/${item.id}`}>
              Open
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </aside>
    </>
  );
}

function when(at: string | null, timeZone: string) {
  if (!at) return <Muted>No date yet</Muted>;
  return `${formatDayYear(parseDateKey(dayKeyIn(at, timeZone))!)}, ${timeIn(at, timeZone)}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
