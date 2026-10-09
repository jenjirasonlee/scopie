import { ArrowRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DECISION_LABELS } from '@/lib/approvals/shared';
import { CONTENT_STATUS_LABELS, type ContentStatus } from '@/lib/content/shared';
import type { YourImpact } from '@/lib/productivity/queries';
import { formatCount, impactSummary } from '@/lib/productivity/shared';
import { impactCounts, impactTiles } from '@/lib/productivity/tiles';
import { formatDay, reportHref, safeExternalUrl } from '@/lib/reports/shared';
import { MetricTiles, Section } from './metric-tiles';

const LIST_LIMIT = 15;

/** The signed-in person's own recorded work. Private: built only for them. */
export function ImpactView({
  impact,
  orgSlug,
  timeZone,
  comparisonLabel,
  summaryTitle,
  periodWords,
}: {
  impact: YourImpact;
  orgSlug: string;
  timeZone: string;
  comparisonLabel: string | null;
  summaryTitle: string;
  periodWords: string;
}) {
  const sentences = impactSummary(impactCounts(impact), periodWords);
  const day = (iso: string) => formatDay(iso, timeZone) ?? '';
  const contentHref = (id: string) => `/${orgSlug}/content/${id}`;
  const status = (s: string) => CONTENT_STATUS_LABELS[s as ContentStatus] ?? s;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>{summaryTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-[13px]">
            {sentences.map((s) => (
              <li key={s.text} className="flex items-start gap-2">
                <ArrowRight
                  className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                />
                <span>
                  {s.text}{' '}
                  <a href={s.href} className="text-muted-foreground whitespace-nowrap underline">
                    See the records
                  </a>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-3 text-xs">
            Built only from what Scopie recorded. No scores, and no comparison with anyone else.
          </p>
        </CardContent>
      </Card>

      <MetricTiles tiles={impactTiles(impact)} comparisonLabel={comparisonLabel} />

      <Section id="your-content" title="Your content">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <EvidenceList
            title="Created by you"
            empty="You didn’t create any content in this period."
            rows={impact.createdItems.map((i) => ({
              key: i.id,
              href: contentHref(i.id),
              label: i.title,
              meta: `${status(i.status)} · ${day(i.at)}`,
            }))}
          />
          <EvidenceList
            title="Marked published by you"
            empty="You didn’t mark any content as published in this period."
            rows={impact.publishedItems.map((i) => ({
              key: i.id,
              href: contentHref(i.id),
              label: i.title,
              meta: day(i.at),
            }))}
          />
        </div>
      </Section>

      <Section
        id="campaigns-markets"
        title="Campaigns and markets"
        description="From the content you created in this period. Each link opens the team’s content list filtered to that campaign or market."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <EvidenceList
            title="Campaigns"
            empty="None of your content in this period has a campaign."
            rows={impact.campaigns.map((c) => ({
              key: c.id,
              href: `/${orgSlug}/content?campaign=${c.id}`,
              label: c.name,
              meta: `${formatCount(c.items)} ${c.items === 1 ? 'item' : 'items'} by you`,
            }))}
          />
          <EvidenceList
            title="Markets"
            empty="None of your content in this period has a country."
            rows={impact.markets.map((m) => ({
              key: m.code,
              href: `/${orgSlug}/content?country=${m.code}`,
              label: m.name,
              meta: `${formatCount(m.items)} ${m.items === 1 ? 'item' : 'items'} by you`,
            }))}
          />
        </div>
      </Section>

      <Section
        id="recommendations"
        title="Recommendations"
        description="Only the latest status of a recommendation is kept, so one you accepted and someone else later marked done shows under their name, not yours."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <EvidenceList
            title="Acted on by you"
            empty="You didn’t accept or complete any recommendation in this period."
            rows={impact.recommendationItems.map((r) => ({
              key: r.id,
              href: `/${orgSlug}/insights?tab=${r.status}#rec-${r.id}`,
              label: r.title,
              meta: `${r.status === 'done' ? 'Done' : 'Accepted'} · ${day(r.at)}`,
            }))}
          />
          <EvidenceList
            title="Content ideas you made from them"
            empty="You didn’t create content from a recommendation in this period."
            rows={impact.ideaItems.map((i) => ({
              key: i.id,
              href: contentHref(i.id),
              label: i.title,
              meta: `${status(i.status)} · ${day(i.at)}`,
            }))}
          />
        </div>
      </Section>

      <Section id="reviews" title="Your review decisions">
        <EvidenceList
          title="Decisions"
          empty="You didn’t make any review decisions in this period."
          rows={impact.reviewItems.map((r, index) => ({
            key: `${r.id}-${index}`,
            href: contentHref(r.id),
            label: r.title,
            meta: `${DECISION_LABELS[r.decision]} · ${day(r.at)}`,
          }))}
        />
      </Section>

      <Section
        id="reports"
        title="Reports and analyses"
        description={`You ran ${formatCount(impact.analyses.current)} AI ${impact.analyses.current === 1 ? 'analysis' : 'analyses'} in this period.`}
      >
        <EvidenceList
          title="Weekly reports you made by hand"
          empty="You didn’t make a weekly report by hand in this period."
          rows={impact.reportItems.map((r) => ({
            key: r.id,
            href: reportHref(orgSlug, r.id),
            label: r.title,
            meta: day(r.at),
          }))}
        />
      </Section>

      <Section
        id="performance"
        title="Results of your content"
        description="Content you created that was published in this period and linked to the post it became. Each post’s likes + comments at 7 days old, next to the middle value of its profile’s other posts in the same period."
      >
        {impact.performance.length ? (
          <Card className="min-w-0">
            <CardContent className="divide-y p-0">
              {impact.performance.map((p) => {
                const url = p.permalink ? safeExternalUrl(p.permalink) : null;
                return (
                  <div key={p.itemId} className="space-y-1 px-4 py-3 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={contentHref(p.itemId)}
                        className="min-w-0 font-medium break-words hover:underline"
                      >
                        {p.title}
                      </Link>
                      {p.platformKey ? <PlatformMark platformKey={p.platformKey} /> : null}
                      {p.profileName ? (
                        <span className="text-muted-foreground">{p.profileName}</span>
                      ) : null}
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground inline-flex items-center gap-1 text-xs underline"
                        >
                          Post <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                    {p.result.status === 'compared' ? (
                      <p className="flex flex-wrap items-center gap-2 tabular-nums">
                        <span>
                          {formatCount(p.result.value)} likes + comments; the profile’s usual post
                          got {formatCount(Math.round(p.result.usual))} (middle of {p.result.sample}{' '}
                          posts).
                        </span>
                        <Badge variant={p.result.above ? 'success' : 'outline'}>
                          {p.result.above ? 'Above usual' : 'Not above usual'}
                        </Badge>
                      </p>
                    ) : (
                      <p className="text-muted-foreground">N/A: {p.result.reason}</p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          <p className="text-muted-foreground text-[13px]">
            N/A: none of the content you created that was published in this period is linked to a
            post, so Scopie has no post results for it. When you mark content as published, choose
            the post it became to see its results here.
          </p>
        )}
      </Section>
    </div>
  );
}

function EvidenceList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { key: string; href: string; label: string; meta: string }[];
}) {
  const shown = rows.slice(0, LIST_LIMIT);
  return (
    <Card className="min-w-0 gap-3">
      <CardHeader>
        <CardTitle className="text-sm">
          {title}{' '}
          <span className="text-muted-foreground font-normal tabular-nums">{rows.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <ul className="space-y-1.5 text-[13px]">
            {shown.map((row) => (
              <li
                key={row.key}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3"
              >
                <Link href={row.href} className="min-w-0 break-words hover:underline">
                  {row.label}
                </Link>
                <span className="text-muted-foreground shrink-0 text-xs">{row.meta}</span>
              </li>
            ))}
            {rows.length > shown.length ? (
              <li className="text-muted-foreground text-xs">
                and {rows.length - shown.length} more
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[13px]">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}
