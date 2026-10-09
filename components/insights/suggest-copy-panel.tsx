'use client';

import { Check, Sparkles } from 'lucide-react';
import { useActionState } from 'react';
import { SubmitButton } from '@/components/shared/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SuggestState } from '@/lib/ai/assistant';

type SuggestAction = (state: SuggestState) => Promise<SuggestState>;
type ChooseAction = (state: SuggestState, formData: FormData) => Promise<SuggestState>;

const idle: SuggestState = { status: 'idle' };

function ChooseForm({
  action,
  generationId,
  index,
}: {
  action: ChooseAction;
  generationId: string;
  index: number;
}) {
  const [state, formAction] = useActionState(action, idle);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="generationId" value={generationId} />
      <input type="hidden" name="option" value={index} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving as a new version…">
        <Check aria-hidden />
        Use this caption
      </SubmitButton>
      {state.status === 'error' && state.message ? (
        <p className="text-destructive text-xs" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * "Suggest copy": caption options from the AI model for this item, grounded in its brief and
 * strategy. A chosen option is saved as a new draft version; nothing is published.
 */
export function SuggestCopyPanel({
  modelReady,
  missing,
  suggestAction,
  chooseAction,
}: {
  modelReady: boolean;
  /** What the server is missing, shown to managers; null for everyone else. */
  missing: string[] | null;
  suggestAction: SuggestAction;
  chooseAction: ChooseAction;
}) {
  const [state, formAction] = useActionState(suggestAction, idle);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          Suggest copy
        </CardTitle>
        <CardDescription>
          Caption options from an AI model, based on this item’s brief and its strategy’s tone of
          voice, pillars and audiences. The one you pick is saved as a new draft version for review;
          nothing is published.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!modelReady ? (
          <Alert>
            <AlertDescription>
              Suggesting copy needs an AI key on the server, so there are no suggestions here.
              {missing?.length
                ? ` Missing: ${missing.join(', ')}. See .env.example.`
                : ' Ask an owner, admin or manager to set one up.'}
            </AlertDescription>
          </Alert>
        ) : (
          <form action={formAction}>
            <SubmitButton size="sm" pendingLabel="Writing suggestions…">
              <Sparkles aria-hidden />
              {state.options?.length ? 'Suggest again' : 'Suggest captions'}
            </SubmitButton>
          </form>
        )}
        {state.status === 'error' && state.message ? (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.options?.length && state.generationId ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              Written by the AI model {state.model}. Read each one before using it.
            </p>
            <ol className="space-y-3">
              {state.options.map((option, index) => (
                <li
                  key={`${state.generationId}-${index}`}
                  className="space-y-2 rounded-md border p-3"
                >
                  <p className="text-[13px] whitespace-pre-wrap">{option.caption}</p>
                  {option.hashtags.length ? (
                    <p className="text-muted-foreground text-xs">
                      {option.hashtags.map((tag) => `#${tag}`).join(' ')}
                    </p>
                  ) : null}
                  {option.why ? (
                    <p className="text-muted-foreground text-xs italic">{option.why}</p>
                  ) : null}
                  <ChooseForm
                    action={chooseAction}
                    generationId={state.generationId!}
                    index={index}
                  />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
