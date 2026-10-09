'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/analytics/range';
import { createAdminClient } from '@/lib/db/admin';
import { createClient, type ServerClient } from '@/lib/db/server';
import { getOrgContext } from '@/lib/orgs/queries';
import { getStrategy, listStrategies } from '@/lib/strategy/queries';
import { periodState, todayIn } from '@/lib/strategy/shared';
import {
  ASSISTANT_PROMPT_VERSION,
  assistantAvailability,
  suggestionNote,
  suggestCaptions,
  type AssistantGrounding,
  type CaptionOption,
  type SuggestState,
} from './assistant';
import { saveCaptionAsNewVersion } from './assistant-save';
import { aiSetup, chatProvider, checkUserModelLimit, logGeneration } from './chat/run';

// The "Suggest copy" panel on a content item. Editors and up; only on items whose current
// version can still be edited. Suggesting asks the model (logged, rate-limited); choosing
// saves the option as a new draft version.

const ids = z.object({ itemId: z.uuid() });

async function loadGrounding(
  db: ServerClient,
  orgId: string,
  itemId: string,
  timeZone: string,
): Promise<{
  grounding: AssistantGrounding;
  status: Parameters<typeof assistantAvailability>[0]['status'];
  submitted: boolean;
} | null> {
  const { data: item } = await db
    .from('content_items')
    .select(
      'title, status, platform_keys, country_code, strategy_objective_id, current_version_id, content_formats(name), content_pillars(name), audiences(name), campaigns(name), cta_types(name)',
    )
    .eq('organization_id', orgId)
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return null;
  const { data: version } = await db
    .from('content_versions')
    .select('description, caption, cta, hashtags, submitted_at')
    .eq('id', item.current_version_id!)
    .maybeSingle();
  if (!version) return null;

  // The strategy: the one the item's objective belongs to, else a running active strategy
  // whose markets and platforms include the item's.
  let strategyId: string | null = null;
  let objective: string | null = null;
  if (item.strategy_objective_id) {
    const { data } = await db
      .from('strategy_objectives')
      .select('name, strategy_id')
      .eq('organization_id', orgId)
      .eq('id', item.strategy_objective_id)
      .maybeSingle();
    strategyId = data?.strategy_id ?? null;
    objective = data?.name ?? null;
  }
  if (!strategyId) {
    const today = todayIn(timeZone);
    const match = (await listStrategies(orgId, db)).find(
      (s) =>
        s.status === 'active' &&
        periodState(s.periodStart, s.periodEnd, today) === 'running' &&
        (!s.countryCodes.length ||
          !item.country_code ||
          s.countryCodes.includes(item.country_code)) &&
        (!s.platformKeys.length || item.platform_keys.some((p) => s.platformKeys.includes(p))),
    );
    strategyId = match?.id ?? null;
  }
  const strategy = strategyId ? await getStrategy(orgId, strategyId, db) : null;

  return {
    status: item.status,
    submitted: Boolean(version.submitted_at),
    grounding: {
      item: {
        title: item.title,
        platformKeys: item.platform_keys,
        countryCode: item.country_code,
        format: item.content_formats?.name ?? null,
        pillar: item.content_pillars?.name ?? null,
        audience: item.audiences?.name ?? null,
        campaign: item.campaigns?.name ?? null,
        ctaType: item.cta_types?.name ?? null,
      },
      version: {
        brief: version.description,
        caption: version.caption,
        cta: version.cta,
        hashtags: version.hashtags,
      },
      strategy: strategy
        ? {
            name: strategy.name,
            toneOfVoice: strategy.toneOfVoice,
            priorities: strategy.priorities,
            pillars: strategy.pillars.map((p) => p.name),
            audiences: strategy.audiences.map((a) => a.name),
            objective,
          }
        : null,
    },
  };
}

export async function suggestCopyAction(orgSlug: string, itemId: string): Promise<SuggestState> {
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!ids.safeParse({ itemId }).success) return { status: 'error', message: 'Content not found.' };
  const setup = aiSetup();
  const provider = chatProvider();
  if (!setup.modelReady || !setup.model || !provider) {
    return { status: 'error', message: 'Suggesting copy needs an AI key on the server.' };
  }
  const db = await createClient();
  const loaded = await loadGrounding(db, org.id, itemId, org.default_timezone);
  if (!loaded) return { status: 'error', message: 'Content not found.' };
  const available = assistantAvailability({
    status: loaded.status,
    canEdit: can(role, 'content.edit'),
    currentVersionSubmitted: loaded.submitted,
  });
  if (!available.ok) return { status: 'error', message: available.reason };
  const limit = await checkUserModelLimit(org.id, user.id);
  if (!limit.ok) return { status: 'error', message: limit.message };

  const result = await suggestCaptions({
    provider,
    model: setup.model,
    grounding: loaded.grounding,
  });
  const generationId = await logGeneration({
    orgId: org.id,
    userId: user.id,
    purpose: 'assistant',
    provider: provider.id,
    model: setup.model,
    promptVersion: ASSISTANT_PROMPT_VERSION,
    generation: {
      ...result.generation,
      input: { itemId, ...(result.generation.input as object) },
    },
  });
  if (!result.options.length) {
    return {
      status: 'error',
      message: 'The AI model gave no usable suggestions this time. Try again.',
    };
  }
  if (!generationId)
    return { status: 'error', message: 'Could not keep the suggestions. Try again.' };
  return { status: 'success', generationId, model: setup.model, options: result.options };
}

const chooseSchema = z.object({
  generationId: z.uuid(),
  option: z.coerce.number().int().min(0).max(5),
});

/** Saves the chosen option, exactly as the model suggested it, as a new draft version. */
export async function chooseSuggestionAction(
  orgSlug: string,
  itemId: string,
  _prev: SuggestState,
  formData: FormData,
): Promise<SuggestState> {
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) {
    return {
      status: 'error',
      message: 'Only editors, managers, admins and owners can change content.',
    };
  }
  const parsed = chooseSchema.safeParse({
    generationId: formData.get('generationId'),
    option: formData.get('option'),
  });
  if (!parsed.success || !ids.safeParse({ itemId }).success) {
    return { status: 'error', message: 'That suggestion no longer exists.' };
  }

  // The text comes from the logged suggestion, not from the browser, so the version note
  // ("suggested by the AI model") is always true.
  const { data: generation } = await createAdminClient()
    .from('ai_generations')
    .select('model, input, output, user_id, organization_id, purpose')
    .eq('id', parsed.data.generationId)
    .maybeSingle();
  const input = generation?.input as { itemId?: unknown } | null;
  const output = generation?.output as { options?: CaptionOption[] } | null;
  const option = output?.options?.[parsed.data.option];
  if (
    !generation ||
    generation.purpose !== 'assistant' ||
    generation.organization_id !== org.id ||
    generation.user_id !== user.id ||
    input?.itemId !== itemId ||
    !option ||
    typeof option.caption !== 'string'
  ) {
    return { status: 'error', message: 'That suggestion no longer exists.' };
  }

  const result = await saveCaptionAsNewVersion(await createClient(), {
    orgId: org.id,
    itemId,
    caption: option.caption,
    hashtags: Array.isArray(option.hashtags)
      ? option.hashtags.filter((t) => typeof t === 'string')
      : [],
    notes: (previous) =>
      suggestionNote({
        model: generation.model,
        chosenBy: user.fullName ?? user.email ?? null,
        day: formatDate(new Date()),
        previousNotes: previous,
      }),
  });
  if (result.status === 'error') return { status: 'error', message: result.message };
  revalidatePath(`/${orgSlug}/content/${itemId}`);
  revalidatePath(`/${orgSlug}/content`);
  redirect(`/${orgSlug}/content/${itemId}?suggested=${result.versionNumber}`);
}
