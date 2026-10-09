import type { Metadata } from 'next';
import { PageHeader } from '@/components/shared/page-header';
import { StrategyBasicsForm } from '@/components/strategy/strategy-forms';
import { Card, CardContent } from '@/components/ui/card';
import { listCountries, listPlatforms } from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';
import { createStrategy } from '@/lib/strategy/actions';
import { quarterOf, todayIn } from '@/lib/strategy/shared';

export const metadata: Metadata = { title: 'New strategy' };

export default async function NewStrategyPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const [countries, platforms] = await Promise.all([listCountries(), listPlatforms()]);
  const quarter = quarterOf(todayIn(org.default_timezone));

  return (
    <div className="space-y-5">
      <PageHeader
        title="New strategy"
        description="Start with a name, a period and the markets it covers. It starts as a draft; add objectives, pillar targets and the rest once it is saved."
      />
      {can(role, 'strategy.manage') ? (
        <Card>
          <CardContent className="pt-6">
            <StrategyBasicsForm
              action={createStrategy.bind(null, orgSlug)}
              defaults={{ periodStart: quarter.start, periodEnd: quarter.end }}
              countries={countries.map((c) => ({ value: c.code, label: c.name }))}
              platforms={platforms.map((p) => ({ value: p.key, label: p.name }))}
              submitLabel="Create strategy"
              cancelHref={`/${orgSlug}/strategy`}
              idPrefix="new-strategy"
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Only owners, admins and managers can create strategies.
        </p>
      )}
    </div>
  );
}
