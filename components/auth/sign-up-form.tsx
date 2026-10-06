'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { signUp } from '@/lib/auth/actions';
import { initialFormState } from '@/lib/forms';

export function SignUpForm() {
  const [state, action] = useActionState(signUp, initialFormState);

  if (state.status === 'success') {
    return <FormMessage state={state} />;
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <FormField id="fullName" label="Full name" errors={state.fieldErrors?.fullName}>
        <Input name="fullName" autoComplete="name" required defaultValue={state.values?.fullName} />
      </FormField>
      <FormField id="email" label="Work email" errors={state.fieldErrors?.email}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
        />
      </FormField>
      <FormField
        id="password"
        label="Password"
        hint="At least 8 characters."
        errors={state.fieldErrors?.password}
      >
        <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </FormField>
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-muted-foreground text-center text-[13px]">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
