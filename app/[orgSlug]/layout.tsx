import Link from 'next/link';
import { Suspense } from 'react';
import { Topbar, TopbarSkeleton } from '@/components/layout/topbar';
import { SidebarNav } from '@/components/layout/sidebar-nav';
import { Logo } from '@/components/shared/logo';
import { Skeleton } from '@/components/ui/skeleton';
import { getOrgContext } from '@/lib/orgs/queries';

export default function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar sticky top-0 hidden h-svh w-56 shrink-0 flex-col gap-5 border-r px-3 py-3.5 md:flex">
        <Link href="/" className="px-2.5">
          <Logo />
        </Link>
        <Suspense fallback={<NavSkeleton />}>
          <SidebarNav />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<TopbarSkeleton />}>
          <Topbar params={params} />
        </Suspense>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">
          <Suspense fallback={<PageSkeleton />}>
            <OrgGate params={params}>{children}</OrgGate>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/** Every page under /[orgSlug] renders only for members of that organization (404 otherwise). */
async function OrgGate({
  params,
  children,
}: {
  params: Promise<{ orgSlug: string }>;
  children: React.ReactNode;
}) {
  const { orgSlug } = await params;
  await getOrgContext(orgSlug);
  return children;
}

function NavSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: 12 }, (_, index) => (
        <Skeleton key={index} className="h-7" />
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-64" />
    </div>
  );
}
