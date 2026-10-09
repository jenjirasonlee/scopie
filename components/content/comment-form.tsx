'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Textarea } from '@/components/ui/textarea';
import { addComment } from '@/lib/approvals/actions';
import { initialFormState } from '@/lib/forms';

type Member = { value: string; label: string };

/** A new comment, or a reply when `parentId` is set. Members can be mentioned from a list. */
export function CommentForm({
  orgSlug,
  itemId,
  parentId,
  members,
}: {
  orgSlug: string;
  itemId: string;
  parentId?: string;
  /** Members who can be mentioned (everyone but the person writing). */
  members: Member[];
}) {
  const [state, action] = useActionState(addComment.bind(null, orgSlug), initialFormState);
  const id = parentId ? `reply-${parentId}` : 'comment';
  const error = state.fieldErrors?.body?.[0];
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="itemId" value={itemId} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      {state.status === 'error' && !error ? <FormMessage state={state} /> : null}
      <label htmlFor={`${id}-body`} className="sr-only">
        {parentId ? 'Reply' : 'Comment'}
      </label>
      <Textarea
        id={`${id}-body`}
        name="body"
        rows={parentId ? 2 : 3}
        maxLength={5000}
        placeholder={parentId ? 'Write a reply' : 'Write a comment'}
        defaultValue={state.status === 'error' ? (state.values?.body ?? '') : ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {members.length ? (
        <details className="text-[13px]">
          <summary className="text-muted-foreground cursor-pointer select-none">
            Mention people
          </summary>
          <fieldset className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            <legend className="sr-only">Mention people. They get a notification.</legend>
            {members.map((member) => (
              <label key={member.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="mentions"
                  value={member.value}
                  className="accent-primary size-4"
                />
                <span className="truncate">{member.label}</span>
              </label>
            ))}
          </fieldset>
        </details>
      ) : null}
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant={parentId ? 'outline' : 'default'} pendingLabel="Posting…">
          {parentId ? 'Reply' : 'Add comment'}
        </SubmitButton>
        {state.status === 'success' ? (
          <span className="text-success text-xs" aria-live="polite">
            {parentId ? 'Reply added.' : state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
