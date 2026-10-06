import type { Metadata } from 'next';
import { OrganizationForm } from '@/components/settings/organization-form';
import { can } from '@/lib/auth/permissions';
import { updateOrganization } from '@/lib/orgs/actions';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Organization' };

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const canEdit = can(role, 'org.update');
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Organization</h2>
        <p className="text-muted-foreground text-[13px]">
          {canEdit
            ? 'Owners and admins can change these settings.'
            : 'Only owners and admins can change these settings.'}
        </p>
      </div>
      <OrganizationForm
        action={updateOrganization.bind(null, orgSlug)}
        name={org.name}
        slug={org.slug}
        defaultTimezone={org.default_timezone}
        canEdit={canEdit}
      />
    </section>
  );
}
