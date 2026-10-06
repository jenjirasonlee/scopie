import type { z } from 'zod';

/** Result returned by server actions bound to forms via useActionState. */
export type FormState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Submitted values echoed back so fields keep their input after a failed submit. */
  values?: Record<string, string>;
};

export const initialFormState: FormState = { status: 'idle' };

const SECRET_FIELDS = new Set(['password']);

/** Submitted values safe to echo back to the browser (never passwords). */
export function echoValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !SECRET_FIELDS.has(key)));
}

export function fieldErrorsFrom(error: z.ZodError, values?: Record<string, string>): FormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return {
    status: 'error',
    message: 'Please fix the highlighted fields.',
    fieldErrors,
    values: values ? echoValues(values) : undefined,
  };
}

export function formDataToObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && !key.startsWith('$ACTION')) result[key] = value;
  }
  return result;
}
