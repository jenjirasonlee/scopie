'use server';

import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/auth/redirect';
import { createClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import { echoValues, fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { signInSchema, signUpSchema } from '@/schemas/auth';

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Same message for unknown email and wrong password: don't reveal which accounts exist.
    return { status: 'error', message: 'Email or password is incorrect.', values: echoValues(raw) };
  }

  redirect(safeNextPath(formData.get('next')));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/confirm`,
    },
  });

  if (error) {
    return { status: 'error', message: error.message, values: echoValues(raw) };
  }

  // With email confirmation enabled, Supabase returns no session until the link is clicked.
  if (!data.session) {
    return {
      status: 'success',
      message: 'Check your inbox for a confirmation link to finish creating your account.',
    };
  }

  redirect('/onboarding');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}
