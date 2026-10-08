'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { initialFormState, type FormState } from '@/lib/forms';

export type ContentFormDefaults = {
  title?: string;
  status?: string;
  platformKeys?: string[];
  countryCode?: string | null;
  ownerUserId?: string | null;
  pillarId?: string | null;
  contentFormatId?: string | null;
  campaignId?: string | null;
  audienceId?: string | null;
  ctaTypeId?: string | null;
  plannedDate?: string;
  plannedTime?: string;
  description?: string | null;
  caption?: string | null;
  cta?: string | null;
  hashtags?: string;
  notes?: string | null;
};

type Option = { value: string; label: string; active?: boolean };

export type ContentFormOptionLists = {
  platforms: Option[];
  countries: Option[];
  members: Option[];
  pillars: Option[];
  formats: Option[];
  campaigns: Option[];
  audiences: Option[];
  ctaTypes: Option[];
};

export function ContentForm({
  action,
  defaults = {},
  options,
  timeZone,
  taxonomyHref,
  submitLabel,
  cancelHref,
  readOnly = false,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults?: ContentFormDefaults;
  options: ContentFormOptionLists;
  timeZone: string;
  /** Where pillars, formats, campaigns and audiences are managed. */
  taxonomyHref?: string;
  submitLabel: string;
  cancelHref?: string;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const errors = state.fieldErrors ?? {};
  // After a failed submit, show what the person typed rather than the stored values.
  const value = (key: Exclude<keyof ContentFormDefaults, 'platformKeys'>) =>
    state.values ? (state.values[key] ?? '') : String(defaults[key] ?? '');
  const selectedPlatforms = new Set(
    state.values
      ? (state.values.platformKeys ?? '').split(',').filter(Boolean)
      : (defaults.platformKeys ?? []),
  );

  /** Inactive taxonomy items stay listed only when this item already uses them. */
  const choices = (list: Option[], current: string | null | undefined) =>
    list.filter((option) => option.active !== false || option.value === current);

  const taxonomySelect = (
    name: 'pillarId' | 'contentFormatId' | 'campaignId' | 'audienceId' | 'ctaTypeId',
    label: string,
    list: Option[],
  ) => (
    <FormField id={name} label={label} optional errors={errors[name]}>
      <NativeSelect name={name} defaultValue={value(name)} disabled={readOnly}>
        <option value="">None</option>
        {choices(list, defaults[name]).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.active === false ? ' (inactive)' : ''}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormMessage state={state} />
      <fieldset disabled={readOnly} className="space-y-6">
        <fieldset className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <legend className="sr-only">Content</legend>
          <FormField id="title" label="Title" errors={errors.title}>
            <Input
              name="title"
              defaultValue={value('title')}
              maxLength={200}
              placeholder="e.g. Autumn feeding tips reel"
              required
            />
          </FormField>
          <FormField id="status" label="Stage" errors={errors.status}>
            <NativeSelect name="status" defaultValue={value('status') || 'IDEA'}>
              <option value="IDEA">Idea</option>
              <option value="DRAFT">Draft</option>
            </NativeSelect>
          </FormField>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Platforms</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {options.platforms.map((platform) => (
              <label key={platform.value} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="platformKeys"
                  value={platform.value}
                  defaultChecked={selectedPlatforms.has(platform.value)}
                  className="accent-primary size-4"
                />
                {platform.label}
              </label>
            ))}
          </div>
          {errors.platformKeys ? (
            <p className="text-destructive text-xs">{errors.platformKeys[0]}</p>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 text-sm font-semibold">
            Plan
            {taxonomyHref && !readOnly ? (
              <Link
                href={taxonomyHref}
                className="text-muted-foreground ml-2 text-xs font-normal hover:underline"
              >
                Edit pillars, formats and campaigns
              </Link>
            ) : null}
          </legend>
          <FormField
            id="plannedDate"
            label="Publish date"
            optional
            hint={`In ${timeZone}.`}
            errors={errors.plannedDate}
          >
            <Input type="date" name="plannedDate" defaultValue={value('plannedDate')} />
          </FormField>
          <FormField
            id="plannedTime"
            label="Time"
            optional
            hint="09:00 if left empty."
            errors={errors.plannedTime}
          >
            <Input type="time" name="plannedTime" defaultValue={value('plannedTime')} />
          </FormField>
          <FormField id="ownerUserId" label="Owner" optional errors={errors.ownerUserId}>
            <NativeSelect name="ownerUserId" defaultValue={value('ownerUserId')}>
              <option value="">No owner</option>
              {options.members.map((member) => (
                <option key={member.value} value={member.value}>
                  {member.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="countryCode" label="Country" optional errors={errors.countryCode}>
            <NativeSelect name="countryCode" defaultValue={value('countryCode')}>
              <option value="">All countries</option>
              {options.countries.map((country) => (
                <option key={country.value} value={country.value}>
                  {country.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {taxonomySelect('pillarId', 'Content pillar', options.pillars)}
          {taxonomySelect('contentFormatId', 'Format', options.formats)}
          {taxonomySelect('campaignId', 'Campaign', options.campaigns)}
          {taxonomySelect('audienceId', 'Audience', options.audiences)}
          {taxonomySelect('ctaTypeId', 'CTA type', options.ctaTypes)}
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-3 text-sm font-semibold">Copy</legend>
          <FormField id="caption" label="Caption" optional errors={errors.caption}>
            <Textarea name="caption" rows={5} defaultValue={value('caption')} maxLength={5000} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="hashtags"
              label="Hashtags"
              optional
              hint="Separate with spaces or commas."
              errors={errors.hashtags}
            >
              <Input
                name="hashtags"
                defaultValue={value('hashtags')}
                placeholder="#hydro #growtips"
              />
            </FormField>
            <FormField id="cta" label="Call to action" optional errors={errors.cta}>
              <Input
                name="cta"
                defaultValue={value('cta')}
                maxLength={200}
                placeholder="e.g. Find a stockist"
              />
            </FormField>
          </div>
          <FormField
            id="description"
            label="Brief"
            optional
            hint="What it is and why. For the people making it."
            errors={errors.description}
          >
            <Textarea
              name="description"
              rows={3}
              defaultValue={value('description')}
              maxLength={5000}
            />
          </FormField>
          <FormField id="notes" label="Notes" optional errors={errors.notes}>
            <Textarea name="notes" rows={2} defaultValue={value('notes')} maxLength={5000} />
          </FormField>
        </fieldset>
      </fieldset>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton>{submitLabel}</SubmitButton>
          {cancelHref ? (
            <Button asChild variant="ghost">
              <Link href={cancelHref}>Cancel</Link>
            </Button>
          ) : null}
        </div>
      )}
    </form>
  );
}
