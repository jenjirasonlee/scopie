'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/shared/submit-button';
import { NativeSelect } from '@/components/ui/native-select';
import { ROLE_LABELS, type OrgRole } from '@/lib/auth/permissions';
import { initialFormState, type FormState } from '@/lib/forms';

export function MemberRoleForm({
  action,
  userId,
  role,
  roles,
  label,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  userId: string;
  role: OrgRole;
  roles: OrgRole[];
  label: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="w-32">
        <NativeSelect name="role" defaultValue={role} aria-label={`Role for ${label}`}>
          {roles.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <SubmitButton variant="outline" size="sm">
        Save
      </SubmitButton>
      {state.message ? (
        <span
          role="status"
          className={
            state.status === 'error' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
          }
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
