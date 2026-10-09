import { FileText } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { createIdeaFromRecommendation, setRecommendationStatusAction } from '@/lib/ai/actions';
import type { Insight, Recommendation } from '@/lib/ai/queries';
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_VARIANT,
  formatDuration,
  insightKindLabel,
  profileNames,
  RECOMMENDATION_TAB_LABELS,
  RECOMMENDATION_TABS,
  recommendationTabHref,
  SEVERITY_LABELS,
  SEVERITY_VARIANT,
  statusChangeLabel,
} from '@/lib/ai/shared';
import type { RecommendationStatus } from '@/lib/ai/types';
import { formatDateTime } from '@/lib/content/review';
import { CONTENT_STATUS_LABELS } from '@/lib/content/shared';
import { cn } from '@/lib/utils';
import { EvidenceFold, signalLink } from './evidence-list';
import { RecommendationActions } from './insight-forms';

export function InsightCard({
  insight,
  orgSlug,
  names,
  timeZone,
  signalPaths,
}: {
  insight: Insight;
  orgSlug: string;
  names: ReadonlyMap<string, string>;
  timeZone: string;
  signalPaths: ReadonlyMap<string, string>;
}) {
  return (
    <article className="bg-card space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[insight.severity]}>
          {SEVERITY_LABELS[insight.severity]}
        </Badge>
        <span className="text-muted-foreground text-xs">{insightKindLabel(insight.kind)}</span>
      </div>
      <h3 className="text-sm font-semibold">{insight.title}</h3>
      <p className="text-[13px] leading-relaxed whitespace-pre-line">{insight.body}</p>
      <EvidenceFold
        evidence={insight.evidence}
        names={names}
        timeZone={timeZone}
        link={signalLink(orgSlug, insight.signalIds, signalPaths)}
      />
    </article>
  );
}

/** Open / Accepted / Done / Dismissed, each with how many recommendations it holds. */
export function RecommendationTabs({
  orgSlug,
  active,
  counts,
}: {
  orgSlug: string;
  active: RecommendationStatus;
  counts: Record<RecommendationStatus, number>;
}) {
  return (
    <nav
      aria-label="Recommendations"
      className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]"
    >
      {RECOMMENDATION_TABS.map((tab) => {
        const current = tab === active;
        return (
          <Link
            key={tab}
            href={`${recommendationTabHref(orgSlug, tab)}#recommendations`}
            aria-current={current ? 'page' : undefined}
            scroll={false}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pt-1 pb-2 text-[13px] whitespace-nowrap',
              current
                ? 'border-primary text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {RECOMMENDATION_TAB_LABELS[tab]}
            <span
              className={cn(
                'rounded-sm px-1.5 text-[11px] font-semibold tabular-nums',
                current ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {counts[tab]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="text-[13px] leading-relaxed whitespace-pre-line">{children}</div>
    </div>
  );
}

export function RecommendationCard({
  rec,
  orgSlug,
  names,
  timeZone,
  signalPaths,
  canAct,
}: {
  rec: Recommendation;
  orgSlug: string;
  names: ReadonlyMap<string, string>;
  timeZone: string;
  signalPaths: ReadonlyMap<string, string> | undefined;
  canAct: boolean;
}) {
  const experiment = rec.experiment;
  const experimentProfiles = experiment ? profileNames(experiment.accountIds, names) : [];
  const duration = experiment ? formatDuration(experiment.durationDays) : null;
  const changed = statusChangeLabel(
    rec.status,
    rec.statusChangedByName,
    rec.statusChangedAt ? formatDateTime(rec.statusChangedAt, timeZone) : null,
  );

  return (
    <article id={`rec-${rec.id}`} className="bg-card scroll-mt-20 space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold break-words">{rec.title}</h3>
        <Badge variant={CONFIDENCE_VARIANT[rec.confidence]}>
          {CONFIDENCE_LABELS[rec.confidence]}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Section label="What the data shows">{rec.observation}</Section>
        <Section label="What to try">{rec.recommendation}</Section>
        <Section label="Expected impact">{rec.expectedImpact}</Section>
        <Section label="Why this confidence">{rec.confidenceBasis}</Section>
      </div>

      <div className="space-y-2">
        {experiment ? (
          <details className="text-[13px]">
            <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs font-medium select-none">
              Suggested experiment
            </summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1.5 rounded-md border px-3 py-2 sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground text-xs">Hypothesis</dt>
              <dd>{experiment.hypothesis}</dd>
              <dt className="text-muted-foreground text-xs">Try</dt>
              <dd>{experiment.variant}</dd>
              {experiment.control ? (
                <>
                  <dt className="text-muted-foreground text-xs">Compare with</dt>
                  <dd>{experiment.control}</dd>
                </>
              ) : null}
              {experimentProfiles.length ? (
                <>
                  <dt className="text-muted-foreground text-xs">Profiles</dt>
                  <dd>{experimentProfiles.join(', ')}</dd>
                </>
              ) : null}
              {duration ? (
                <>
                  <dt className="text-muted-foreground text-xs">Run for</dt>
                  <dd>{duration}</dd>
                </>
              ) : null}
              {experiment.successMetric ? (
                <>
                  <dt className="text-muted-foreground text-xs">Success measure</dt>
                  <dd>{experiment.successMetric}</dd>
                </>
              ) : null}
            </dl>
          </details>
        ) : null}
        <EvidenceFold
          evidence={rec.evidence}
          names={names}
          timeZone={timeZone}
          link={signalLink(orgSlug, rec.signalIds, signalPaths)}
        />
      </div>

      {rec.contentItems.length ? (
        <ul className="space-y-1 text-[13px]">
          {rec.contentItems.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <span className="text-muted-foreground">Content idea:</span>
              <Link
                href={`/${orgSlug}/content/${item.id}`}
                className="text-primary min-w-0 truncate font-medium hover:underline"
              >
                {item.title}
              </Link>
              <span className="text-muted-foreground text-xs">
                ({CONTENT_STATUS_LABELS[item.status]})
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {changed || rec.statusNote ? (
        <p className="text-muted-foreground text-xs">
          {changed}
          {changed && rec.statusNote ? ': ' : ''}
          {rec.statusNote ? <span className="text-foreground">“{rec.statusNote}”</span> : null}
        </p>
      ) : null}

      {canAct ? (
        <div className="border-t pt-3">
          <RecommendationActions
            recommendationId={rec.id}
            status={rec.status}
            hasContentIdea={rec.contentItems.length > 0}
            setStatus={setRecommendationStatusAction.bind(null, orgSlug)}
            createIdea={createIdeaFromRecommendation.bind(null, orgSlug)}
          />
        </div>
      ) : null}
    </article>
  );
}
