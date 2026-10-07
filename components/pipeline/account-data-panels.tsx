import Link from 'next/link';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { InlineActionForm } from '@/components/pipeline/inline-action-form';
import { SyncStatusBadge } from '@/components/pipeline/sync-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SYNC_JOB_LABELS } from '@/lib/accounts/labels';
import type { SocialAccount } from '@/lib/accounts/queries';
import { requestSync } from '@/lib/connections/actions';
import { getMetric } from '@/lib/metrics/registry';
import type { PostWithMetrics, SyncRun } from '@/lib/pipeline/queries';

const dateTime = (value: string) => new Date(value).toLocaleString('en-GB');
const date = (value: string) => new Date(value).toLocaleDateString('en-GB');
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** Sync status for a connected account: last runs, errors, how far back data goes. */
export function SyncCard({
  orgSlug,
  account,
  runs,
  earliestPostAt,
  canManage,
}: {
  orgSlug: string;
  account: SocialAccount;
  runs: SyncRun[];
  earliestPostAt: string | null;
  canManage: boolean;
}) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        <dl className="grid grid-cols-2 gap-y-2">
          <dt className="text-muted-foreground">Tracking since</dt>
          <dd>{account.tracking_started_at ? date(account.tracking_started_at) : '—'}</dd>
          <dt className="text-muted-foreground">Oldest post stored</dt>
          <dd>{earliestPostAt ? date(earliestPostAt) : '—'}</dd>
          {account.history_available_from ? (
            <>
              <dt className="text-muted-foreground">History back to</dt>
              <dd>{date(account.history_available_from)}</dd>
            </>
          ) : null}
        </dl>
        {account.connection_id && canManage ? (
          <InlineActionForm
            action={requestSync.bind(null, orgSlug)}
            hidden={{ accountId: account.id }}
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
                  {dateTime(run.completed_at ?? run.queued_at)} · {run.records_processed} records
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
export function RecentPosts({ posts }: { posts: PostWithMetrics[] }) {
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
                .sort((a, b) => SHOWN_METRICS.indexOf(a.key) - SHOWN_METRICS.indexOf(b.key));
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
                      {dateTime(post.publishedAt)} · {post.mediaFormat.replace('_', ' ')}
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
                    <dl className="flex flex-wrap gap-x-4 gap-y-1">
                      {metrics.map((metric) => (
                        <div key={metric.key} className="flex gap-1">
                          <dt className="text-muted-foreground">
                            {getMetric(metric.key)?.label ?? metric.key}
                          </dt>
                          <dd className="font-medium tabular-nums">
                            {metric.availability === 'available' && metric.value !== null
                              ? number.format(metric.value)
                              : metric.availability === 'not_permitted'
                                ? 'not shared'
                                : 'n/a'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">No metrics yet.</p>
                  )}
                  {capturedAt ? (
                    <p className="text-muted-foreground text-xs">
                      Numbers as of {dateTime(capturedAt)}
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
