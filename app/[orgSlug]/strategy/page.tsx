import { CheckCircle2, Plus, Target } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { StrategyScope } from '@/components/strategy/strategy-scope';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listCountries, listPlatforms } from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';
import { listStrategies } from '@/lib/strategy/queries';
import {
  formatStrategyPeriod,
  PERIOD_STATE_LABELS,
  periodState,
  STRATEGY_STATUS_LABELS,
  STRATEGY_STATUS_VARIANT,
  todayIn,
} from '@/lib/strategy/shared';

export const metadata: Metadata = { title: 'Strategy' };

export default async function StrategyListPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'strategy.manage');
  const [strategies, countries, platforms] = await Promise.all([
    listStrategies(org.id),
    listCountries(),
    listPlatforms(),
  ]);
  const today = todayIn(org.default_timezone);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Strategy"
        description={
          org.is_demo
            ? `${org.name}. Strategies here are DEMO DATA made for testing; none of it is real.`
            : 'What you want your content to achieve, for which markets and platforms, and over which period.'
        }
        actions={
          canManage && strategies.length ? (
            <Button asChild size="sm">
              <Link href={`/${orgSlug}/strategy/new`}>
                <Plus aria-hidden />
                New strategy
              </Link>
            </Button>
          ) : null
        }
      />

      {search.deleted ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertDescription>Strategy deleted.</AlertDescription>
        </Alert>
      ) : null}

      {strategies.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <div className="bg-muted text-muted-foreground mx-auto flex size-10 items-center justify-center rounded-md">
              <Target className="size-5" aria-hidden />
            </div>
            <h2 className="text-base font-semibold">No strategies yet</h2>
            <p className="text-muted-foreground mx-auto max-w-lg text-[13px]">
              A strategy is your plan for a period, such as a quarter. It says which markets and
              platforms it covers, what you want to achieve, and how much content should go to each
              pillar. Link content to its objectives to see how the plan is going.
            </p>
            {canManage ? (
              <Button asChild size="sm">
                <Link href={`/${orgSlug}/strategy/new`}>
                  <Plus aria-hidden />
                  New strategy
                </Link>
              </Button>
            ) : (
              <p className="text-muted-foreground text-[13px]">
                Owners, admins and managers can create strategies.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {strategies.map((strategy) => {
            const state = periodState(strategy.periodStart, strategy.periodEnd, today);
            return (
              <li key={strategy.id}>
                <Link
                  href={`/${orgSlug}/strategy/${strategy.id}`}
                  className="bg-card hover:border-primary/50 focus-visible:ring-ring/50 flex h-full flex-col gap-3 rounded-lg border p-4 outline-none focus-visible:ring-[3px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 text-sm font-semibold break-words">{strategy.name}</h2>
                    <Badge variant={STRATEGY_STATUS_VARIANT[strategy.status]}>
                      {STRATEGY_STATUS_LABELS[strategy.status]}
                    </Badge>
                  </div>
                  <p className="text-[13px]">
                    {formatStrategyPeriod(strategy.periodStart, strategy.periodEnd)}
                    {strategy.status === 'archived' ? null : (
                      <span className="text-muted-foreground"> · {PERIOD_STATE_LABELS[state]}</span>
                    )}
                  </p>
                  {strategy.summary ? (
                    <p className="text-muted-foreground line-clamp-2 text-[13px]">
                      {strategy.summary}
                    </p>
                  ) : null}
                  <StrategyScope
                    countryCodes={strategy.countryCodes}
                    platformKeys={strategy.platformKeys}
                    countries={countries}
                    platforms={platforms}
                    className="mt-auto"
                  />
                  <p className="text-muted-foreground text-xs">
                    {strategy.objectiveCount}{' '}
                    {strategy.objectiveCount === 1 ? 'objective' : 'objectives'}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
