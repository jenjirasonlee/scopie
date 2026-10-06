'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/db/server';
import { fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { profileSchema } from '@/schemas/profile';

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const raw = formDataToObject(formData);
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: parsed.data.fullName, timezone: parsed.data.timezone })
    .eq('id', user.id);
  if (error) return { status: 'error', message: 'Could not save your profile.' };

  revalidatePath('/', 'layout');
  return { status: 'success', message: 'Profile saved.' };
}
