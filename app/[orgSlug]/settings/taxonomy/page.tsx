import type { Metadata } from 'next';
import { TaxonomySection, TaxonomyTabs } from '@/components/taxonomy/taxonomy-section';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';
import { listTaxonomy } from '@/lib/taxonomy/queries';
import { taxonomyKindFromSlug } from '@/lib/taxonomy/shared';

export const metadata: Metadata = { title: 'Content taxonomy' };

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TaxonomySettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const kind = taxonomyKindFromSlug(param(search.list));
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'strategy.manage');
  const taxonomy = await listTaxonomy(org.id);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Content taxonomy</h2>
        <p className="text-muted-foreground text-[13px]">
          The lists you tag content and posts with, so they can be compared and planned.
        </p>
        {canManage ? null : (
          <p className="text-muted-foreground text-[13px]">
            You can view these lists. Owners, admins and managers can change them.
          </p>
        )}
      </div>

      <TaxonomyTabs orgSlug={orgSlug} current={kind} taxonomy={taxonomy} />
      <TaxonomySection
        key={kind}
        orgSlug={orgSlug}
        kind={kind}
        items={taxonomy[kind]}
        canManage={canManage}
      />
    </section>
  );
}
