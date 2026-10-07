import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ACCESS_TYPE_LABELS, BUSINESS_ROLE_LABELS, BUSINESS_ROLES } from '@/lib/accounts/labels';
import { ROLE_GROUP_LABELS } from '@/lib/analytics/compare';
import { distinctNames, platformName } from '@/lib/analytics/names';
import { MEDIA_FORMAT_LABELS } from '@/lib/analytics/content';
import type { DashboardModel, ProfileRow } from '@/lib/analytics/dashboard';
import { ENGAGEMENT_AGE_DAYS, MIN_POSTS_FOR_COMPARISON } from '@/lib/analytics/engagement';
import {
  formatCompact,
  formatCount,
  formatDecimal,
  formatShare,
  formatSignedCount,
  formatSignedPercent,
} from '@/lib/analytics/format';
import { formatDate, formatDay, formatPeriod } from '@/lib/analytics/range';
import { UNAVAILABLE_LABELS, type AccessType, type DataSource } from '@/lib/analytics/types';
import { ChartTable, SERIES_SLOTS } from './chart-kit';
import { ColumnChart } from './column-chart';
import { LineChart } from './line-chart';
import { Missing, ProfileLink, SectionEmpty, SourceBadges } from './values';

type Props = { model: DashboardModel; orgSlug: string };

const ACCESS_ORDER: AccessType[] = ['public', 'connected', 'imported', 'demo'];

function postSourcesOf(row: ProfileRow, fallback: DataSource): DataSource[] {
  const sources = row.current.published.map((p) => p.dataSource);
  return sources.length ? sources : [fallback];
}

/** Headline tiles: what is being monitored and how much of it was observed. */
export function Tiles({ model }: { model: DashboardModel }) {
  const { tiles } = model;
  const roles = BUSINESS_ROLES.filter((role) => tiles.byRole[role]);
  const access = ACCESS_ORDER.filter((type) => tiles.byAccess[type]);
  const postsInPeriod = model.rows.reduce((sum, r) => sum + r.current.published.length, 0);
  return (
    <section
      aria-label="Monitored profiles"
      className="bg-border grid grid-cols-1 gap-px overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-4"
    >
      <Tile label="Monitored profiles" value={formatCount(tiles.active)}>
        {tiles.inactive ? `${tiles.inactive} paused` : 'All active'}
      </Tile>
      <Tile label="By role" value={null}>
        <BreakdownList
          items={roles.map((role) => [BUSINESS_ROLE_LABELS[role], tiles.byRole[role]!])}
        />
      </Tile>
      <Tile label="How data is collected" value={null}>
        <BreakdownList
          items={access.map((type) => [ACCESS_TYPE_LABELS[type], tiles.byAccess[type]!])}
        />
      </Tile>
      <Tile label="Observed in this period" value={formatCount(tiles.observedInPeriod)}>
        profiles with a follower observation · {formatCount(postsInPeriod)} posts stored
      </Tile>
    </section>
  );
}

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card min-w-0 px-5 py-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      {value !== null ? (
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      ) : null}
      <div className="text-muted-foreground mt-1 text-xs">{children}</div>
    </div>
  );
}

function BreakdownList({ items }: { items: [string, number][] }) {
  if (!items.length) return <span>None yet</span>;
  return (
    <ul className="space-y-0.5">
      {items.map(([label, count]) => (
        <li key={label} className="flex justify-between gap-3">
          <span className="text-foreground">{label}</span>
          <span className="tabular-nums">{count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Follower trend (change since first observation) and the top growing profiles. */
export function FollowerTrend({ model, orgSlug }: Props) {
  const { series, totalEligible } = model.trend;
  const names = distinctNames(model.rows.map((r) => r.profile));
  const nameOf = (id: string, fallback: string) => names.get(id) ?? fallback;
  const lines = series.map((s, i) => ({
    key: s.profile.id,
    label: nameOf(s.profile.id, s.profile.name),
    slot: i % SERIES_SLOTS,
    points: s.points.map((p) => ({
      at: p.at,
      y: p.change * 100,
      tooltip: `${nameOf(s.profile.id, s.profile.name)}, ${formatDay(p.at)}: ${formatCount(p.value)} followers (${formatSignedPercent(p.change)} since ${formatDay(s.points[0]!.at)})`,
    })),
  }));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Follower trend</CardTitle>
          <SourceBadges sources={[model.source]} />
        </div>
        <CardDescription>
          Change in followers since each profile’s first observation in{' '}
          {formatPeriod(model.periods.current)}, so large and small profiles fit on one scale. Lines
          break where a day wasn’t observed.
          {totalEligible > series.length
            ? ` Showing ${series.length} of ${totalEligible} profiles (your own and others, largest audiences first).`
            : ''}
        </CardDescription>
      </CardHeader>
      <div className="space-y-3 px-5 py-4">
        {lines.length ? (
          <>
            <LineChart
              title="Follower change since first observation"
              description={`Percentage change in observed followers per profile, ${formatPeriod(model.periods.current)}.`}
              series={lines}
              domain={model.periods.current}
              formatY={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatDecimal(Math.abs(v))}%`}
            />
            <ChartTable summary="Show as table">
              <table className="w-full text-left">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Profile</th>
                    <th className="py-1 pr-3 font-medium">First observation</th>
                    <th className="py-1 pr-3 font-medium">Last observation</th>
                    <th className="py-1 pr-3 text-right font-medium">Change</th>
                    <th className="py-1 text-right font-medium">Observations</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {series.map((s) => {
                    const first = s.points[0]!;
                    const last = s.points[s.points.length - 1]!;
                    return (
                      <tr key={s.profile.id} className="border-t">
                        <td className="py-1 pr-3">{nameOf(s.profile.id, s.profile.name)}</td>
                        <td className="py-1 pr-3">
                          {formatCount(first.value)} on {formatDay(first.at)}
                        </td>
                        <td className="py-1 pr-3">
                          {formatCount(last.value)} on {formatDay(last.at)}
                        </td>
                        <td className="py-1 pr-3 text-right">{formatSignedPercent(last.change)}</td>
                        <td className="py-1 text-right">{s.points.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ChartTable>
          </>
        ) : (
          <p className="text-muted-foreground py-6 text-[13px]">
            No profile has two follower observations a day apart in this period yet. Scopie observes
            each public profile once a day, starting the day it’s added; history from before that
            isn’t available.
          </p>
        )}
      </div>
      <TopGrowing model={model} orgSlug={orgSlug} />
    </Card>
  );
}

function TopGrowing({ model, orgSlug }: Props) {
  return (
    <div className="border-t">
      <h4 className="px-5 pt-3 text-xs font-semibold">Top growing profiles (observed)</h4>
      {model.topGrowing.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile</TableHead>
              <TableHead className="text-right">Growth</TableHead>
              <TableHead>Observed</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.topGrowing.map((row) => {
              const g = row.growth;
              if (g.status !== 'ok') return null;
              return (
                <TableRow key={row.profile.id}>
                  <TableCell className="max-w-56">
                    <ProfileLink orgSlug={orgSlug} profile={row.profile} showRole />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="font-medium">{formatSignedPercent(g.rate!)}</span>
                    <span className="text-muted-foreground block text-xs">
                      {formatSignedCount(g.change)} followers
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatCount(g.first.value)} on {formatDay(g.first.at)} →{' '}
                    {formatCount(g.last.value)} on {formatDay(g.last.at)}
                    <span className="block">{g.observations} observations</span>
                  </TableCell>
                  <TableCell>
                    <SourceBadges sources={[g.dataSource]} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <SectionEmpty>Not enough observations yet.</SectionEmpty>
      )}
      {model.growthMissing.length ? (
        <p className="text-muted-foreground border-t px-5 py-2.5 text-xs">
          Not ranked ({model.growthMissing.length}):{' '}
          {model.growthMissing
            .map(
              (r) =>
                `${r.profile.name} (${r.growth.status === 'ok' ? 'no starting value' : UNAVAILABLE_LABELS[r.growth.reason]})`,
            )
            .slice(0, 6)
            .join(', ')}
          {model.growthMissing.length > 6 ? ', …' : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Posts per week: the weekly chart (one platform) and the per-profile ranking. */
export function PostingFrequency({ model, orgSlug }: Props) {
  const { weekly } = model;
  const seriesKeys = (['owned', 'competitor', 'other'] as const).filter((key) =>
    weekly.buckets.some((b) => b.groups[key].profiles > 0),
  );
  const series = seriesKeys.map((key, slot) => ({ key, label: ROLE_GROUP_LABELS[key], slot }));
  const platform = weekly.platformKey ? platformName(weekly.platformKey) : null;
  const postSources = new Set(model.rows.flatMap((r) => postSourcesOf(r, model.source)));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Posting frequency</CardTitle>
          <SourceBadges sources={postSources} />
        </div>
        <CardDescription>
          Posts per week, counted only where Scopie holds the profile’s complete post history, so
          missing history is never read as “no posts”.
        </CardDescription>
      </CardHeader>
      <div className="space-y-3 px-5 py-4">
        {series.length && platform ? (
          <>
            <p className="text-xs font-semibold">Average posts per profile, by week ({platform})</p>
            <ColumnChart
              title={`Posts per week per profile, ${platform}`}
              description="Average number of posts per profile in each 7-day week, by group."
              series={series}
              groups={weekly.buckets.map((b) => ({
                key: b.start,
                label: formatDay(b.start),
                values: series.map((s) => {
                  const g = b.groups[s.key];
                  return {
                    key: s.key,
                    value: g.perProfile,
                    tooltip:
                      g.perProfile === null
                        ? `${s.label}, week of ${formatDay(b.start)}: no profile with complete history`
                        : `${s.label}, week of ${formatDay(b.start)}: ${formatDecimal(g.perProfile)} posts per profile (${g.posts} posts, ${g.profiles} profiles)`,
                  };
                }),
              }))}
              formatY={formatDecimal}
            />
            <ChartTable summary="Show as table">
              <table className="w-full text-left">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Week starting</th>
                    {series.map((s) => (
                      <th key={s.key} className="py-1 pr-3 text-right font-medium">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {weekly.buckets.map((b) => (
                    <tr key={b.start} className="border-t">
                      <td className="py-1 pr-3">{formatDay(b.start)}</td>
                      {series.map((s) => {
                        const g = b.groups[s.key];
                        return (
                          <td key={s.key} className="py-1 pr-3 text-right">
                            {g.perProfile === null ? (
                              <Missing label="no complete history" />
                            ) : (
                              `${formatDecimal(g.perProfile)} (${g.posts} posts / ${g.profiles} profiles)`
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ChartTable>
          </>
        ) : (
          <p className="text-muted-foreground py-4 text-[13px]">
            No profile’s post history has been loaded yet. After a profile is added, Scopie reads
            its posts back up to 12 months; posting frequency appears once that’s done.
          </p>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Profile</TableHead>
            <TableHead className="text-right">Posts / week</TableHead>
            <TableHead className="text-right">Posts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.frequencyRanked.slice(0, 8).map((row) => (
            <TableRow key={row.profile.id}>
              <TableCell className="max-w-56">
                <ProfileLink orgSlug={orgSlug} profile={row.profile} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.frequency.status === 'ok' ? (
                  <>
                    <span className="font-medium">{formatDecimal(row.frequency.postsPerWeek)}</span>
                    {row.frequency.clipped ? (
                      <span
                        className="text-muted-foreground block text-xs"
                        title={row.frequency.clipNote ?? undefined}
                      >
                        since {formatDay(row.frequency.from)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <Missing result={row.frequency} />
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.frequency.status === 'ok' ? formatCount(row.frequency.posts) : '–'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Median public engagement per post at 7 days, ranked. */
export function TopEngagement({ model, orgSlug }: Props) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Top public engagement</CardTitle>
          <SourceBadges sources={[model.source]} />
        </div>
        <CardDescription>
          Median likes + comments per post at {ENGAGEMENT_AGE_DAYS} days old, for posts published{' '}
          {formatPeriod(model.engagementWindow)}. Only profiles with at least{' '}
          {MIN_POSTS_FOR_COMPARISON} measured posts are ranked. Posts with hidden likes are left out
          and counted.
        </CardDescription>
      </CardHeader>
      {model.topEngagement.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile</TableHead>
              <TableHead className="text-right">Median</TableHead>
              <TableHead className="text-right">Mean</TableHead>
              <TableHead className="text-right">Posts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.topEngagement.map((row) => {
              const e = row.engagement;
              if (e.status !== 'ok') return null;
              return (
                <TableRow key={row.profile.id}>
                  <TableCell className="max-w-56">
                    <ProfileLink orgSlug={orgSlug} profile={row.profile} showRole />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCount(e.median)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(e.mean)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.posts}
                    {e.excludedHidden ? (
                      <span className="text-muted-foreground block text-xs">
                        +{e.excludedHidden} hidden by owner
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <SectionEmpty>
          No profile has {MIN_POSTS_FOR_COMPARISON} posts measured at {ENGAGEMENT_AGE_DAYS} days old
          in this period yet.
        </SectionEmpty>
      )}
      {model.engagementTooFew.length ? (
        <p className="text-muted-foreground border-t px-5 py-2.5 text-xs">
          Not ranked ({model.engagementTooFew.length}):{' '}
          {model.engagementTooFew
            .slice(0, 6)
            .map((r) => {
              const e = r.engagement;
              if (e.status === 'ok') return `${r.profile.name} (${e.posts} posts measured)`;
              return `${r.profile.name} (${e.excludedHidden ? 'likes hidden by owner' : UNAVAILABLE_LABELS[e.reason]})`;
            })
            .join(', ')}
          {model.engagementTooFew.length > 6 ? ', …' : ''}
        </p>
      ) : null}
    </Card>
  );
}

/** The posts with the highest public engagement at 7 days. */
export function TopPosts({ model, orgSlug }: Props) {
  const byId = new Map(model.rows.map((r) => [r.profile.id, r.profile]));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Top posts</CardTitle>
          <SourceBadges sources={[model.source]} />
        </div>
        <CardDescription>
          Highest likes + comments at {ENGAGEMENT_AGE_DAYS} days old, posts published{' '}
          {formatPeriod(model.engagementWindow)}.
          {model.hiddenLikesPosts
            ? ` ${model.hiddenLikesPosts} post(s) with likes hidden by the owner can’t be ranked.`
            : ''}
        </CardDescription>
      </CardHeader>
      {model.topPosts.length ? (
        <ol className="divide-y">
          {model.topPosts.map((top, index) => {
            const profile = byId.get(top.post.accountId);
            return (
              <li key={top.post.id} className="flex gap-3 px-5 py-3">
                <span className="text-muted-foreground w-4 shrink-0 pt-0.5 text-xs tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {profile ? <ProfileLink orgSlug={orgSlug} profile={profile} /> : null}
                    <Badge variant="muted">{MEDIA_FORMAT_LABELS[top.post.mediaFormat]}</Badge>
                    <span className="text-muted-foreground">
                      {formatDate(top.post.publishedAt)}
                    </span>
                  </div>
                  {top.post.caption ? (
                    <p className="text-muted-foreground line-clamp-2 text-xs">{top.post.caption}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="tabular-nums">
                      <strong className="font-semibold">{formatCount(top.engagement)}</strong>{' '}
                      <span className="text-muted-foreground">
                        ({formatCount(top.likes)} likes, {formatCount(top.comments)} comments)
                      </span>
                    </span>
                    <SourceBadges sources={[top.dataSource]} />
                    {top.post.permalink ? (
                      <a
                        href={top.post.permalink}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary inline-flex items-center gap-0.5 font-medium hover:underline"
                      >
                        Open post <ArrowUpRight className="size-3" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <SectionEmpty>
          No post has been measured at {ENGAGEMENT_AGE_DAYS} days old yet.
        </SectionEmpty>
      )}
    </Card>
  );
}

/** Every monitored profile side by side, on the same public numbers. */
export function ComparisonTable({ model, orgSlug }: Props) {
  const roleRank = (role: string) => (role === 'owned' ? 0 : role === 'competitor' ? 1 : 2);
  const rows = [...model.rows].sort(
    (a, b) =>
      roleRank(a.profile.businessRole) - roleRank(b.profile.businessRole) ||
      a.profile.name.localeCompare(b.profile.name),
  );
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Profile comparison</CardTitle>
        <CardDescription>
          Every profile is compared on the same {model.source === 'demo' ? 'DEMO' : 'public'}{' '}
          numbers, your own included, even when connected. Private metrics (reach, saves, shares)
          are never shown for profiles you don’t own. Followers and engagement compare only within
          one platform.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Profile</TableHead>
            <TableHead className="text-right">Followers</TableHead>
            <TableHead className="text-right">Growth</TableHead>
            <TableHead className="text-right">Posts / week</TableHead>
            <TableHead className="text-right">Median engagement</TableHead>
            <TableHead>Main format</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const top = row.formats.formats[0];
            const sources = new Set<DataSource>();
            if (row.latestFollowers) sources.add(row.latestFollowers.dataSource);
            if (row.engagement.status === 'ok') sources.add(row.engagement.dataSource);
            for (const s of postSourcesOf(row, model.source)) sources.add(s);
            return (
              <TableRow key={row.profile.id}>
                <TableCell className="max-w-64">
                  <ProfileLink orgSlug={orgSlug} profile={row.profile} showRole />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.latestFollowers ? (
                    <>
                      {formatCompact(row.latestFollowers.value)}
                      <span className="text-muted-foreground block text-xs">
                        {formatDay(row.latestFollowers.at)}
                      </span>
                    </>
                  ) : (
                    <Missing label="not observed yet" />
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.growth.status === 'ok' && row.growth.rate !== null ? (
                    <>
                      {formatSignedPercent(row.growth.rate)}
                      <span className="text-muted-foreground block text-xs">
                        {row.growth.observations} obs.
                      </span>
                    </>
                  ) : row.growth.status === 'ok' ? (
                    <Missing label="no starting value" />
                  ) : (
                    <Missing result={row.growth} />
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.frequency.status === 'ok' ? (
                    <>
                      {formatDecimal(row.frequency.postsPerWeek)}
                      {row.frequency.clipped ? (
                        <span
                          className="text-muted-foreground block text-xs"
                          title={row.frequency.clipNote ?? undefined}
                        >
                          since {formatDay(row.frequency.from)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <Missing result={row.frequency} />
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.engagement.status === 'ok' ? (
                    <>
                      {formatCount(row.engagement.median)}
                      <span className="text-muted-foreground block text-xs">
                        {row.engagement.posts} posts
                        {row.engagement.posts < MIN_POSTS_FOR_COMPARISON
                          ? ' (too few to rank)'
                          : ''}
                        {row.engagement.excludedHidden
                          ? ` · ${row.engagement.excludedHidden} hidden`
                          : ''}
                      </span>
                    </>
                  ) : row.engagement.excludedHidden ? (
                    <Missing label="hidden by owner" />
                  ) : (
                    <Missing result={row.engagement} />
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {top ? (
                    <>
                      {MEDIA_FORMAT_LABELS[top.format]}
                      <span className="text-muted-foreground block">
                        {formatShare(top.share)} of {row.formats.total}
                      </span>
                    </>
                  ) : (
                    <Missing label="no posts in period" />
                  )}
                </TableCell>
                <TableCell>
                  <SourceBadges sources={sources} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Own profiles vs competitors, and country vs country: medians per platform. */
export function GroupComparison({
  model,
  countryNames,
}: {
  model: DashboardModel;
  countryNames: Map<string, string>;
}) {
  const blocks = model.groups.filter((g) =>
    [...g.growth, ...g.frequency, ...g.engagement].some((s) => s.profiles > 0),
  );
  const countries = model.countries.filter((c) =>
    [...c.growth, ...c.engagement].some((s) => s.profiles > 0),
  );
  const cell = (
    summary: { median: number | null; profiles: number; unavailable: number } | undefined,
    format: (v: number) => string,
  ) =>
    summary && summary.median !== null ? (
      <>
        {format(summary.median)}
        <span className="text-muted-foreground block text-xs">
          {summary.profiles} profile{summary.profiles === 1 ? '' : 's'}
          {summary.unavailable ? ` · ${summary.unavailable} without a value` : ''}
        </span>
      </>
    ) : (
      <Missing label="no values yet" />
    );
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Groups</CardTitle>
          <SourceBadges sources={[model.source]} />
        </div>
        <CardDescription>
          Medians, so one very large profile doesn’t dominate a group. Each platform is shown on its
          own. Profiles without a value are counted, not treated as zero.
        </CardDescription>
      </CardHeader>
      {blocks.length ? (
        blocks.map((block) => (
          <div key={block.platformKey} className="border-b last:border-0">
            <h4 className="px-5 pt-3 text-xs font-semibold">
              {platformName(block.platformKey)}: own profiles vs others
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Follower growth</TableHead>
                  <TableHead className="text-right">Posts / week</TableHead>
                  <TableHead className="text-right">Median engagement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(['owned', 'competitor', 'other'] as const)
                  .filter((key) =>
                    [...block.growth, ...block.frequency, ...block.engagement].some(
                      (s) => s.key === key,
                    ),
                  )
                  .map((key) => (
                    <TableRow key={key}>
                      <TableCell>{ROLE_GROUP_LABELS[key]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cell(
                          block.growth.find((s) => s.key === key),
                          formatSignedPercent,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cell(
                          block.frequency.find((s) => s.key === key),
                          formatDecimal,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cell(
                          block.engagement.find((s) => s.key === key),
                          formatCount,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            {countries.find((c) => c.platformKey === block.platformKey) ? (
              <>
                <h4 className="px-5 pt-3 text-xs font-semibold">
                  {platformName(block.platformKey)}: by country
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Country</TableHead>
                      <TableHead className="text-right">Follower growth</TableHead>
                      <TableHead className="text-right">Median engagement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {countries
                      .find((c) => c.platformKey === block.platformKey)!
                      .growth.map((g) => (
                        <TableRow key={g.key}>
                          <TableCell>
                            {g.key === '—' ? 'No country' : (countryNames.get(g.key) ?? g.key)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {cell(g, formatSignedPercent)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {cell(
                              countries
                                .find((c) => c.platformKey === block.platformKey)!
                                .engagement.find((e) => e.key === g.key),
                              formatCount,
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </>
            ) : null}
          </div>
        ))
      ) : (
        <SectionEmpty>Group medians appear once profiles have observed values.</SectionEmpty>
      )}
    </Card>
  );
}

/** The hashtags used most in posts published in the period. */
export function Hashtags({ model }: { model: DashboardModel }) {
  const postSources = new Set(model.rows.flatMap((r) => postSourcesOf(r, model.source)));
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Most used hashtags</CardTitle>
          <SourceBadges sources={postSources} />
        </div>
        <CardDescription>
          Number of posts using each hashtag, all monitored profiles,{' '}
          {formatPeriod(model.periods.current)}.
        </CardDescription>
      </CardHeader>
      {model.hashtags.length ? (
        <ul className="flex flex-wrap gap-1.5 px-5 py-4">
          {model.hashtags.map((h) => (
            <li key={h.tag}>
              <Badge variant="outline" className="font-normal">
                #{h.tag} <span className="text-muted-foreground tabular-nums">{h.posts}</span>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <SectionEmpty>No hashtags in posts from this period.</SectionEmpty>
      )}
    </Card>
  );
}
