'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { signIn } from '@/lib/auth/actions';
import { initialFormState } from '@/lib/forms';

export function SignInForm() {
  const [state, action] = useActionState(signIn, initialFormState);
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';
  const confirmationFailed = searchParams.get('error') === 'confirmation';

  return (
    <form action={action} className="space-y-4" noValidate>
      {confirmationFailed ? (
        <Alert variant="destructive">
          <AlertDescription>
            That confirmation link is invalid or has expired. Sign in or sign up again.
          </AlertDescription>
        </Alert>
      ) : null}
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next} />
      <FormField id="email" label="Email" errors={state.fieldErrors?.email}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
        />
      </FormField>
      <FormField id="password" label="Password" errors={state.fieldErrors?.password}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </FormField>
      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
      <p className="text-muted-foreground text-center text-[13px]">
        New to Scopie?{' '}
        <Link href="/sign-up" className="text-primary font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
