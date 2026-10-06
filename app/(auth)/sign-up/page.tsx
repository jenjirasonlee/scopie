import type { Metadata } from 'next';
import { SignUpForm } from '@/components/auth/sign-up-form';

export const metadata: Metadata = { title: 'Create account' };

export default function SignUpPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Create your account</h1>
        <p className="text-muted-foreground text-[13px]">
          You can create or join an organization next.
        </p>
      </div>
      <SignUpForm />
    </div>
  );
}
