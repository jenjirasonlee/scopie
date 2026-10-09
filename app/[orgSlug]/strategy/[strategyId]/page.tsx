import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, Play, Undo2, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { PageHeader } from '@/components/shared/page-header';
import { SubmitButton } from '@/components/shared/submit-button';
import {
  ChecklistForm,
  DeleteStrategyForm,
  ObjectiveForm,
  PillarTargetsForm,
  StrategyBasicsForm,
  StrategyTextForm,
} from '@/components/strategy/strategy-forms';
import { StrategyMeasuresPanel } from '@/components/strategy/coverage-panel';
import { StrategyScope } from '@/components/strategy/strategy-scope';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listCountries, listPlatforms } from '@/lib/accounts/queries';
import { platformName } from '@/lib/analytics/names';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';
import {
  addObjective,
  deleteStrategy,
  removeObjective,
  saveStrategyAudiences,
  saveStrategyCompetitors,
  savePillarTargets,
  setStrategyStatus,
  updateObjective,
  updateStrategyBasics,
  updateStrategyPriorities,
  updateStrategyTone,
} from '@/lib/strategy/actions';
import { getStrategy, listCompetitorProfiles } from '@/lib/strategy/queries';
import {
  formatStrategyPeriod,
  formatTarget,
  KPI_HELP,
  KPI_LABELS,
  PERIOD_STATE_LABELS,
  periodState,
  pillarTargetTotal,
  STRATEGY_STATUS_HELP,
  STRATEGY_STATUS_LABELS,
  STRATEGY_STATUS_VARIANT,
  todayIn,
  type StrategyStatus,
} from '@/lib/strategy/shared';
import { listTaxonomy } from '@/lib/taxonomy/queries';
import { pillarColorClass } from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Strategy' };

/** The status moves offered from each status. */
const STATUS_MOVES: Record<
  StrategyStatus,
  { status: StrategyStatus; label: string; icon: typeof Play; primary?: boolean }[]
> = {
  draft: [
    { status: 'active', label: 'Make active', icon: Play, primary: true },
    { status: 'archived', label: 'Archive', icon: Archive },
  ],
  active: [
    { status: 'draft', label: 'Back to draft', icon: Undo2 },
    { status: 'archived', label: 'Archive', icon: Archive },
  ],
  archived: [{ status: 'draft', label: 'Restore as draft', icon: ArchiveRestore }],
};

/** A card with an "Edit" fold for managers. */
function Section({
  title,
  description,
  edit,
  editLabel = 'Edit',
  children,
}: {
  title: string;
  description?: string;
  edit?: React.ReactNode;
  editLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        {edit ? (
          <details className="rounded-md border px-3 py-2">
            <summary className="text-primary cursor-pointer text-[13px] font-medium">
              {editLabel}
            </summary>
            <div className="pt-3">{edit}</div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-[13px]">{children}</p>;
}

export default async function StrategyPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; strategyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug, strategyId }, search] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(strategyId).success) notFound();
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'strategy.manage');
  const [strategy, countries, platforms, taxonomy, competitorProfiles] = await Promise.all([
    getStrategy(org.id, strategyId),
    listCountries(),
    listPlatforms(),
    listTaxonomy(org.id),
    canManage ? listCompetitorProfiles(org.id) : Promise.resolve([]),
  ]);
  if (!strategy) notFound();

  const today = todayIn(org.default_timezone);
  const state = periodState(strategy.periodStart, strategy.periodEnd, today);
  const pillarTotal = pillarTargetTotal(strategy.pillars);
  const bind = <A extends unknown[], R>(fn: (slug: string, id: string, ...rest: A) => R) =>
    fn.bind(null, orgSlug, strategy.id);

  // Inactive pillars and audiences stay listed only when this strategy already uses them.
  const targeted = new Map(strategy.pillars.map((p) => [p.pillarId, p.targetShare]));
  const pillarRows = taxonomy.pillars
    .filter((p) => p.isActive || targeted.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isActive: p.isActive,
      share: targeted.get(p.id) ?? null,
    }));
  const chosenAudiences = new Set(strategy.audiences.map((a) => a.audienceId));
  const audienceOptions = taxonomy.audiences
    .filter((a) => a.isActive || chosenAudiences.has(a.id))
    .map((a) => ({ value: a.id, label: a.isActive ? a.name : `${a.name} (inactive)` }));
  const competitorOptions = competitorProfiles.map((c) => ({
    value: c.accountId,
    label: c.name,
    detail: [
      c.handle ? `@${c.handle.replace(/^@/, '')}` : null,
      platformName(c.platformKey),
      c.countryCode,
      c.isActive ? null : 'monitoring paused',
    ]
      .filter(Boolean)
      .join(' · '),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={strategy.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant={STRATEGY_STATUS_VARIANT[strategy.status]}>
              {STRATEGY_STATUS_LABELS[strategy.status]}
            </Badge>
            {org.is_demo ? <Badge variant="demo">Demo</Badge> : null}
            <span>
              {formatStrategyPeriod(strategy.periodStart, strategy.periodEnd)}
              {strategy.status === 'archived' ? '' : ` · ${PERIOD_STATE_LABELS[state]}`}
            </span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${orgSlug}/strategy`}>
                <ArrowLeft aria-hidden />
                All strategies
              </Link>
            </Button>
            {canManage
              ? STATUS_MOVES[strategy.status].map((move) => (
                  <form key={move.status} action={setStrategyStatus.bind(null, orgSlug)}>
                    <input type="hidden" name="strategyId" value={strategy.id} />
                    <input type="hidden" name="status" value={move.status} />
                    <SubmitButton size="sm" variant={move.primary ? 'default' : 'ghost'}>
                      <move.icon aria-hidden />
                      {move.label}
                    </SubmitButton>
                  </form>
                ))
              : null}
          </>
        }
      />

      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2">
        <StrategyScope
          countryCodes={strategy.countryCodes}
          platformKeys={strategy.platformKeys}
          countries={countries}
          platforms={platforms}
        />
        <p className="text-muted-foreground max-w-md text-[13px]">
          {STRATEGY_STATUS_HELP[strategy.status]}
        </p>
      </div>

      {search.created ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertDescription>
            Strategy created as a draft. Add objectives and pillar targets below, then make it
            active when the team should work to it.
          </AlertDescription>
        </Alert>
      ) : null}
      {canManage ? null : (
        <p className="text-muted-foreground text-[13px]">
          You can view this strategy. Owners, admins and managers can change it.
        </p>
      )}

      <StrategyMeasuresPanel
        orgId={org.id}
        orgSlug={org.slug}
        isDemoOrg={org.is_demo}
        timeZone={org.default_timezone}
        strategy={{
          periodStart: strategy.periodStart,
          periodEnd: strategy.periodEnd,
          countryCodes: strategy.countryCodes,
          platformKeys: strategy.platformKeys,
          pillars: strategy.pillars.map((p) => ({
            pillarId: p.pillarId,
            name: p.name,
            color: p.color,
            targetShare: p.targetShare,
          })),
          objectives: strategy.objectives.map((o) => ({
            id: o.id,
            name: o.name,
            kpi: o.kpi,
            targetValue: o.targetValue,
          })),
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Section
            title="Summary"
            edit={
              canManage ? (
                <StrategyBasicsForm
                  action={bind(updateStrategyBasics)}
                  defaults={{
                    name: strategy.name,
                    summary: strategy.summary,
                    periodStart: strategy.periodStart,
                    periodEnd: strategy.periodEnd,
                    countryCodes: strategy.countryCodes,
                    platformKeys: strategy.platformKeys,
                  }}
                  countries={countries.map((c) => ({ value: c.code, label: c.name }))}
                  platforms={platforms.map((p) => ({ value: p.key, label: p.name }))}
                  submitLabel="Save"
                  idPrefix="basics"
                />
              ) : null
            }
            editLabel="Edit name, period, markets and platforms"
          >
            {strategy.summary ? (
              <p className="text-[13px] whitespace-pre-line">{strategy.summary}</p>
            ) : (
              <Empty>No summary yet.</Empty>
            )}
          </Section>

          <Section
            title="Objectives"
            description="What this strategy should achieve, how each goal is measured, and the target for the period."
          >
            {strategy.objectives.length ? (
              <ol className="divide-y rounded-md border">
                {strategy.objectives.map((objective) => (
                  <li key={objective.id} className="space-y-2 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium break-words">{objective.name}</p>
                        <p className="text-[13px]">
                          <span className="font-medium">
                            {formatTarget(objective.kpi, objective.targetValue)}
                          </span>
                          <span className="text-muted-foreground">
                            {' '}
                            · {KPI_LABELS[objective.kpi]}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">{KPI_HELP[objective.kpi]}</p>
                        {objective.description ? (
                          <p className="text-muted-foreground text-[13px] break-words whitespace-pre-line">
                            {objective.description}
                          </p>
                        ) : null}
                      </div>
                      {canManage ? (
                        <form action={removeObjective.bind(null, orgSlug)}>
                          <input type="hidden" name="strategyId" value={strategy.id} />
                          <input type="hidden" name="objectiveId" value={objective.id} />
                          <SubmitButton
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${objective.name}`}
                            title="Content linked to this objective stays, but loses the link."
                          >
                            <X aria-hidden />
                            Remove
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                    {canManage ? (
                      <details>
                        <summary className="text-primary cursor-pointer text-xs font-medium">
                          Edit
                        </summary>
                        <div className="pt-3">
                          <ObjectiveForm
                            action={updateObjective.bind(null, orgSlug, strategy.id, objective.id)}
                            defaults={{
                              name: objective.name,
                              description: objective.description,
                              kpi: objective.kpi,
                              targetValue: objective.targetValue,
                            }}
                            submitLabel="Save"
                            idPrefix={`objective-${objective.id}`}
                          />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No objectives yet.</Empty>
            )}
            {canManage ? (
              <details className="rounded-md border px-3 py-2">
                <summary className="text-primary cursor-pointer text-[13px] font-medium">
                  Add an objective
                </summary>
                <div className="pt-3">
                  <ObjectiveForm
                    action={bind(addObjective)}
                    submitLabel="Add objective"
                    idPrefix="new-objective"
                  />
                </div>
              </details>
            ) : null}
            {canManage && strategy.objectives.length ? (
              <p className="text-muted-foreground text-xs">
                Removing an objective keeps the content linked to it; only the link is cleared.
              </p>
            ) : null}
          </Section>

          <Section
            title="Pillar targets"
            description="How much of the content in this strategy should go to each content pillar."
            edit={
              canManage && pillarRows.length ? (
                <PillarTargetsForm
                  action={bind(savePillarTargets)}
                  pillars={pillarRows}
                  idPrefix="pillar-share"
                />
              ) : null
            }
            editLabel="Set pillar targets"
          >
            {strategy.pillars.length ? (
              <>
                <ul className="space-y-2.5">
                  {strategy.pillars.map((pillar) => (
                    <li key={pillar.pillarId} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className={cn(
                              'size-3 shrink-0 rounded-full',
                              pillarColorClass(pillar.color),
                            )}
                          />
                          <span className="truncate">
                            {pillar.name}
                            {pillar.isActive ? null : (
                              <span className="text-muted-foreground"> (inactive)</span>
                            )}
                          </span>
                        </span>
                        <span className="font-medium tabular-nums">{pillar.targetShare}%</span>
                      </div>
                      <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${Math.min(pillar.targetShare, 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {pillarTotal}% of content has a pillar target
                  {pillarTotal < 100
                    ? `; the other ${Math.round((100 - pillarTotal) * 10) / 10}% is free.`
                    : '.'}
                </p>
              </>
            ) : (
              <Empty>No pillar targets yet.</Empty>
            )}
            {canManage && pillarRows.length === 0 ? (
              <p className="text-muted-foreground text-[13px]">
                Add content pillars first in{' '}
                <Link
                  href={`/${orgSlug}/settings/taxonomy?list=pillars`}
                  className="text-primary hover:underline"
                >
                  Settings → Content taxonomy
                </Link>
                .
              </p>
            ) : null}
          </Section>
        </div>

        <aside className="min-w-0 space-y-6">
          <Section
            title="Priorities"
            edit={
              canManage ? (
                <StrategyTextForm
                  action={bind(updateStrategyPriorities)}
                  name="priorities"
                  label="Priorities"
                  hint="One per line, most important first. Up to 10."
                  defaultValue={strategy.priorities.join('\n')}
                  rows={5}
                  placeholder={'More grower stories\nGrow Reels in the Netherlands'}
                  idPrefix="priorities"
                />
              ) : null
            }
          >
            {strategy.priorities.length ? (
              <ol className="list-decimal space-y-1 pl-5 text-[13px]">
                {strategy.priorities.map((priority, index) => (
                  <li key={index} className="break-words">
                    {priority}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No priorities yet.</Empty>
            )}
          </Section>

          <Section
            title="Tone of voice"
            edit={
              canManage ? (
                <StrategyTextForm
                  action={bind(updateStrategyTone)}
                  name="toneOfVoice"
                  label="Tone of voice"
                  hint="How the content should sound, for the people writing it."
                  defaultValue={strategy.toneOfVoice ?? ''}
                  placeholder="e.g. Friendly and expert. Short sentences. No slang."
                  idPrefix="tone"
                />
              ) : null
            }
          >
            {strategy.toneOfVoice ? (
              <p className="text-[13px] break-words whitespace-pre-line">{strategy.toneOfVoice}</p>
            ) : (
              <Empty>No tone of voice yet.</Empty>
            )}
          </Section>

          <Section
            title="Audiences"
            edit={
              canManage && audienceOptions.length ? (
                <ChecklistForm
                  action={bind(saveStrategyAudiences)}
                  options={audienceOptions}
                  selected={[...chosenAudiences]}
                  legend="Audiences"
                />
              ) : null
            }
            editLabel="Choose audiences"
          >
            {strategy.audiences.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {strategy.audiences.map((audience) => (
                  <li key={audience.audienceId}>
                    <Badge variant={audience.isActive ? 'secondary' : 'muted'}>
                      {audience.name}
                      {audience.isActive ? '' : ' (inactive)'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No audiences chosen.</Empty>
            )}
            {canManage && audienceOptions.length === 0 ? (
              <p className="text-muted-foreground text-[13px]">
                Add audiences first in{' '}
                <Link
                  href={`/${orgSlug}/settings/taxonomy?list=audiences`}
                  className="text-primary hover:underline"
                >
                  Settings → Content taxonomy
                </Link>
                .
              </p>
            ) : null}
          </Section>

          <Section
            title="Competitors"
            description="Competitor profiles this strategy keeps an eye on."
            edit={
              canManage && competitorOptions.length ? (
                <ChecklistForm
                  action={bind(saveStrategyCompetitors)}
                  options={competitorOptions}
                  selected={strategy.competitors.map((c) => c.accountId)}
                  legend="Competitors"
                />
              ) : null
            }
            editLabel="Choose competitors"
          >
            {strategy.competitors.length ? (
              <ul className="space-y-2">
                {strategy.competitors.map((competitor) => (
                  <li key={competitor.accountId} className="flex items-center gap-2 text-[13px]">
                    <PlatformMark platformKey={competitor.platformKey} />
                    <span className="min-w-0">
                      <Link
                        href={`/${orgSlug}/accounts/${competitor.accountId}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {competitor.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {[
                          competitor.handle ? `@${competitor.handle.replace(/^@/, '')}` : null,
                          competitor.countryCode,
                          competitor.isActive ? null : 'monitoring paused',
                        ]
                          .filter(Boolean)
                          .join(' · ') || platformName(competitor.platformKey)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No competitors chosen.</Empty>
            )}
            {canManage && competitorOptions.length === 0 ? (
              <p className="text-muted-foreground text-[13px]">
                Mark profiles as competitors on the{' '}
                <Link href={`/${orgSlug}/accounts`} className="text-primary hover:underline">
                  Accounts
                </Link>{' '}
                page to choose them here.
              </p>
            ) : null}
          </Section>
        </aside>
      </div>

      {canManage ? (
        <details className="bg-card rounded-lg border px-4 py-3">
          <summary className="text-destructive cursor-pointer text-[13px] font-medium">
            Delete this strategy
          </summary>
          <div className="pt-3">
            <DeleteStrategyForm
              action={deleteStrategy.bind(null, orgSlug)}
              strategyId={strategy.id}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
