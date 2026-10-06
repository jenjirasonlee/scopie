import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-muted-foreground text-[13px]">Welcome back to Scopie.</p>
      </div>
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  );
}
