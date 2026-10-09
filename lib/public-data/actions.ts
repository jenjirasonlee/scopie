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
import { createPublicCollector, needsViewer } from '@/lib/platforms/registry';
import { metaConfig, publicApiCredential, serverEnv } from '@/lib/server-env';
import { loadPublicContext } from '@/lib/sync/credentials';
import {
  BUSINESS_ROLE_VALUES,
  LOOKUPS_PER_HOUR,
  PUBLIC_PROFILE_PLATFORMS,
  YOUTUBE_SEARCHES_PER_DAY,
  isSearchable,
  parseHandleList,
  publicPlatform,
  type LookupState,
  type PublicProfilePlatform,
  type SearchResult,
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
 * Looks up a public profile (Instagram through the viewer account; YouTube, X and Bluesky
 * with the server's key or none) and returns what Scopie can track for it. Counted against a per-organization hourly allowance, so previews can't
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
  const platform = publicPlatform(field(formData, 'platform'));
  const rules = PUBLIC_PROFILE_PLATFORMS[platform];
  const handle = rules.normalize(field(formData, 'handle'));
  if (!rules.isValid(handle)) return { status: 'error', message: rules.invalidMessage };
  const env = serverEnv();
  const meta = metaConfig(env);
  const credential = needsViewer(platform) ? null : publicApiCredential(env, platform);
  const ready = needsViewer(platform)
    ? Boolean(meta && env.SCOPIE_ENCRYPTION_KEY && env.SUPABASE_SERVICE_ROLE_KEY)
    : credential !== null && Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!ready) {
    return { status: 'error', handle, message: NOT_SET_UP[platform] };
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
    const ctx = needsViewer(platform)
      ? await loadPublicContext(admin, org.id, platform, env.SCOPIE_ENCRYPTION_KEY!)
      : { viewerId: null, credential: credential ?? '' };
    await admin.from('public_profile_lookups').insert({
      organization_id: org.id,
      requested_by: user.id,
      platform_key: platform,
    });
    const collector = createPublicCollector(platform, {
      version: meta?.version,
      appSecret: meta?.appSecret,
    })!;
    const { profile, accountMetrics } = await collector.lookupProfile(ctx, handle);
    const value = (key: string) =>
      accountMetrics.find((metric) => metric.metricKey === key)?.value ?? null;
    return {
      status: 'success',
      // YouTube's customUrl can differ from the handle typed; keep the handle that was found.
      handle: platform === 'youtube' ? handle : profile.username,
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
    if (error instanceof PlatformError) {
      return { status: 'error', handle, message: lookupErrorMessage(platform, error) };
    }
    throw error;
  }
}

/**
 * Finds public profiles by name on platforms whose official API allows it (YouTube with the
 * server key, Bluesky with none). YouTube searches are counted, since each costs 100 quota units.
 */
export async function searchPublicProfiles(
  orgSlug: string,
  platformValue: string,
  rawQuery: string,
): Promise<SearchResult> {
  const query = rawQuery.trim().replace(/\s+/g, ' ').slice(0, 60);
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return { status: 'error', query, message: NO_PERMISSION };
  if (org.is_demo) {
    return {
      status: 'error',
      query,
      message: 'The DEMO organization does not search live data. Create your own organization.',
    };
  }
  if (!isSearchable(platformValue)) {
    return { status: 'error', query, message: 'This platform can only be added by username.' };
  }
  const platform = platformValue;
  if (query.length < 2) return { status: 'success', query, hits: [] };
  const env = serverEnv();
  const credential = publicApiCredential(env, platform);
  if (platform === 'youtube' && (!credential || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    return { status: 'error', query, message: NOT_SET_UP.youtube };
  }

  if (platform === 'youtube') {
    const admin = createAdminClient();
    const { count } = await admin
      .from('public_profile_lookups')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('platform_key', 'youtube')
      .gte('looked_up_at', new Date(Date.now() - 86_400_000).toISOString());
    if ((count ?? 0) >= YOUTUBE_SEARCHES_PER_DAY) {
      return {
        status: 'error',
        query,
        message: `Your organization has used today’s ${YOUTUBE_SEARCHES_PER_DAY} YouTube searches. Paste the channel link instead; that still works.`,
      };
    }
    await admin.from('public_profile_lookups').insert({
      organization_id: org.id,
      requested_by: user.id,
      platform_key: 'youtube',
    });
  }

  try {
    const collector = createPublicCollector(platform, {})!;
    const hits = await collector.searchProfiles!(
      { viewerId: null, credential: credential ?? '' },
      query,
      8,
    );
    return { status: 'success', query, hits };
  } catch (error) {
    if (error instanceof PlatformError) {
      return { status: 'error', query, message: lookupErrorMessage(platform, error) };
    }
    throw error;
  }
}

/** What a preview failure means, in plain words. Never includes a token. */
function lookupErrorMessage(platform: PublicProfilePlatform, error: PlatformError): string {
  const name = PUBLIC_PROFILE_PLATFORMS[platform].label;
  if (error.code === 'credits_depleted' || error.code === 'profile_not_found') return error.message;
  if (error.code === 'profile_protected') return error.message;
  if (error instanceof RateLimitError) {
    return platform === 'instagram'
      ? 'Meta asked Scopie to slow down. Try the preview again later.'
      : `${name} asked Scopie to slow down. Try the preview again later.`;
  }
  if (error.code === 'no_viewer') return 'Choose a viewer account in Settings → Public data first.';
  if (error.code === 'auth') {
    return needsViewer(platform)
      ? 'The viewer account needs to be reconnected in Settings → Connections.'
      : `The ${name} API key on the server was rejected. Ask whoever runs Scopie to check it.`;
  }
  return `${name} did not return this profile. Please try again.`;
}

/** Shown when a platform's public API isn't set up on this server. */
const NOT_SET_UP: Record<PublicProfilePlatform, string> = {
  instagram: 'Reading public profiles isn’t set up on this server yet (Meta app missing).',
  youtube: 'Reading YouTube channels isn’t set up on this server yet (YouTube API key missing).',
  x: 'Reading X profiles isn’t set up on this server yet: X needs an API key on the server.',
  bluesky: 'Reading Bluesky profiles isn’t set up on this server yet.',
};

const addSchema = z.object({
  handle: z.string().min(1).max(120),
  displayName: z.string().trim().min(1).max(120),
  externalId: z.string().max(64).optional(),
  businessRole: z.enum(BUSINESS_ROLE_VALUES),
  countryCode: z
    .string()
    .trim()
    .transform((value) => (value ? value.toUpperCase() : null))
    .pipe(z.string().length(2).nullable()),
});

/** Saves a public profile (Instagram, YouTube, X, Bluesky). The first observation is made by the next sync. */
export async function addPublicProfile(
  orgSlug: string,
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return { status: 'error', message: NO_PERMISSION };
  const raw = formDataToObject(formData);
  const platform = publicPlatform(raw.platform ?? '');
  const rules = PUBLIC_PROFILE_PLATFORMS[platform];
  const handle = rules.normalize(raw.handle ?? '');
  if (!rules.isValid(handle)) return { status: 'error', message: rules.invalidMessage };
  if (raw.externalId && !rules.externalId.test(raw.externalId)) {
    return { status: 'error', message: 'Preview the profile again, then save.' };
  }
  const parsed = addSchema.safeParse({
    handle,
    displayName: raw.displayName || handle,
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
      platform_key: platform,
      handle: parsed.data.handle,
      display_name: parsed.data.displayName,
      external_id: parsed.data.externalId ?? null,
      business_role: parsed.data.businessRole,
      country_code: parsed.data.countryCode,
      account_type: rules.accountType,
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
 * Adds many public profiles of one platform from a list of usernames. No preview calls are made:
 * each profile is checked by its first sync, which reports profiles the platform can't read.
 */
export async function addPublicProfilesInBulk(
  orgSlug: string,
  _prev: BulkResult,
  formData: FormData,
): Promise<BulkResult> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return { status: 'error', message: NO_PERMISSION };
  // Echoed back so a failed submit keeps the list and the choices.
  const values = {
    handles: field(formData, 'handles'),
    platform: field(formData, 'platform'),
    businessRole: field(formData, 'businessRole'),
  };
  const businessRole = z.enum(BUSINESS_ROLE_VALUES).safeParse(values.businessRole);
  if (!businessRole.success)
    return { status: 'error', message: 'Choose why you track them.', values };
  const file = formData.get('file');
  const text = file instanceof File && file.size > 0 ? await file.text() : values.handles;
  const platform = publicPlatform(values.platform);
  const { handles, invalid } = parseHandleList(text, platform);
  if (!handles.length && !invalid.length) {
    return { status: 'error', message: 'Paste usernames or choose a CSV file.', values };
  }
  if (handles.length > 200) {
    return { status: 'error', message: 'Add at most 200 profiles at a time.', values };
  }

  const supabase = await createClient();
  const added: string[] = [];
  const skipped = invalid.map((handle) => ({ handle, reason: 'not a valid username' }));
  for (const { handle, countryCode } of handles) {
    const { error } = await supabase.from('social_accounts').insert({
      organization_id: org.id,
      platform_key: platform,
      handle,
      display_name: handle,
      business_role: businessRole.data,
      country_code: countryCode,
      account_type: PUBLIC_PROFILE_PLATFORMS[platform].accountType,
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
    // Keep the choices; the list is kept only when nothing was added.
    values: added.length ? { ...values, handles: '' } : values,
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
