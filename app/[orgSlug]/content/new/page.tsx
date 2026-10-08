import type { Metadata } from 'next';
import { ContentForm } from '@/components/content/content-form';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { can } from '@/lib/auth/permissions';
import { createContentItem } from '@/lib/content/actions';
import { getContentOptionLists } from '@/lib/content/form-options';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'New content' };

export default async function NewContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const { org, role, user } = await getOrgContext(orgSlug);
  const options = await getContentOptionLists(org.id);
  // The calendar links here with ?date=YYYY-MM-DD to plan for that day.
  const date =
    typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : '';

  return (
    <div className="space-y-5">
      <PageHeader
        title="New content"
        description="A title is enough to start. Files can be added once it is saved."
      />
      {can(role, 'content.edit') ? (
        <Card>
          <CardContent className="pt-6">
            <ContentForm
              action={createContentItem.bind(null, orgSlug)}
              defaults={{ status: 'IDEA', ownerUserId: user.id, plannedDate: date }}
              options={options}
              timeZone={org.default_timezone}
              taxonomyHref={`/${orgSlug}/settings/taxonomy`}
              submitLabel="Create"
              cancelHref={`/${orgSlug}/content`}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Only editors, managers, admins and owners can add content.
        </p>
      )}
    </div>
  );
}
