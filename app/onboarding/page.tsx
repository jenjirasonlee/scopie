import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OnboardingForm } from '@/components/orgs/onboarding-form';
import { Logo } from '@/components/shared/logo';
import { requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Create organization' };

export default function OnboardingPage() {
  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo className="text-lg" />
      </div>
      <div className="bg-card w-full max-w-md rounded-lg border p-6">
        <div className="mb-5 space-y-1">
          <h1 className="text-lg font-semibold">Create your organization</h1>
          <p className="text-muted-foreground text-[13px]">
            An organization holds your team, social accounts and content. You&apos;ll be its owner.
          </p>
        </div>
        <Suspense>
          <Guard />
        </Suspense>
      </div>
    </main>
  );
}

async function Guard() {
  await requireUser();
  return <OnboardingForm />;
}
