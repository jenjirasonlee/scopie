import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth/session';
import { listMyOrganizations } from '@/lib/orgs/queries';

// "/" sends people to the right place: sign-in, onboarding, or their first organization.
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <RouteHome />
    </Suspense>
  );
}

async function RouteHome(): Promise<null> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  const organizations = await listMyOrganizations();
  const first = organizations[0];
  redirect(first ? `/${first.slug}/dashboard` : '/onboarding');
}
