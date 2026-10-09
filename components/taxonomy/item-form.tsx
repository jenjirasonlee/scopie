'use client';

import { useActionState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { initialFormState, type FormState } from '@/lib/forms';
import {
  PILLAR_COLOR_LABELS,
  PILLAR_COLORS,
  pillarColorClass,
  TAXONOMY,
  type TaxonomyKind,
} from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type ItemDefaults = {
  name?: string;
  description?: string | null;
  color?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
};

/** Adds or edits one taxonomy item. Pillars also get a colour; campaigns get dates. */
export function TaxonomyItemForm({
  action,
  kind,
  item = {},
  submitLabel,
  idPrefix,
}: {
  action: Action;
  kind: TaxonomyKind;
  item?: ItemDefaults;
  submitLabel: string;
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const errors = state.fieldErrors ?? {};
  const value = (field: keyof ItemDefaults) => state.values?.[field] ?? item[field] ?? '';
  const id = (field: string) => `${idPrefix}-${field}`;
  const fieldMessage = Object.keys(errors).length > 0;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormField id={id('name')} label="Name" errors={errors.name}>
        <Input
          name="name"
          maxLength={80}
          required
          placeholder={TAXONOMY[kind].placeholder}
          defaultValue={value('name')}
          className="sm:max-w-sm"
        />
      </FormField>
      <FormField
        id={id('description')}
        label="Description"
        optional
        hint="A short note so everyone tags content the same way."
        errors={errors.description}
      >
        <Textarea
          name="description"
          maxLength={500}
          rows={2}
          defaultValue={value('description')}
          className="min-h-14"
        />
      </FormField>

      {kind === 'pillars' ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">
            Colour
            <span className="text-muted-foreground ml-1 font-normal">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {['', ...PILLAR_COLORS].map((color) => {
              const label = color
                ? PILLAR_COLOR_LABELS[color as keyof typeof PILLAR_COLOR_LABELS]
                : 'No colour';
              return (
                <label key={color || 'none'} title={label} className="cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value={color}
                    defaultChecked={value('color') === color}
                    className="peer sr-only"
                  />
                  <span className="sr-only">{label}</span>
                  <span
                    aria-hidden
                    className="peer-checked:ring-foreground peer-focus-visible:ring-ring/50 flex size-7 items-center justify-center rounded-full ring-offset-2 peer-checked:ring-2 peer-focus-visible:ring-[3px]"
                  >
                    <span className={cn('size-5 rounded-full', pillarColorClass(color))} />
                  </span>
                </label>
              );
            })}
          </div>
          {errors.color?.length ? (
            <p className="text-destructive text-xs">{errors.color[0]}</p>
          ) : null}
        </fieldset>
      ) : null}

      {kind === 'campaigns' ? (
        <div className="grid gap-4 sm:max-w-sm sm:grid-cols-2">
          <FormField id={id('startsOn')} label="Starts" optional errors={errors.startsOn}>
            <Input type="date" name="startsOn" defaultValue={value('startsOn')} />
          </FormField>
          <FormField id={id('endsOn')} label="Ends" optional errors={errors.endsOn}>
            <Input type="date" name="endsOn" defaultValue={value('endsOn')} />
          </FormField>
        </div>
      ) : null}

      {fieldMessage ? null : <FormMessage state={state} />}
      <SubmitButton size="sm">{submitLabel}</SubmitButton>
    </form>
  );
}
