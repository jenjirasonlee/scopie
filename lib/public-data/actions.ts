'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { PlatformError, RateLimitError } from '@/lib/platforms/errors';
import { INSTAGRAM_USERNAME, normalizeHandle } from '@/lib/platforms/meta/business-discovery';
import { createPublicCollector } from '@/lib/platforms/registry';
import { metaConfig, serverEnv } from '@/lib/server-env';
import { loadPublicContext } from '@/lib/sync/credentials';
import {
  BUSINESS_ROLE_VALUES,
  LOOKUPS_PER_HOUR,
  parseHandleList,
  type LookupState,
} from './shared';

const NO_PERMISSION = 'Only owners and admins can manage tracked profiles.';

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Chooses the Instagram professional account through which public profiles are read. */
export async function setPublicDataViewer(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return { status: 'error', message: NO_PERMISSION };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_public_data_viewer', {
    asset_id: field(formData, 'assetId'),
  });
  if (error) {
    return {
      status: 'error',
      message: error.code === '23514' ? `${error.message}.` : 'Could not save the viewer account.',
    };
  }
  revalidatePath(`/${orgSlug}`, 'layout');
  return {
    status: 'success',
    message: 'Saved. Public profiles are read through this account from the next sync.',
  };
}

export async function clearPublicDataViewer(orgSlug: string): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return;
  const supabase = await createClient();
  await supabase.rpc('clear_public_data_viewer', { platform: 'instagram', org: org.id });
  revalidatePath(`/${orgSlug}`, 'layout');
}

/**
 * Looks up a public Instagram profile through the viewer account and returns what Scopie
 * can track for it. Counted against a per-organization hourly allowance, so previews can't
 * use up the API limit that syncs rely on. The viewer token never leaves the server.
 */
export async function lookupPublicProfile(
  orgSlug: string,
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return { status: 'error', message: NO_PERMISSION };
  if (org.is_demo) {
    return {
      status: 'error',
      message: 'The DEMO organization does not read live data. Create your own organization.',
    };
  }
  const handle = normalizeHandle(field(formData, 'handle'));
  if (!INSTAGRAM_USERNAME.test(handle)) {
    return {
      status: 'error',
      message: 'Enter an Instagram username: letters, numbers, periods and underscores.',
    };
  }
  const env = serverEnv();
  const meta = metaConfig(env);
  if (!meta || !env.SCOPIE_ENCRYPTION_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      status: 'error',
      message: 'Reading public profiles isn’t set up on this server yet (Meta app missing).',
    };
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from('public_profile_lookups')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', org.id)
    .gte('looked_up_at', since);
  if ((count ?? 0) >= LOOKUPS_PER_HOUR) {
    return {
      status: 'error',
      message: `Your organization has used its ${LOOKUPS_PER_HOUR} profile previews for this hour. You can still add the profile without a preview.`,
      handle,
    };
  }

  try {
    const ctx = await loadPublicContext(admin, org.id, 'instagram', env.SCOPIE_ENCRYPTION_KEY);
    await admin.from('public_profile_lookups').insert({
      organization_id: org.id,
      requested_by: user.id,
      platform_key: 'instagram',
    });
    const collector = createPublicCollector('instagram', {
      version: meta.version,
      appSecret: meta.appSecret,
    })!;
    const { profile, accountMetrics } = await collector.lookupProfile(ctx, handle);
    const value = (key: string) =>
      accountMetrics.find((metric) => metric.metricKey === key)?.value ?? null;
    return {
      status: 'success',
      handle: profile.username,
      preview: {
        externalId: profile.externalId,
        username: profile.username,
        displayName: profile.displayName,
        biography: profile.biography,
        website: profile.website,
        followers: value('followers'),
        postsTotal: value('posts_total'),
      },
    };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return {
        status: 'error',
        handle,
        message: 'Meta asked Scopie to slow down. Try the preview again later.',
      };
    }
    if (error instanceof PlatformError) {
      const message =
        error.code === 'no_viewer'
          ? 'Choose a viewer account in Settings → Public data first.'
          : error.code === 'profile_not_found'
            ? error.message
            : error.code === 'auth'
              ? 'The viewer account needs to be reconnected in Settings → Connections.'
              : 'Instagram did not return this profile. Please try again.';
      return { status: 'error', handle, message };
    }
    throw error;
  }
}

const addSchema = z.object({
  handle: z.string().regex(INSTAGRAM_USERNAME, 'Enter a valid Instagram username'),
  displayName: z.string().trim().min(1).max(120),
  externalId: z
    .string()
    .regex(/^\d{1,30}$/)
    .optional(),
  businessRole: z.enum(BUSINESS_ROLE_VALUES),
  countryCode: z
    .string()
    .trim()
    .transform((value) => (value ? value.toUpperCase() : null))
    .pipe(z.string().length(2).nullable()),
});

/** Saves a public Instagram profile. The first observation is made by the next sync. */
export async function addPublicProfile(
  orgSlug: string,
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return { status: 'error', message: NO_PERMISSION };
  const raw = formDataToObject(formData);
  const parsed = addSchema.safeParse({
    handle: normalizeHandle(raw.handle ?? ''),
    displayName: raw.displayName || normalizeHandle(raw.handle ?? ''),
    externalId: raw.externalId || undefined,
    businessRole: raw.businessRole,
    countryCode: raw.countryCode ?? '',
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .insert({
      organization_id: org.id,
      platform_key: 'instagram',
      handle: parsed.data.handle,
      display_name: parsed.data.displayName,
      external_id: parsed.data.externalId ?? null,
      business_role: parsed.data.businessRole,
      country_code: parsed.data.countryCode,
      account_type: 'business',
    })
    .select('id')
    .single();
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '23505'
          ? 'This profile is already tracked in your organization.'
          : 'Could not add the profile. Please try again.',
    };
  }
  revalidatePath(`/${orgSlug}`, 'layout');
  redirect(`/${orgSlug}/accounts/${data.id}?added=1`);
}

export type BulkResult = FormState & {
  added?: string[];
  skipped?: { handle: string; reason: string }[];
};

/**
 * Adds many public Instagram profiles from a list of usernames. No preview calls are made:
 * each profile is checked by its first sync, which reports profiles Instagram can't read.
 */
export async function addPublicProfilesInBulk(
  orgSlug: string,
  _prev: BulkResult,
  formData: FormData,
): Promise<BulkResult> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return { status: 'error', message: NO_PERMISSION };
  const businessRole = z.enum(BUSINESS_ROLE_VALUES).safeParse(field(formData, 'businessRole'));
  if (!businessRole.success) return { status: 'error', message: 'Choose why you track them.' };
  const file = formData.get('file');
  const text =
    file instanceof File && file.size > 0 ? await file.text() : field(formData, 'handles');
  const { handles, invalid } = parseHandleList(text);
  if (!handles.length && !invalid.length) {
    return { status: 'error', message: 'Paste usernames or choose a CSV file.' };
  }
  if (handles.length > 200) {
    return { status: 'error', message: 'Add at most 200 profiles at a time.' };
  }

  const supabase = await createClient();
  const added: string[] = [];
  const skipped = invalid.map((handle) => ({ handle, reason: 'not a valid username' }));
  for (const { handle, countryCode } of handles) {
    const { error } = await supabase.from('social_accounts').insert({
      organization_id: org.id,
      platform_key: 'instagram',
      handle,
      display_name: handle,
      business_role: businessRole.data,
      country_code: countryCode,
      account_type: 'business',
    });
    if (!error) added.push(handle);
    else
      skipped.push({
        handle,
        reason:
          error.code === '23505'
            ? 'already tracked'
            : error.code === '23503'
              ? 'unknown country code'
              : 'could not be saved',
      });
  }
  revalidatePath(`/${orgSlug}`, 'layout');
  return {
    status: added.length ? 'success' : 'error',
    message: `Added ${added.length} profile${added.length === 1 ? '' : 's'}${
      skipped.length ? `, skipped ${skipped.length}` : ''
    }. The first observation happens on the next sync.`,
    added,
    skipped,
  };
}

/** Deletes a profile and everything Scopie stored about it. Cannot be undone. */
export async function removeProfileAndData(orgSlug: string, formData: FormData): Promise<void> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return;
  const accountId = field(formData, 'accountId');
  if (field(formData, 'confirm') !== 'DELETE') {
    redirect(`/${orgSlug}/accounts/${accountId}?remove=confirm`);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_profile_and_data', { account_id: accountId });
  if (error) redirect(`/${orgSlug}/accounts/${accountId}?remove=failed`);
  revalidatePath(`/${orgSlug}`, 'layout');
  redirect(`/${orgSlug}/accounts?removed=1`);
}
