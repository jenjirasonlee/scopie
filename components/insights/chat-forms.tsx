'use client';

import { Loader2, MessageCircleQuestion, Send, Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { initialFormState, type FormState } from '@/lib/forms';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

function QuestionButtons({ questions }: { questions: readonly { id: string; label: string }[] }) {
  const { pending } = useFormStatus();
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {questions.map((q) => (
          <Button
            key={q.id}
            type="submit"
            name="question"
            value={q.id}
            variant="outline"
            size="sm"
            disabled={pending}
            className="h-auto py-1.5 text-left whitespace-normal"
          >
            <MessageCircleQuestion aria-hidden />
            {q.label}
          </Button>
        ))}
      </div>
      {pending ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Reading your data…
        </p>
      ) : null}
    </>
  );
}

/** The ready questions: each runs Scopie's own tools and wording, no AI model needed. */
export function ReadyQuestionsForm({
  action,
  questions,
}: {
  action: Action;
  questions: readonly { id: string; label: string }[];
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="space-y-2">
      <QuestionButtons questions={questions} />
      {state.status === 'error' ? <FormMessage state={state} /> : null}
    </form>
  );
}

/** Free-text question. Without a model on the server it explains why it can't be used. */
export function AskForm({
  action,
  enabled,
  maxLength,
  disabledReason,
}: {
  action: Action;
  enabled: boolean;
  maxLength: number;
  disabledReason: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="space-y-2">
      <Label htmlFor="chat-question" className="text-[13px]">
        Ask your own question
      </Label>
      <Textarea
        id="chat-question"
        name="question"
        rows={2}
        maxLength={maxLength}
        disabled={!enabled}
        defaultValue={state.status === 'error' ? (state.values?.question ?? '') : ''}
        placeholder={
          enabled
            ? 'e.g. Which of our Instagram profiles posted most in the last 7 days?'
            : 'Typed questions need an AI key on the server.'
        }
      />
      {!enabled ? <div className="text-muted-foreground text-xs">{disabledReason}</div> : null}
      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton size="sm" disabled={!enabled} pendingLabel="Thinking… this can take a moment">
          <Send aria-hidden />
          Ask
        </SubmitButton>
      </div>
    </form>
  );
}

export function ClearChatForm({ action }: { action: () => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <SubmitButton size="sm" variant="ghost" pendingLabel="Clearing…">
        <Trash2 aria-hidden />
        Clear conversation
      </SubmitButton>
      {state.status === 'error' ? <FormMessage state={state} /> : null}
    </form>
  );
}
