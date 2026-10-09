import Link from 'next/link';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { InlineActionForm } from '@/components/pipeline/inline-action-form';
import { SyncStatusBadge } from '@/components/pipeline/sync-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AVAILABILITY_LABELS, SYNC_JOB_LABELS } from '@/lib/accounts/labels';
import type { SocialAccount } from '@/lib/accounts/queries';
import { requestSync } from '@/lib/connections/actions';
import { getMetric } from '@/lib/metrics/registry';
import { formatDateTime } from '@/lib/content/review';
import type { Enums } from '@/lib/db/types';
import type { ObservationHistory, PostWithMetrics, SyncRun } from '@/lib/pipeline/queries';

/** "8 Oct 2026, 14:05" in the organization's time zone. */
const dateTime = (value: string, timeZone: string) => formatDateTime(value, timeZone);
/** "8 Oct 2026". Plain dates (YYYY-MM-DD) are read in UTC so they never shift a day. */
const date = (value: string, timeZone = 'UTC') =>
  new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: value.length === 10 ? 'UTC' : timeZone,
  });
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/**
 * One sentence on what history Scopie holds, so nobody reads a gap as a zero:
 * "Observed since 7 Oct 2026; posts complete back to 3 Mar 2025."
 */
export function coverageLine(
  account: SocialAccount,
  earliestPostAt: string | null,
  timeZone: string,
): string {
  if (account.access_type === 'demo') return 'DEMO DATA: generated, not observed.';
  if (!account.first_observed_at) {
    return account.access_type === 'public'
      ? 'Not observed yet. The first observation happens on the next sync.'
      : 'No observations yet.';
  }
  const since = `Observed since ${date(account.first_observed_at, timeZone)}`;
  if (account.earliest_post_at) {
    return `${since}; posts complete back to ${date(account.earliest_post_at, timeZone)}.`;
  }
  return earliestPostAt
    ? `${since}; older posts are still being read (oldest so far ${date(earliestPostAt, timeZone)}).`
    : `${since}.`;
}

/** Sync status for a connected account: last runs, errors, how far back data goes. */
export function SyncCard({
  orgSlug,
  account,
  runs,
  earliestPostAt,
  canManage,
  timeZone,
}: {
  orgSlug: string;
  account: SocialAccount;
  runs: SyncRun[];
  earliestPostAt: string | null;
  canManage: boolean;
  timeZone: string;
}) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        <p>{coverageLine(account, earliestPostAt, timeZone)}</p>
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-muted-foreground">Observed since</dt>
          <dd>
            {account.first_observed_at ? date(account.first_observed_at, timeZone) : 'Not yet'}
          </dd>
          <dt className="text-muted-foreground">Last observed</dt>
          <dd>{account.last_observed_at ? dateTime(account.last_observed_at, timeZone) : '—'}</dd>
          <dt className="text-muted-foreground">Oldest post stored</dt>
          <dd>{earliestPostAt ? date(earliestPostAt, timeZone) : '—'}</dd>
          {account.history_available_from ? (
            <>
              <dt className="text-muted-foreground">History back to</dt>
              <dd>{date(account.history_available_from)}</dd>
            </>
          ) : null}
        </dl>
        {(account.connection_id || account.access_type === 'public') && canManage ? (
          <InlineActionForm
            action={requestSync.bind(null, orgSlug)}
            hidden={{
              accountId: account.id,
              job: account.connection_id ? 'posts_incremental' : 'public_profile_daily',
            }}
            label="Sync now"
            pendingLabel="Queuing…"
          />
        ) : null}
        {canManage ? (
          <Link
            className="text-primary block hover:underline"
            href={`/${orgSlug}/accounts/import?account=${account.id}`}
          >
            Import a CSV for this account
          </Link>
        ) : null}
        {runs.length ? (
          <ul className="space-y-2 border-t pt-3">
            {runs.map((run) => (
              <li key={run.id} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span>{SYNC_JOB_LABELS[run.job_type]}</span>
                  <SyncStatusBadge status={run.status} />
                </div>
                <div className="text-muted-foreground text-xs">
                  {dateTime(run.completed_at ?? run.queued_at, timeZone)} · {run.records_processed}{' '}
                  records
                  {run.records_failed ? `, ${run.records_failed} failed` : ''}
                </div>
                {run.error_message ? (
                  <p className="text-destructive text-xs">{run.error_message}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

const SHOWN_METRICS = [
  'reach',
  'views',
  'impressions',
  'likes',
  'reactions',
  'comments',
  'shares',
  'saves',
];

/** The latest posts with their newest numbers. Missing or withheld numbers say so, never 0. */
export function RecentPosts({
  posts,
  publicOnly = false,
  timeZone,
}: {
  posts: PostWithMetrics[];
  timeZone: string;
  /** Public profiles: show public, imported and demo numbers only, never connected ones. */
  publicOnly?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent posts</CardTitle>
      </CardHeader>
      <CardContent>
        {posts.length ? (
          <ul className="divide-y text-[13px]">
            {posts.map((post) => {
              const metrics = post.metrics
                .filter((metric) => SHOWN_METRICS.includes(metric.key))
                .filter((metric) => !publicOnly || metric.source !== 'live_connected')
                .sort((a, b) => SHOWN_METRICS.indexOf(a.key) - SHOWN_METRICS.indexOf(b.key));
              const sources = [...new Set(metrics.map((metric) => metric.source))];
              const capturedAt = post.metrics
                .map((metric) => metric.capturedAt)
                .filter(Boolean)
                .sort()
                .at(-1);
              return (
                <li key={post.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DataSourceBadge source={post.dataSource} />
                    <span className="text-muted-foreground">
                      {dateTime(post.publishedAt, timeZone)} · {post.mediaFormat.replace('_', ' ')}
                    </span>
                    {post.permalink ? (
                      <a
                        className="text-primary hover:underline"
                        href={post.permalink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                    ) : null}
                  </div>
                  {post.caption ? <p className="line-clamp-2">{post.caption}</p> : null}
                  {metrics.length ? (
                    sources.map((source) => (
                      <dl
                        key={source ?? 'unknown'}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1"
                      >
                        {sources.length > 1 && source ? (
                          <DataSourceBadge source={source as Enums<'data_source'>} />
                        ) : null}
                        {metrics
                          .filter((metric) => metric.source === source)
                          .map((metric) => (
                            <div key={metric.key} className="flex gap-1">
                              <dt className="text-muted-foreground">
                                {getMetric(metric.key)?.label ?? metric.key}
                              </dt>
                              <dd className="font-medium tabular-nums">
                                {metric.availability === 'available' && metric.value !== null
                                  ? number.format(metric.value)
                                  : AVAILABILITY_LABELS[metric.availability ?? 'pending'] || 'n/a'}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    ))
                  ) : (
                    <p className="text-muted-foreground">No metrics yet.</p>
                  )}
                  {capturedAt ? (
                    <p className="text-muted-foreground text-xs">
                      Numbers as of {dateTime(capturedAt, timeZone)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[13px]">
            No posts yet. They appear after the first sync or a CSV import.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Follower observations as they were made: one row per observation, with the change since
 * the previous one. Days without an observation are simply absent.
 */
export function ObservationHistoryCard({
  history,
  timeZone,
}: {
  history: ObservationHistory;
  timeZone: string;
}) {
  const rows = history.followers.slice(-30).reverse();
  const first = history.followers.find((row) => row.value !== null);
  const last = history.followers.findLast((row) => row.value !== null);
  const growth =
    first &&
    last &&
    first.value &&
    Date.parse(last.observedAt) - Date.parse(first.observedAt) >= 86_400_000
      ? ((last.value! - first.value) / first.value) * 100
      : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Observed followers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {rows.length ? (
          <>
            {growth !== null && first && last ? (
              <p>
                {number.format(first.value!)} on {date(first.observedAt, timeZone)} →{' '}
                {number.format(last.value!)} on {date(last.observedAt, timeZone)}:{' '}
                <strong>
                  {growth >= 0 ? '+' : ''}
                  {number.format(growth)}% observed growth
                </strong>{' '}
                ({history.followers.length} observations).
              </p>
            ) : (
              <p className="text-muted-foreground">
                Growth needs at least two observations on different days.
              </p>
            )}
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <table className="w-full text-left">
                <caption className="sr-only">Follower observations, newest first</caption>
                <thead className="bg-muted/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Observed</th>
                    <th className="px-3 py-1.5 text-right font-medium">Followers</th>
                    <th className="px-3 py-1.5 text-right font-medium">Change</th>
                    <th className="px-3 py-1.5 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row, index) => {
                    const previous = rows[index + 1];
                    const change =
                      previous && previous.value !== null && row.value !== null
                        ? row.value - previous.value
                        : null;
                    return (
                      <tr key={`${row.observedAt}-${row.source}`}>
                        <td className="px-3 py-1.5">{dateTime(row.observedAt, timeZone)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {row.value === null ? 'not available' : number.format(row.value)}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5 text-right tabular-nums">
                          {change === null
                            ? '—'
                            : `${change >= 0 ? '+' : ''}${number.format(change)}`}
                        </td>
                        <td className="px-3 py-1.5">
                          <DataSourceBadge source={row.source} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">
            No follower observations yet. Scopie records one each day from the first sync; it never
            fills in days it didn&apos;t observe.
          </p>
        )}
        {history.profileChanges.length > 1 ? (
          <div className="space-y-1 border-t pt-3">
            <p className="font-medium">Profile changes</p>
            <ul className="space-y-1">
              {history.profileChanges.slice(0, -1).map((change) => (
                <li key={change.observedAt}>
                  <span className="text-muted-foreground">
                    {date(change.observedAt, timeZone)}:
                  </span>{' '}
                  {change.biography ? `bio “${change.biography}”` : 'bio removed'}
                  {change.website ? ` · website ${change.website}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
