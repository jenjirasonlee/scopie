/**
 * Creates clearly labelled DEMO DATA for local development:
 * a demo user, a "CANNA (DEMO)" organization and fictional social accounts.
 *
 *   pnpm db:seed            # local Supabase only
 *   pnpm db:seed --allow-remote   # explicitly allow a non-local Supabase URL
 *
 * It also generates DEMO posts and metrics for the demo organization's own accounts,
 * written through the same ingest step as real data and stored as data_source 'demo'.
 *
 * Everything created here is fictional. No real CANNA accounts, credentials or data.
 * Accounts get connection_status 'demo' and data_source 'demo', which the UI labels as DEMO.
 * Safe to re-run: existing demo rows are updated, not duplicated.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database, TablesInsert } from '../lib/db/types';
import { generateDemoAccount } from '../lib/demo/generate';
import { ingest } from '../lib/ingest/ingest';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

const DEMO_ORG = { name: 'CANNA (DEMO)', slug: 'canna-demo', default_timezone: 'Europe/Amsterdam' };
const DEMO_USER_EMAIL = 'demo@scopie.local';
const DEMO_TEAM = [
  {
    email: 'manager.demo@scopie.local',
    fullName: 'Morgan Manager (DEMO)',
    role: 'MANAGER' as const,
  },
  { email: 'viewer.demo@scopie.local', fullName: 'Vic Viewer (DEMO)', role: 'VIEWER' as const },
];

type Market = { country: string; name: string; language: string; timezone: string; handle: string };

const MARKETS: Market[] = [
  {
    country: 'NL',
    name: 'Netherlands',
    language: 'nl',
    timezone: 'Europe/Amsterdam',
    handle: 'nl',
  },
  { country: 'DE', name: 'Germany', language: 'de', timezone: 'Europe/Berlin', handle: 'de' },
  { country: 'ES', name: 'Spain', language: 'es', timezone: 'Europe/Madrid', handle: 'es' },
  { country: 'FR', name: 'France', language: 'fr', timezone: 'Europe/Paris', handle: 'fr' },
  { country: 'IT', name: 'Italy', language: 'it', timezone: 'Europe/Rome', handle: 'it' },
  { country: 'GB', name: 'UK', language: 'en-GB', timezone: 'Europe/London', handle: 'uk' },
];

// Which platforms each fictional market has. Not every market is on every platform, on purpose.
const PLATFORMS_BY_MARKET: Record<string, { platform: string; type: string }[]> = {
  NL: [
    { platform: 'instagram', type: 'business' },
    { platform: 'facebook', type: 'page' },
    { platform: 'linkedin', type: 'company_page' },
    { platform: 'youtube', type: 'channel' },
  ],
  DE: [
    { platform: 'instagram', type: 'business' },
    { platform: 'facebook', type: 'page' },
    { platform: 'youtube', type: 'channel' },
  ],
  ES: [
    { platform: 'instagram', type: 'business' },
    { platform: 'facebook', type: 'page' },
    { platform: 'tiktok', type: 'business' },
  ],
  FR: [
    { platform: 'instagram', type: 'business' },
    { platform: 'facebook', type: 'page' },
  ],
  IT: [
    { platform: 'instagram', type: 'business' },
    { platform: 'facebook', type: 'page' },
  ],
  GB: [
    { platform: 'instagram', type: 'business' },
    { platform: 'linkedin', type: 'company_page' },
    { platform: 'x', type: 'business' },
  ],
};

const COMPETITORS = [
  { name: 'Hydro Rival (DEMO)', handle: 'hydrorival_demo', platform: 'instagram', country: 'NL' },
  {
    name: 'GrowCo Example (DEMO)',
    handle: 'growco_example_demo',
    platform: 'instagram',
    country: 'DE',
  },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const password = process.env.DEMO_USER_PASSWORD || 'scopie-demo-password';

  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
  if (!isLocal && !process.argv.includes('--allow-remote')) {
    console.error(
      `Refusing to seed demo data into a non-local Supabase (${url}). Pass --allow-remote to override.`,
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ensureUser = async (email: string, fullName: string) => {
    const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listError) throw listError;
    const existing = list.users.find((user) => user.email === email);
    if (existing) return existing.id;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return data.user.id;
  };

  const ownerId = await ensureUser(DEMO_USER_EMAIL, 'Demo Marketer (DEMO)');
  const teamIds = await Promise.all(
    DEMO_TEAM.map((member) => ensureUser(member.email, member.fullName)),
  );

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .upsert({ ...DEMO_ORG, is_demo: true, created_by: ownerId }, { onConflict: 'slug' })
    .select()
    .single();
  if (orgError) throw orgError;

  const memberships: TablesInsert<'organization_members'>[] = [
    { organization_id: org.id, user_id: ownerId, role: 'OWNER' },
    ...DEMO_TEAM.map((member, index) => ({
      organization_id: org.id,
      user_id: teamIds[index]!,
      role: member.role,
    })),
  ];
  const { error: memberError } = await supabase
    .from('organization_members')
    .upsert(memberships, { onConflict: 'organization_id,user_id' });
  if (memberError) throw memberError;

  const accounts: TablesInsert<'social_accounts'>[] = [];
  for (const market of MARKETS) {
    for (const entry of PLATFORMS_BY_MARKET[market.country] ?? []) {
      accounts.push({
        organization_id: org.id,
        platform_key: entry.platform,
        display_name: `CANNA ${market.name} (DEMO)`,
        handle: `canna_${market.handle}_demo`,
        account_type: entry.type,
        country_code: market.country,
        language: market.language,
        timezone: market.timezone,
        owner_user_id: ownerId,
        connection_status: 'demo',
        primary_data_source: 'demo',
        notes: 'DEMO DATA. Fictional account for local development.',
      });
    }
  }
  for (const competitor of COMPETITORS) {
    accounts.push({
      organization_id: org.id,
      platform_key: competitor.platform,
      display_name: competitor.name,
      handle: competitor.handle,
      account_type: 'business',
      country_code: competitor.country,
      is_competitor: true,
      connection_status: 'demo',
      primary_data_source: 'demo',
      notes: 'DEMO DATA. Fictional competitor for local development.',
    });
  }
  // One inactive account to show the activate/deactivate state.
  accounts.push({
    organization_id: org.id,
    platform_key: 'reddit',
    display_name: 'CANNA Community (DEMO)',
    handle: 'canna_community_demo',
    account_type: 'community',
    country_code: 'NL',
    language: 'en',
    is_active: false,
    connection_status: 'demo',
    primary_data_source: 'demo',
    notes: 'DEMO DATA. Inactive example account.',
  });

  let created = 0;
  for (const account of accounts) {
    const { data: existing } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('organization_id', org.id)
      .eq('platform_key', account.platform_key)
      .eq('handle', account.handle!)
      .maybeSingle();
    const { error } = existing
      ? await supabase.from('social_accounts').update(account).eq('id', existing.id)
      : await supabase.from('social_accounts').insert(account);
    if (error) throw error;
    if (!existing) created++;
  }

  // DEMO posts and metrics for the organization's own active accounts.
  const { data: ownAccounts, error: ownError } = await supabase
    .from('social_accounts')
    .select('id, platform_key, handle')
    .eq('organization_id', org.id)
    .eq('is_competitor', false)
    .eq('is_active', true);
  if (ownError) throw ownError;
  const now = new Date();
  let posts = 0;
  let facts = 0;
  for (const account of ownAccounts) {
    const demo = generateDemoAccount({
      seed: account.handle ?? account.id,
      platformKey: account.platform_key,
      now,
    });
    const base = {
      organizationId: org.id,
      socialAccountId: account.id,
      platformKey: account.platform_key,
      dataSource: 'demo' as const,
    };
    const daily = await ingest(
      supabase,
      { ...base, capturedAt: demo.accountCapturedAt, accountMetrics: demo.accountMetrics },
      'sync',
    );
    facts += daily.accountMetricsWritten;
    const seenPosts = new Set<string>();
    for (const capture of demo.captures) {
      const result = await ingest(
        supabase,
        {
          ...base,
          capturedAt: capture.capturedAt,
          posts: capture.posts,
          postMetrics: capture.metrics,
        },
        'sync',
      );
      capture.posts.forEach((post) => seenPosts.add(post.externalId));
      facts += result.postMetricsWritten;
    }
    posts += seenPosts.size;
  }

  console.log(`Seeded DEMO DATA into "${org.name}" (/${org.slug}/dashboard)`);
  console.log(`  ${accounts.length} demo social accounts (${created} new)`);
  console.log(`  ${posts} DEMO posts and ${facts} new DEMO metric values`);
  console.log(
    `  Sign in as ${DEMO_USER_EMAIL} (owner), ${DEMO_TEAM.map((m) => `${m.email} (${m.role.toLowerCase()})`).join(', ')}`,
  );
  console.log(`  Password: the DEMO_USER_PASSWORD value (default "scopie-demo-password")`);
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
