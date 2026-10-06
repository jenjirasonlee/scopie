import { DemoBanner } from '@/components/shared/demo-banner';
import { listMyOrganizations, getOrgContext } from '@/lib/orgs/queries';
import { MobileNav } from './mobile-nav';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

export async function Topbar({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const [{ org, role, user }, organizations] = await Promise.all([
    getOrgContext(orgSlug),
    listMyOrganizations(),
  ]);
  return (
    <>
      <header className="bg-background flex h-12 items-center gap-2 border-b px-3 md:px-6">
        <MobileNav />
        <OrgSwitcher
          current={{ id: org.id, name: org.name, slug: org.slug, role, is_demo: org.is_demo }}
          organizations={organizations}
        />
        <div className="ml-auto flex items-center gap-2">
          <UserMenu orgSlug={org.slug} name={user.fullName} email={user.email} />
        </div>
      </header>
      {org.is_demo ? <DemoBanner /> : null}
    </>
  );
}

export function TopbarSkeleton() {
  return <div className="h-12 border-b" aria-hidden />;
}
