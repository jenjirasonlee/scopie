import { ArrowUpRight, Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MEDIA_FORMAT_LABELS } from '@/lib/analytics/content';
import {
  formatCompact,
  formatCount,
  formatDecimal,
  formatSignedCount,
} from '@/lib/analytics/format';
import {
  MIN_POST_AGE_HOURS,
  MIN_POSTS_PER_GROUP,
  formatRate,
  type GroupResult,
  type MarketerView,
  type ProfileSummary,
} from '@/lib/analytics/marketer';
import { formatDay } from '@/lib/analytics/range';
import { cn } from '@/lib/utils';
import { Missing, ProfileLink, SectionEmpty } from './values';

const MIN_AGE_DAYS = MIN_POST_AGE_HOURS / 24;

/** The few sentences a marketer reads first: each one a comparison with a "so what". */
export function Headlines({ view }: { view: MarketerView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="text-primary size-4" aria-hidden />
          In short
        </CardTitle>
      </CardHeader>
      {view.headlines.length ? (
        <ul className="space-y-2.5 px-5 py-4">
          {view.headlines.map((line) => (
            <li key={line} className="text-[14px] leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <SectionEmpty>
          Not enough has been observed yet to compare. Scopie needs posts at least {MIN_AGE_DAYS}{' '}
          days old with visible likes, from your profile and the ones you watch. This fills in as
          new posts come in.
        </SectionEmpty>
      )}
    </Card>
  );
}

/** One row per profile, ours first: the numbers that say who is winning attention. */
export function CompareTable({ view, orgSlug }: { view: MarketerView; orgSlug: string }) {
  const watchedRates = view.profiles
    .filter((p) => !p.own && p.engagementRate !== null)
    .map((p) => p.engagementRate!);
  const best = watchedRates.length ? Math.max(...watchedRates) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>How you compare</CardTitle>
        <CardDescription>
          Engagement is likes + comments on a typical post, as a share of followers. It’s the
          fairest way to compare a small account with a big one.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Profile</TableHead>
            <TableHead className="text-right">Followers</TableHead>
            <TableHead className="text-right">Change</TableHead>
            <TableHead className="text-right">Posts a week</TableHead>
            <TableHead className="text-right">Typical post</TableHead>
            <TableHead className="text-right">Engagement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.profiles.map((row) => (
            <TableRow key={row.profile.id} className={cn(row.own && 'bg-primary/5')}>
              <TableCell className="max-w-[220px]">
                <div className="flex items-center gap-2">
                  <ProfileLink orgSlug={orgSlug} profile={row.profile} />
                  {row.own ? <Badge variant="secondary">You</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.followers !== null ? (
                  formatCompact(row.followers)
                ) : (
                  <Missing label="not read yet" />
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <Change row={row} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.frequency.status === 'ok' ? (
                  formatDecimal(Math.round(row.frequency.postsPerWeek * 10) / 10)
                ) : (
                  <Missing result={row.frequency} />
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.typicalEngagement !== null ? (
                  formatCompact(Math.round(row.typicalEngagement))
                ) : (
                  <Missing label={row.hiddenLikes ? 'likes hidden' : 'too few posts yet'} />
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.engagementRate !== null ? (
                  <span
                    className={cn(
                      'font-medium',
                      best !== null && row.engagementRate >= best && 'text-primary',
                    )}
                  >
                    {formatRate(row.engagementRate)}
                  </span>
                ) : (
                  <Missing label="—" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Change({ row }: { row: ProfileSummary }) {
  if (row.growth.status === 'ok') {
    return (
      <span className={cn(row.growth.change > 0 && 'text-emerald-700 dark:text-emerald-400')}>
        {formatSignedCount(row.growth.change)}
      </span>
    );
  }
  const since = row.profile.firstObservedAt;
  return <Missing label={since ? `tracking since ${formatDay(since)}` : 'not read yet'} />;
}

/** Their best posts this period, ranked by share of followers reached, with what they were. */
export function WinningPosts({
  view,
  orgSlug,
  timeZone,
}: {
  view: MarketerView;
  orgSlug: string;
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Their posts that worked best</CardTitle>
        <CardDescription>
          From the profiles you watch, ranked by engagement as a share of their followers. Posts
          younger than {MIN_AGE_DAYS} days are left out while they gather likes.
        </CardDescription>
      </CardHeader>
      {view.winningPosts.length ? (
        <ul className="bg-border grid gap-px sm:grid-cols-2 xl:grid-cols-3">
          {view.winningPosts.map((w) => (
            <li key={w.post.id} className="bg-card flex flex-col gap-2.5 p-4">
              <div className="flex items-start justify-between gap-2">
                <ProfileLink orgSlug={orgSlug} profile={w.profile} />
                <Badge variant="outline">{MEDIA_FORMAT_LABELS[w.post.mediaFormat]}</Badge>
              </div>
              <p className="text-muted-foreground line-clamp-3 text-[13px] leading-relaxed">
                {w.post.caption?.trim() || 'No caption'}
              </p>
              <dl className="mt-auto grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Likes</dt>
                  <dd className="font-medium tabular-nums">{formatCount(w.likes)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Comments</dt>
                  <dd className="font-medium tabular-nums">{formatCount(w.comments)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Engagement</dt>
                  <dd className="text-primary font-medium tabular-nums">{formatRate(w.rate!)}</dd>
                </div>
              </dl>
              <p className="text-xs">
                {w.timesTypical !== null && w.timesTypical >= 1.5 ? (
                  <span className="font-medium">
                    {formatDecimal(Math.round(w.timesTypical * 10) / 10)}× their typical post.{' '}
                  </span>
                ) : null}
                <span className="text-muted-foreground">
                  Posted {postedAt(w.post.publishedAt, timeZone)}
                  {w.post.ageHours !== null
                    ? `; counts read when it was ${Math.round(w.post.ageHours / 24)} days old`
                    : ''}
                  .
                </span>
              </p>
              {w.post.permalink ? (
                <a
                  href={w.post.permalink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary inline-flex items-center gap-0.5 text-xs font-medium hover:underline"
                >
                  Open post
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <SectionEmpty>
          No posts to rank yet. Posts appear here once they’re {MIN_AGE_DAYS} days old and Scopie
          has read their likes and comments.
        </SectionEmpty>
      )}
    </Card>
  );
}

function postedAt(at: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(at));
}

/** Which formats and posting days earn the most engagement for the profiles you watch. */
export function WhatWorks({ view }: { view: MarketerView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What works for them</CardTitle>
        <CardDescription>
          Typical engagement of the profiles you watch, by format and by day posted. A group needs{' '}
          {MIN_POSTS_PER_GROUP} posts to show.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <Bars title="By format" groups={view.formats} />
        <Bars title="By day posted" groups={view.weekdays} />
      </CardContent>
    </Card>
  );
}

function Bars<K extends string | number>({
  title,
  groups,
}: {
  title: string;
  groups: GroupResult<K>[];
}) {
  const max = Math.max(...groups.map((g) => g.medianRate), 0);
  return (
    <div className="space-y-2.5">
      <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h4>
      {groups.length ? (
        <ul className="space-y-2">
          {groups.map((group, index) => (
            <li key={String(group.key)} className="space-y-1">
              <div className="flex justify-between gap-2 text-[13px]">
                <span className={cn(index === 0 && 'font-medium')}>{group.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatRate(group.medianRate)} · {group.posts} posts
                </span>
              </div>
              <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
                <div
                  className={cn(
                    'h-full rounded-full',
                    index === 0 ? 'bg-primary' : 'bg-primary/40',
                  )}
                  style={{ width: `${max ? (group.medianRate / max) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">Not enough measured posts yet.</p>
      )}
    </div>
  );
}
