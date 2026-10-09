import Link from 'next/link';
import { Missing, ProfileLink, SectionEmpty, SourceBadges } from '@/components/dashboard/values';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MIN_POSTS_FOR_COMPARISON } from '@/lib/analytics/engagement';
import {
  COMPARE_BY_LABELS,
  EXCLUSION_LABELS,
  formatMetricValue,
  metricLabel,
  UNGROUPED_LABELS,
  type ExampleEntry,
  type Explorer,
  type ExplorerGroup,
  type ExplorerView,
} from '@/lib/analytics/explorer';
import { formatCount } from '@/lib/analytics/format';
import { platformName } from '@/lib/analytics/names';
import { formatDay } from '@/lib/analytics/range';

/** Median, mean, post count and top examples per group, with what every number rests on. */
export function ExplorerCard({
  view,
  orgSlug,
  definition,
  platformHref,
}: {
  view: ExplorerView;
  orgSlug: string;
  definition: string | undefined;
  /** The current view on one platform. */
  platformHref: (platformKey: string) => string;
}) {
  const { explorer, metricKey, compareBy } = view;
  const label = metricLabel(metricKey);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {label} per post by {COMPARE_BY_LABELS[compareBy].toLowerCase()}
          </CardTitle>
          <SourceBadges sources={[view.source]} />
        </div>
        <CardDescription>
          {explorer.status === 'ok' ? (
            <span className="text-foreground font-medium">{explorer.basis} </span>
          ) : null}
          {definition ? `${label}: ${definition}` : null}
        </CardDescription>
      </CardHeader>
      <Body explorer={explorer} view={view} orgSlug={orgSlug} platformHref={platformHref} />
    </Card>
  );
}

function Body({
  explorer,
  view,
  orgSlug,
  platformHref,
}: {
  explorer: Explorer;
  view: ExplorerView;
  orgSlug: string;
  platformHref: (platformKey: string) => string;
}) {
  switch (explorer.status) {
    case 'no_posts':
      return (
        <SectionEmpty>
          No stored post was published in this period with these filters. Scopie only shows posts it
          has observed or imported; widen the period or clear a filter.
        </SectionEmpty>
      );
    case 'no_values':
      return (
        <SectionEmpty>
          None of the {formatCount(explorer.posts)} posts has a stored{' '}
          {metricLabel(view.metricKey).toLowerCase()} value (
          {explorer.excluded
            .map((e) => `${formatCount(e.posts)} ${EXCLUSION_LABELS[e.reason]}`)
            .join(', ')}
          ). Missing values are never counted as 0, so there is nothing to compare.
        </SectionEmpty>
      );
    case 'refused':
      return (
        <div className="space-y-3 px-5 py-6 text-[13px]">
          <p>
            <span className="font-medium">Not compared.</span> {explorer.detail} Pick one platform
            to compare {metricLabel(view.metricKey).toLowerCase()}:
          </p>
          <div className="flex flex-wrap gap-2">
            {explorer.platforms.map((p) => (
              <Button key={p.key} asChild size="sm" variant="outline">
                <Link href={platformHref(p.key)}>
                  {platformName(p.key)} ({formatCount(p.count)})
                </Link>
              </Button>
            ))}
          </div>
        </div>
      );
    case 'ok':
      return (
        <>
          {explorer.groups.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{COMPARE_BY_LABELS[view.compareBy]}</TableHead>
                  <TableHead className="text-right">Posts</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">Mean</TableHead>
                  <TableHead className="text-right">Left out</TableHead>
                  <TableHead>Top posts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {explorer.groups.map((group) => (
                  <GroupRow
                    key={group.key}
                    group={group}
                    metricKey={view.metricKey}
                    orgSlug={orgSlug}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <SectionEmpty>
              All {formatCount(explorer.measured)} posts with a value have{' '}
              {UNGROUPED_LABELS[view.compareBy]}, so there are no groups to compare. Choose another
              “Compare by”.
            </SectionEmpty>
          )}
          {explorer.exclusionNote || (explorer.ungrouped > 0 && explorer.groups.length > 0) ? (
            <div className="text-muted-foreground space-y-1 border-t px-5 py-2.5 text-xs">
              {explorer.exclusionNote ? <p>{explorer.exclusionNote}</p> : null}
              {explorer.ungrouped > 0 && explorer.groups.length > 0 ? (
                <p>
                  {explorer.ungrouped === 1
                    ? `1 post with a value has ${UNGROUPED_LABELS[view.compareBy]} and is not in any group.`
                    : `${formatCount(explorer.ungrouped)} posts with a value have ${UNGROUPED_LABELS[view.compareBy]} and are not in any group.`}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      );
  }
}

function GroupRow({
  group,
  metricKey,
  orgSlug,
}: {
  group: ExplorerGroup;
  metricKey: string;
  orgSlug: string;
}) {
  const tooFew = group.posts > 0 && group.posts < MIN_POSTS_FOR_COMPARISON;
  return (
    <TableRow className="[&>td]:align-top">
      <TableCell className="max-w-56 min-w-36">
        {group.profile ? (
          <ProfileLink orgSlug={orgSlug} profile={group.profile} showRole />
        ) : (
          <span className="font-medium">{group.label}</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(group.posts)}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        <Value value={group.median} metricKey={metricKey} tooFew={tooFew} none={!group.posts} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <Value value={group.mean} metricKey={metricKey} tooFew={tooFew} none={!group.posts} />
      </TableCell>
      <TableCell className="text-muted-foreground text-right tabular-nums">
        {group.excluded ? formatCount(group.excluded) : '–'}
      </TableCell>
      <TableCell className="min-w-64">
        {group.top.length ? (
          <ol className="space-y-1.5">
            {group.top.map((entry) => (
              <Example key={entry.post.id} entry={entry} metricKey={metricKey} orgSlug={orgSlug} />
            ))}
          </ol>
        ) : (
          <Missing label="no post with a value" />
        )}
      </TableCell>
    </TableRow>
  );
}

function Value({
  value,
  metricKey,
  tooFew,
  none,
}: {
  value: number | null;
  metricKey: string;
  tooFew: boolean;
  none: boolean;
}) {
  if (value !== null) return formatMetricValue(metricKey, value);
  if (none) return <Missing label="no values" />;
  return (
    <Missing
      label={tooFew ? 'too few posts' : 'not available'}
      result={
        tooFew
          ? {
              status: 'unavailable',
              reason: 'too_few_posts',
              detail: `Needs at least ${MIN_POSTS_FOR_COMPARISON} posts with a value.`,
            }
          : undefined
      }
    />
  );
}

function Example({
  entry,
  metricKey,
  orgSlug,
}: {
  entry: ExampleEntry;
  metricKey: string;
  orgSlug: string;
}) {
  const { post } = entry;
  const caption = post.caption?.trim().replace(/\s+/g, ' ');
  return (
    <li className="flex min-w-0 items-baseline gap-2 text-xs">
      <span className="w-14 shrink-0 text-right font-medium tabular-nums">
        {formatMetricValue(metricKey, entry.value)}
      </span>
      <span className="min-w-0">
        <Link
          href={`/${orgSlug}/accounts/${post.profile.id}`}
          className="font-medium hover:underline"
        >
          {post.profile.name}
        </Link>
        <span className="text-muted-foreground"> · {formatDay(post.publishedAt)}</span>
        {caption ? (
          <span className="text-muted-foreground block max-w-72 truncate" title={caption}>
            {caption}
          </span>
        ) : null}
      </span>
    </li>
  );
}
