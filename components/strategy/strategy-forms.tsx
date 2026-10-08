'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { initialFormState, type FormState } from '@/lib/forms';
import {
  isStrategyKpi,
  KPI_HELP,
  KPI_LABELS,
  KPI_TARGET_LABELS,
  pillarTargetTotal,
  STRATEGY_KPIS,
  type StrategyKpi,
} from '@/lib/strategy/shared';
import { pillarColorClass } from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Option = { value: string; label: string };

function CheckboxGroup({
  legend,
  hint,
  name,
  options,
  selected,
  error,
  scroll = false,
}: {
  legend: string;
  hint: string;
  name: string;
  options: Option[];
  selected: Set<string>;
  error?: string;
  scroll?: boolean;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <div
        className={cn(
          'grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 sm:grid-cols-3 lg:grid-cols-4',
          scroll && 'max-h-48 overflow-y-auto rounded-md border p-3',
        )}
      >
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selected.has(option.value)}
              className="accent-primary size-4 shrink-0"
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </fieldset>
  );
}

export type StrategyBasicsDefaults = {
  name?: string;
  summary?: string | null;
  periodStart?: string;
  periodEnd?: string;
  countryCodes?: string[];
  platformKeys?: string[];
};

/** Name, summary, period, markets and platforms. Used to create a strategy and to edit it. */
export function StrategyBasicsForm({
  action,
  defaults = {},
  countries,
  platforms,
  submitLabel,
  cancelHref,
  idPrefix,
}: {
  action: Action;
  defaults?: StrategyBasicsDefaults;
  countries: Option[];
  platforms: Option[];
  submitLabel: string;
  cancelHref?: string;
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const errors = state.fieldErrors ?? {};
  const value = (key: 'name' | 'summary' | 'periodStart' | 'periodEnd') =>
    state.values ? (state.values[key] ?? '') : (defaults[key] ?? '');
  const list = (key: 'countryCodes' | 'platformKeys') =>
    new Set(
      state.values ? (state.values[key] ?? '').split(',').filter(Boolean) : (defaults[key] ?? []),
    );
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <FormField id={id('name')} label="Name" errors={errors.name} className="sm:max-w-md">
        <Input
          name="name"
          maxLength={120}
          required
          placeholder="e.g. Autumn in the Netherlands"
          defaultValue={value('name')}
        />
      </FormField>
      <FormField
        id={id('summary')}
        label="Summary"
        optional
        hint="What this strategy is for, in a few sentences."
        errors={errors.summary}
      >
        <Textarea name="summary" rows={3} maxLength={2000} defaultValue={value('summary')} />
      </FormField>
      <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
        <FormField id={id('periodStart')} label="Starts" errors={errors.periodStart}>
          <Input type="date" name="periodStart" required defaultValue={value('periodStart')} />
        </FormField>
        <FormField id={id('periodEnd')} label="Ends" errors={errors.periodEnd}>
          <Input type="date" name="periodEnd" required defaultValue={value('periodEnd')} />
        </FormField>
      </div>
      <CheckboxGroup
        legend="Markets"
        hint="Leave all unticked to cover every market."
        name="countryCodes"
        options={countries}
        selected={list('countryCodes')}
        error={errors.countryCodes?.[0]}
        scroll
      />
      <CheckboxGroup
        legend="Platforms"
        hint="Leave all unticked to cover every platform."
        name="platformKeys"
        options={platforms}
        selected={list('platformKeys')}
        error={errors.platformKeys?.[0]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm">{submitLabel}</SubmitButton>
        {cancelHref ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** One long text field: tone of voice, or priorities (one per line). */
export function StrategyTextForm({
  action,
  name,
  label,
  hint,
  defaultValue,
  rows = 4,
  placeholder,
  idPrefix,
}: {
  action: Action;
  name: 'toneOfVoice' | 'priorities';
  label: string;
  hint: string;
  defaultValue: string;
  rows?: number;
  placeholder?: string;
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const errors = state.fieldErrors?.[name];
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <FormField id={`${idPrefix}-${name}`} label={label} hint={hint} errors={errors}>
        <Textarea
          name={name}
          rows={rows}
          maxLength={name === 'toneOfVoice' ? 2000 : 2500}
          placeholder={placeholder}
          defaultValue={state.values?.[name] ?? defaultValue}
        />
      </FormField>
      {errors?.length ? null : <FormMessage state={state} />}
      <SubmitButton size="sm">Save</SubmitButton>
    </form>
  );
}

export type ObjectiveDefaults = {
  name?: string;
  description?: string | null;
  kpi?: StrategyKpi;
  targetValue?: number | null;
};

/** Adds or edits one objective: what it is, how it is measured and the target. */
export function ObjectiveForm({
  action,
  defaults = {},
  submitLabel,
  idPrefix,
}: {
  action: Action;
  defaults?: ObjectiveDefaults;
  submitLabel: string;
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const errors = state.fieldErrors ?? {};
  const echoed = state.values?.kpi;
  const initialKpi: StrategyKpi = isStrategyKpi(echoed)
    ? echoed
    : (defaults.kpi ?? 'published_content');
  const [kpi, setKpi] = useState<StrategyKpi>(initialKpi);
  const id = (field: string) => `${idPrefix}-${field}`;
  const value = (key: 'name' | 'description' | 'targetValue') =>
    state.values ? (state.values[key] ?? '') : String(defaults[key] ?? '');

  return (
    <form action={formAction} onReset={() => setKpi(initialKpi)} className="space-y-4" noValidate>
      <FormField id={id('name')} label="Objective" errors={errors.name} className="sm:max-w-md">
        <Input
          name="name"
          maxLength={200}
          required
          placeholder="e.g. Post grow guides every week"
          defaultValue={value('name')}
        />
      </FormField>
      <FormField id={id('description')} label="Notes" optional errors={errors.description}>
        <Textarea
          name="description"
          rows={2}
          maxLength={2000}
          defaultValue={value('description')}
          className="min-h-14"
        />
      </FormField>
      <div className="grid gap-4 sm:max-w-xl sm:grid-cols-[1fr_180px]">
        <FormField id={id('kpi')} label="Measured by" hint={KPI_HELP[kpi]} errors={errors.kpi}>
          <NativeSelect
            name="kpi"
            value={kpi}
            onChange={(event) =>
              setKpi(isStrategyKpi(event.target.value) ? event.target.value : 'manual')
            }
          >
            {STRATEGY_KPIS.map((option) => (
              <option key={option} value={option}>
                {KPI_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id={id('targetValue')}
          label={KPI_TARGET_LABELS[kpi]}
          optional={kpi === 'manual'}
          hint={kpi === 'posts_per_week' ? 'Average over the period.' : 'For the whole period.'}
          errors={errors.targetValue}
        >
          <Input
            name="targetValue"
            inputMode="decimal"
            defaultValue={value('targetValue')}
            placeholder={kpi === 'follower_growth' ? 'e.g. 500' : 'e.g. 12'}
          />
        </FormField>
      </div>
      {Object.keys(errors).length ? null : <FormMessage state={state} />}
      <SubmitButton size="sm">{submitLabel}</SubmitButton>
    </form>
  );
}

export type PillarTargetRow = {
  id: string;
  name: string;
  color: string | null;
  isActive: boolean;
  share: number | null;
};

/** Target share per pillar, saved as a whole. Shows the running total. */
export function PillarTargetsForm({
  action,
  pillars,
  idPrefix,
}: {
  action: Action;
  pillars: PillarTargetRow[];
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const errors = state.fieldErrors ?? {};
  const value = (pillar: PillarTargetRow) =>
    state.values ? (state.values[`share.${pillar.id}`] ?? '') : String(pillar.share ?? '');
  const totalOf = (shares: string[]) =>
    pillarTargetTotal(
      shares.map((share) => ({ targetShare: Number(share.replace(',', '.')) || 0 })),
    );
  const [total, setTotal] = useState(() => totalOf(pillars.map(value)));
  const recount = (form: HTMLFormElement) =>
    setTotal(
      totalOf(
        [...new FormData(form).entries()]
          .filter(([key]) => key.startsWith('share.'))
          .map(([, share]) => String(share)),
      ),
    );

  return (
    <form
      action={formAction}
      onInput={(event) => recount(event.currentTarget)}
      onReset={(event) => {
        const form = event.currentTarget;
        // Inputs take their new default values after the reset event.
        requestAnimationFrame(() => recount(form));
      }}
      className="space-y-4"
      noValidate
    >
      <ul className="divide-y rounded-md border">
        {pillars.map((pillar) => {
          const fieldId = `${idPrefix}-${pillar.id}`;
          const error = errors[`share.${pillar.id}`]?.[0];
          return (
            <li key={pillar.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span
                aria-hidden
                className={cn('size-3 shrink-0 rounded-full', pillarColorClass(pillar.color))}
              />
              <label htmlFor={fieldId} className="min-w-0 flex-1 text-[13px]">
                {pillar.name}
                {pillar.isActive ? null : (
                  <span className="text-muted-foreground"> (inactive)</span>
                )}
              </label>
              <span className="flex items-center gap-1.5">
                <Input
                  id={fieldId}
                  name={`share.${pillar.id}`}
                  inputMode="decimal"
                  defaultValue={value(pillar)}
                  placeholder="0"
                  aria-invalid={error ? true : undefined}
                  className="h-8 w-20 text-right tabular-nums"
                />
                <span className="text-muted-foreground text-[13px]">%</span>
              </span>
              {error ? <p className="text-destructive w-full text-xs">{error}</p> : null}
            </li>
          );
        })}
      </ul>
      <p
        className={cn('text-[13px] tabular-nums', total > 100 && 'text-destructive font-medium')}
        aria-live="polite"
      >
        Total: {total}%
        {total > 100
          ? '. That is more than 100%.'
          : total < 100
            ? `. ${Math.round((100 - total) * 10) / 10}% is left for content outside these pillars.`
            : '.'}
      </p>
      <FormMessage state={state} />
      <SubmitButton size="sm">Save targets</SubmitButton>
    </form>
  );
}

/** A set of choices saved as a whole: audiences or competitors. */
export function ChecklistForm({
  action,
  options,
  selected,
  legend,
}: {
  action: Action;
  options: (Option & { detail?: string })[];
  selected: string[];
  legend: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const chosen = new Set(selected);
  return (
    <form action={formAction} className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="sr-only">{legend}</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={option.value} className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                name="ids"
                value={option.value}
                defaultChecked={chosen.has(option.value)}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.detail ? (
                  <span className="text-muted-foreground block text-xs">{option.detail}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton size="sm">Save</SubmitButton>
    </form>
  );
}

/** Delete with a confirm tick, so it can't happen by accident. */
export function DeleteStrategyForm({ action, strategyId }: { action: Action; strategyId: string }) {
  const [state, formAction] = useActionState(action, initialFormState);
  const [confirmed, setConfirmed] = useState(false);
  const error = state.fieldErrors?.confirm?.[0];
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="strategyId" value={strategyId} />
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          name="confirm"
          value="yes"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="accent-destructive mt-0.5 size-4 shrink-0"
        />
        <span>
          Yes, delete this strategy with its objectives and targets. Content linked to its
          objectives stays, but loses the link.
        </span>
      </label>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {error ? null : <FormMessage state={state} />}
      <SubmitButton variant="destructive" size="sm" disabled={!confirmed}>
        Delete strategy
      </SubmitButton>
    </form>
  );
}
