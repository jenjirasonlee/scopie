'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import type { TablesUpdate } from '@/lib/db/types';
import { echoValues, fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import {
  deleteStrategySchema,
  idSetSchema,
  objectiveSchema,
  pillarSharesFrom,
  pillarTargetsSchema,
  strategyBasicsSchema,
  strategyPrioritiesSchema,
  strategyStatusSchema,
  strategyToneSchema,
  type ObjectiveInput,
  type StrategyBasicsInput,
} from '@/schemas/strategy';

const NO_PERMISSION: FormState = {
  status: 'error',
  message: 'Only owners, admins and managers can change strategies.',
};
const NOT_FOUND: FormState = { status: 'error', message: 'This strategy no longer exists.' };
const OBJECTIVE_NOT_FOUND: FormState = {
  status: 'error',
  message: 'This objective no longer exists.',
};

const idSchema = z.uuid();
const objectiveIdSchema = z.object({ strategyId: z.uuid(), objectiveId: z.uuid() });

/** Postgres errors raised by the strategy rules, in words people understand. */
function saveError(
  error: { code?: string; message: string },
  raw?: Record<string, string>,
): FormState {
  return {
    status: 'error',
    message: ruleMessage(error) ?? 'Could not save. Please try again.',
    values: raw ? echoValues(raw) : undefined,
  };
}

function ruleMessage(error: { code?: string; message: string }): string | null {
  if (error.code === '42501') return 'You can’t make this change.';
  if (error.code !== '23514') return null;
  // Generic check constraints ("new row for relation … violates check constraint …").
  if (error.message.startsWith('new row')) {
    return 'Some of these values aren’t allowed. Check them and try again.';
  }
  if (error.message.startsWith('Pillar targets add up')) {
    return 'The pillar targets add up to more than 100%. Lower some of them.';
  }
  return error.message
    .replace(/^Unknown country (.+)$/, 'Scopie doesn’t know the country $1.')
    .replace(/^Unknown platform (.+)$/, 'Scopie doesn’t know the platform $1.');
}

function revalidate(orgSlug: string, strategyId?: string) {
  revalidatePath(`/${orgSlug}/strategy`);
  if (strategyId) revalidatePath(`/${orgSlug}/strategy/${strategyId}`);
}

/** Checks the strategy belongs to the organization (and is visible to this member). */
async function strategyExists(orgId: string, strategyId: string): Promise<boolean> {
  if (!idSchema.safeParse(strategyId).success) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from('strategies')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', strategyId)
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

function parseBasics(formData: FormData) {
  const countryCodes = formData.getAll('countryCodes').filter((v) => typeof v === 'string');
  const platformKeys = formData.getAll('platformKeys').filter((v) => typeof v === 'string');
  // Echoed back as one value each so the checkboxes keep their state after a failed submit.
  const raw = {
    ...formDataToObject(formData),
    countryCodes: countryCodes.join(','),
    platformKeys: platformKeys.join(','),
  };
  const parsed = strategyBasicsSchema.safeParse({ ...raw, countryCodes, platformKeys });
  return { raw, parsed };
}

function basicsFields(input: StrategyBasicsInput) {
  return {
    name: input.name,
    summary: input.summary,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    country_codes: input.countryCodes,
    platform_keys: input.platformKeys,
  };
}

/** Creates a draft strategy and opens it. */
export async function createStrategy(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const { raw, parsed } = parseBasics(formData);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('strategies')
    .insert({ organization_id: org.id, status: 'draft', ...basicsFields(parsed.data) })
    .select('id')
    .single();
  if (error) return saveError(error, raw);

  revalidate(orgSlug);
  redirect(`/${orgSlug}/strategy/${data.id}?created=1`);
}

async function updateStrategyRow(
  orgSlug: string,
  strategyId: string,
  fields: TablesUpdate<'strategies'>,
  raw: Record<string, string>,
): Promise<FormState> {
  const { org } = await getOrgContext(orgSlug);
  if (!idSchema.safeParse(strategyId).success) return NOT_FOUND;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('strategies')
    .update(fields)
    .eq('organization_id', org.id)
    .eq('id', strategyId)
    .select('id');
  if (error) return saveError(error, raw);
  if (!data.length) return NOT_FOUND;
  revalidate(orgSlug, strategyId);
  return { status: 'success', message: 'Saved.' };
}

/** Name, summary, period, markets and platforms. */
export async function updateStrategyBasics(
  orgSlug: string,
  strategyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const { raw, parsed } = parseBasics(formData);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);
  return updateStrategyRow(orgSlug, strategyId, basicsFields(parsed.data), raw);
}

export async function updateStrategyTone(
  orgSlug: string,
  strategyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const raw = formDataToObject(formData);
  const parsed = strategyToneSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);
  return updateStrategyRow(orgSlug, strategyId, { tone_of_voice: parsed.data.toneOfVoice }, raw);
}

export async function updateStrategyPriorities(
  orgSlug: string,
  strategyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const raw = formDataToObject(formData);
  const parsed = strategyPrioritiesSchema.safeParse(raw);
  if (!parsed.success) {
    // Errors on one line are shown on the whole field.
    const state = fieldErrorsFrom(parsed.error, raw);
    const messages = Object.values(state.fieldErrors ?? {}).flatMap((m) => m ?? []);
    return { ...state, fieldErrors: { priorities: messages } };
  }
  return updateStrategyRow(orgSlug, strategyId, { priorities: parsed.data.priorities }, raw);
}

/** Draft, active or archived. */
export async function setStrategyStatus(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) throw new Error(NO_PERMISSION.message);
  const { strategyId, status } = strategyStatusSchema.parse({
    strategyId: formData.get('strategyId'),
    status: formData.get('status'),
  });
  const supabase = await createClient();
  const { error } = await supabase
    .from('strategies')
    .update({ status })
    .eq('organization_id', org.id)
    .eq('id', strategyId);
  if (error) throw new Error('Could not change the status. Please try again.');
  revalidate(orgSlug, strategyId);
  revalidatePath(`/${orgSlug}/content`, 'layout');
}

/** Deletes a strategy with its objectives and targets. Content linked to its objectives is unlinked. */
export async function deleteStrategy(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const parsed = deleteStrategySchema.safeParse({
    strategyId: formData.get('strategyId'),
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('strategies')
    .delete()
    .eq('organization_id', org.id)
    .eq('id', parsed.data.strategyId)
    .select('id');
  if (error) return saveError(error);
  if (!data.length) return NOT_FOUND;

  revalidate(orgSlug);
  revalidatePath(`/${orgSlug}/content`, 'layout');
  redirect(`/${orgSlug}/strategy?deleted=1`);
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

function objectiveFields(input: ObjectiveInput) {
  return {
    name: input.name,
    description: input.description,
    kpi: input.kpi,
    target_value: input.targetValue,
  };
}

export async function addObjective(
  orgSlug: string,
  strategyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const raw = formDataToObject(formData);
  const parsed = objectiveSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);
  if (!(await strategyExists(org.id, strategyId))) return NOT_FOUND;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from('strategy_objectives')
    .select('position')
    .eq('organization_id', org.id)
    .eq('strategy_id', strategyId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from('strategy_objectives').insert({
    organization_id: org.id,
    strategy_id: strategyId,
    position: (last?.position ?? -1) + 1,
    ...objectiveFields(parsed.data),
  });
  if (error) return saveError(error, raw);

  revalidate(orgSlug, strategyId);
  revalidatePath(`/${orgSlug}/content`, 'layout');
  return { status: 'success', message: `“${parsed.data.name}” added.` };
}

export async function updateObjective(
  orgSlug: string,
  strategyId: string,
  objectiveId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  if (!objectiveIdSchema.safeParse({ strategyId, objectiveId }).success) {
    return OBJECTIVE_NOT_FOUND;
  }
  const raw = formDataToObject(formData);
  const parsed = objectiveSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('strategy_objectives')
    .update(objectiveFields(parsed.data))
    .eq('organization_id', org.id)
    .eq('strategy_id', strategyId)
    .eq('id', objectiveId)
    .select('id');
  if (error) return saveError(error, raw);
  if (!data.length) return OBJECTIVE_NOT_FOUND;

  revalidate(orgSlug, strategyId);
  revalidatePath(`/${orgSlug}/content`, 'layout');
  return { status: 'success', message: 'Saved.' };
}

/** Removes an objective. Content linked to it keeps everything else and is unlinked. */
export async function removeObjective(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) throw new Error(NO_PERMISSION.message);
  const { strategyId, objectiveId } = objectiveIdSchema.parse({
    strategyId: formData.get('strategyId'),
    objectiveId: formData.get('objectiveId'),
  });
  const supabase = await createClient();
  const { error } = await supabase
    .from('strategy_objectives')
    .delete()
    .eq('organization_id', org.id)
    .eq('strategy_id', strategyId)
    .eq('id', objectiveId);
  if (error) throw new Error('Could not remove the objective. Please try again.');
  revalidate(orgSlug, strategyId);
  revalidatePath(`/${orgSlug}/content`, 'layout');
}

// ---------------------------------------------------------------------------
// Sets: pillar targets, audiences and competitors are saved as a whole.
// ---------------------------------------------------------------------------

type SetTable = 'strategy_pillars' | 'strategy_audiences' | 'strategy_competitors';

/**
 * Replaces the rows of a strategy in one of the set tables. Supabase can't run both steps in
 * one transaction, so when adding the new rows fails the old ones are put back.
 */
async function replaceSet<Row extends Record<string, unknown>>(
  table: SetTable,
  orgId: string,
  strategyId: string,
  rows: Row[],
): Promise<{ code?: string; message: string } | null> {
  const supabase = await createClient();
  // The three tables share organization_id and strategy_id; typed as one for the builder.
  const from = () => supabase.from(table as 'strategy_audiences');
  const { data: previous, error: readError } = await from()
    .select('*')
    .eq('organization_id', orgId)
    .eq('strategy_id', strategyId);
  if (readError) return readError;
  const { error: deleteError } = await from()
    .delete()
    .eq('organization_id', orgId)
    .eq('strategy_id', strategyId);
  if (deleteError) return deleteError;
  if (!rows.length) return null;
  const withKeys = rows.map((row) => ({ ...row, organization_id: orgId, strategy_id: strategyId }));
  const { error } = await from().insert(withKeys as never);
  if (error) {
    if (previous?.length) await from().insert(previous);
    return error;
  }
  return null;
}

export async function savePillarTargets(
  orgSlug: string,
  strategyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const shares = pillarSharesFrom(formData.entries());
  const raw = Object.fromEntries(Object.entries(shares).map(([id, v]) => [`share.${id}`, v]));
  const parsed = pillarTargetsSchema.safeParse(shares);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length ? `share.${String(issue.path[0])}` : 'total';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      status: 'error',
      message: fieldErrors.total?.[0] ?? 'Please fix the highlighted fields.',
      fieldErrors,
      values: raw,
    };
  }
  if (!(await strategyExists(org.id, strategyId))) return NOT_FOUND;

  const error = await replaceSet(
    'strategy_pillars',
    org.id,
    strategyId,
    parsed.data.map((t) => ({ pillar_id: t.pillarId, target_share: t.targetShare })),
  );
  if (error) return saveError(error, raw);

  revalidate(orgSlug, strategyId);
  return { status: 'success', message: 'Pillar targets saved.' };
}

async function saveIdSet(
  orgSlug: string,
  strategyId: string,
  formData: FormData,
  table: 'strategy_audiences' | 'strategy_competitors',
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  const parsed = idSetSchema.safeParse(formData.getAll('ids'));
  if (!parsed.success) return { status: 'error', message: 'Choose from the list.' };
  if (!(await strategyExists(org.id, strategyId))) return NOT_FOUND;

  const column = table === 'strategy_audiences' ? 'audience_id' : 'social_account_id';
  const error = await replaceSet(
    table,
    org.id,
    strategyId,
    parsed.data.map((id) => ({ [column]: id })),
  );
  if (error) return saveError(error);

  revalidate(orgSlug, strategyId);
  return { status: 'success', message: 'Saved.' };
}

export async function saveStrategyAudiences(
  orgSlug: string,
  strategyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return saveIdSet(orgSlug, strategyId, formData, 'strategy_audiences');
}

export async function saveStrategyCompetitors(
  orgSlug: string,
  strategyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return saveIdSet(orgSlug, strategyId, formData, 'strategy_competitors');
}
