'use client';

import { Ban, Check, Lightbulb, RotateCcw, Sparkles } from 'lucide-react';
import { useActionState } from 'react';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RecommendationStatus } from '@/lib/ai/types';
import { initialFormState, type FormState } from '@/lib/forms';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** The "Run analysis" button, with the result underneath once it finishes. */
export function RunAnalysisForm({ action, label }: { action: Action; label: string }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex max-w-sm flex-col items-end gap-2">
      <SubmitButton size="sm" pendingLabel="Analysing… this can take a minute">
        <Sparkles aria-hidden />
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** One button that posts the recommendation id (and a status) to an action. */
function StatusButton({
  action,
  recommendationId,
  status,
  children,
  pendingLabel,
  variant = 'outline',
}: {
  action: Action;
  recommendationId: string;
  status?: RecommendationStatus;
  children: React.ReactNode;
  pendingLabel: string;
  variant?: 'default' | 'outline' | 'ghost';
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="recommendationId" value={recommendationId} />
      {status ? <input type="hidden" name="status" value={status} /> : null}
      <SubmitButton size="sm" variant={variant} pendingLabel={pendingLabel}>
        {children}
      </SubmitButton>
      {state.status === 'error' ? <FormMessage state={state} /> : null}
    </form>
  );
}

function DismissForm({ action, recommendationId }: { action: Action; recommendationId: string }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const id = `dismiss-note-${recommendationId}`;
  return (
    <details className="group">
      <summary className="border-input bg-card hover:bg-secondary inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium select-none [&::-webkit-details-marker]:hidden">
        <Ban className="size-4" aria-hidden />
        Dismiss
      </summary>
      <form action={formAction} className="mt-2 w-full max-w-md space-y-2">
        <input type="hidden" name="recommendationId" value={recommendationId} />
        <input type="hidden" name="status" value="dismissed" />
        <Label htmlFor={id} className="text-xs">
          Why not? <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id={id}
          name="note"
          rows={2}
          maxLength={500}
          placeholder="e.g. We already tried this last quarter."
        />
        <FormMessage state={state} />
        <SubmitButton size="sm" variant="outline" pendingLabel="Dismissing…">
          Dismiss recommendation
        </SubmitButton>
      </form>
    </details>
  );
}

/** What an editor can do with a recommendation, depending on where it is now. */
export function RecommendationActions({
  recommendationId,
  status,
  hasContentIdea,
  setStatus,
  createIdea,
}: {
  recommendationId: string;
  status: RecommendationStatus;
  hasContentIdea: boolean;
  setStatus: Action;
  createIdea: Action;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === 'open' ? (
        <StatusButton
          action={createIdea}
          recommendationId={recommendationId}
          variant="default"
          pendingLabel="Creating…"
        >
          <Lightbulb aria-hidden />
          {hasContentIdea ? 'Open content idea' : 'Create content idea'}
        </StatusButton>
      ) : null}
      {status === 'open' || status === 'accepted' ? (
        <StatusButton
          action={setStatus}
          recommendationId={recommendationId}
          status="done"
          pendingLabel="Saving…"
        >
          <Check aria-hidden />
          Mark done
        </StatusButton>
      ) : null}
      {status === 'open' ? (
        <DismissForm action={setStatus} recommendationId={recommendationId} />
      ) : (
        <StatusButton
          action={setStatus}
          recommendationId={recommendationId}
          status="open"
          variant="ghost"
          pendingLabel="Reopening…"
        >
          <RotateCcw aria-hidden />
          Reopen
        </StatusButton>
      )}
    </div>
  );
}
