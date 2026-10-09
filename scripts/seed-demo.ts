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
 * It also adds a DEMO content taxonomy (pillars, formats, campaigns, audiences, CTA types) and
 * DEMO content items planned around today, so the content list and calendar have something to show,
 * and an active DEMO strategy for the current quarter with pillar targets and objectives.
 *
 * Accounts get connection_status 'demo' and data_source 'demo', which the UI labels as DEMO.
 * Safe to re-run: existing demo rows are updated, not duplicated.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database, TablesInsert } from '../lib/db/types';
import { generateDemoAccount } from '../lib/demo/generate';
import { ingest } from '../lib/ingest/ingest';
import { utcToZonedParts, zonedDateTimeToUtc } from '../lib/calendar/time';
import { quarterOf } from '../lib/strategy/shared';

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
    { platform: 'bluesky', type: 'profile' },
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

/** Fictional public profiles CANNA watches. Every name says DEMO. */
const COMPETITORS: {
  name: string;
  handle: string;
  platform: string;
  country: string;
  role: 'competitor' | 'industry' | 'influencer';
}[] = [
  {
    name: 'Hydro Rival (DEMO)',
    handle: 'hydrorival_demo',
    platform: 'instagram',
    country: 'NL',
    role: 'competitor',
  },
  {
    name: 'GrowCo Example (DEMO)',
    handle: 'growco_example_demo',
    platform: 'instagram',
    country: 'DE',
    role: 'competitor',
  },
  {
    name: 'Nutrient Labs (DEMO)',
    handle: 'nutrientlabs_demo',
    platform: 'instagram',
    country: 'ES',
    role: 'competitor',
  },
  {
    name: 'Garden Trade Weekly (DEMO)',
    handle: 'gardentrade_demo',
    platform: 'instagram',
    country: 'GB',
    role: 'industry',
  },
  {
    name: 'Green Thumb Creator (DEMO)',
    handle: 'greenthumb_creator_demo',
    platform: 'instagram',
    country: 'US',
    role: 'influencer',
  },
  {
    name: 'Hydro Rival TV (DEMO)',
    handle: 'hydrorivaltv_demo',
    platform: 'youtube',
    country: 'NL',
    role: 'competitor',
  },
  {
    name: 'Grow Guides Channel (DEMO)',
    handle: 'growguides_demo',
    platform: 'youtube',
    country: 'US',
    role: 'influencer',
  },
  {
    name: 'Hydro Rival (DEMO)',
    handle: 'hydrorival_demo',
    platform: 'x',
    country: 'NL',
    role: 'competitor',
  },
  {
    name: 'Hydro Rival (DEMO)',
    handle: 'hydrorival-demo.bsky.social',
    platform: 'bluesky',
    country: 'NL',
    role: 'competitor',
  },
];

/** Account type of a public demo profile. */
const PUBLIC_ACCOUNT_TYPE: Record<string, string> = {
  youtube: 'channel',
  x: 'profile',
  bluesky: 'profile',
};

/**
 * Platforms Scopie reads only through public data (no owner connection), so even own DEMO
 * profiles there get public-style DEMO DATA: never reach, saves or other private metrics.
 */
const PUBLIC_ONLY_PLATFORMS = new Set(['x', 'bluesky']);

/** Bluesky handles are domain names, so they can't contain underscores. */
function demoHandle(platform: string, market: string): string {
  return platform === 'bluesky' ? `canna-${market}-demo.bsky.social` : `canna_${market}_demo`;
}

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
        handle: demoHandle(entry.platform, market.handle),
        account_type: entry.type,
        country_code: market.country,
        language: market.language,
        timezone: market.timezone,
        owner_user_id: ownerId,
        connection_status: 'demo',
        business_role: 'owned',
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
      account_type: PUBLIC_ACCOUNT_TYPE[competitor.platform] ?? 'business',
      country_code: competitor.country,
      business_role: competitor.role,
      connection_status: 'demo',
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

  // DEMO posts and metrics for every active demo profile, own and competitor alike.
  const { data: ownAccounts, error: ownError } = await supabase
    .from('social_accounts')
    .select('id, platform_key, handle, display_name, business_role')
    .eq('organization_id', org.id)
    .eq('is_active', true);
  if (ownError) throw ownError;
  const now = new Date();
  let posts = 0;
  let facts = 0;
  for (const account of ownAccounts) {
    // Competitors, industry accounts and creators are public profiles: public metrics only.
    const isPublic =
      account.business_role !== 'owned' || PUBLIC_ONLY_PLATFORMS.has(account.platform_key);
    const demo = generateDemoAccount({
      // Each market uses one handle on several platforms; the platform keeps their numbers apart.
      seed: `${account.handle ?? account.id}:${account.platform_key}`,
      platformKey: account.platform_key,
      now,
      mode: isPublic ? 'public' : 'connected',
    });
    if (isPublic) {
      // Older seeds made owner-style DEMO DATA for own X profiles. A public profile never
      // holds private metrics, so any left over are removed.
      // Public observations are lifetime values read at 06:00; anything else is owner-style.
      const { data: rows } = await supabase
        .from('account_metric_snapshots')
        .select('id, period, captured_at')
        .eq('social_account_id', account.id);
      const ownerStyle = (rows ?? [])
        .filter((row) => row.period === 'day' || !row.captured_at.includes('T06:00:00'))
        .map((row) => row.id);
      for (let index = 0; index < ownerStyle.length; index += 200) {
        await supabase
          .from('account_metric_snapshots')
          .delete()
          .in('id', ownerStyle.slice(index, index + 200));
      }
      const { data: stale } = await supabase
        .from('posts')
        .select('id')
        .eq('social_account_id', account.id);
      for (let index = 0; index < (stale?.length ?? 0); index += 200) {
        await supabase
          .from('post_metric_snapshots')
          .delete()
          .in(
            'post_id',
            stale!.slice(index, index + 200).map((post) => post.id),
          )
          .in('metric_key', ['reach', 'interactions', 'watch_time', 'avg_watch_duration']);
      }
    }
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
    for (const observation of demo.observations) {
      const result = await ingest(
        supabase,
        { ...base, capturedAt: observation.capturedAt, accountMetrics: observation.metrics },
        'sync',
      );
      facts += result.accountMetricsWritten;
    }
    const firstObservation = demo.observations[0]?.capturedAt ?? demo.accountCapturedAt;
    const { error: observedError } = await supabase
      .from('social_accounts')
      .update({
        first_observed_at: isPublic ? firstObservation : null,
        last_observed_at: isPublic ? (demo.observations.at(-1)?.capturedAt ?? null) : null,
        earliest_post_at: demo.earliestPostAt,
      })
      .eq('id', account.id);
    if (observedError) throw observedError;
    if (isPublic) {
      // Two DEMO profile versions, so profile changes can be shown.
      await supabase.from('profile_snapshots').delete().eq('social_account_id', account.id);
      const middle = demo.observations[Math.floor(demo.observations.length / 2)]?.capturedAt;
      const { error: snapshotError } = await supabase.from('profile_snapshots').insert([
        {
          organization_id: org.id,
          social_account_id: account.id,
          observed_at: firstObservation,
          data_source: 'demo',
          username: account.handle,
          display_name: account.display_name,
          biography: 'DEMO DATA. Fictional profile for local development.',
          website: 'https://example.com/',
        },
        ...(middle
          ? [
              {
                organization_id: org.id,
                social_account_id: account.id,
                observed_at: middle,
                data_source: 'demo' as const,
                username: account.handle,
                display_name: account.display_name,
                biography: 'DEMO DATA. Fictional profile, new autumn range bio.',
                website: 'https://example.com/autumn',
              },
            ]
          : []),
      ]);
      if (snapshotError) throw snapshotError;
    }
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

  const content = await seedContent(supabase, org.id, ownerId, teamIds[0]!);

  const reviews = await seedReviews(url, password, org.id, ownerId);

  const strategy = await seedStrategy(supabase, org.id, ownerId);

  console.log(`Seeded DEMO DATA into "${org.name}" (/${org.slug}/dashboard)`);
  console.log(`  ${accounts.length} demo social accounts (${created} new)`);
  console.log(`  ${posts} DEMO posts and ${facts} new DEMO metric values`);
  console.log(`  ${content.items} DEMO content items (${content.created} new) and a DEMO taxonomy`);
  console.log(`  ${reviews}`);
  console.log(`  ${strategy}`);
  console.log(
    `  Sign in as ${DEMO_USER_EMAIL} (owner), ${DEMO_TEAM.map((m) => `${m.email} (${m.role.toLowerCase()})`).join(', ')}`,
  );
  console.log(`  Password: the DEMO_USER_PASSWORD value (default "scopie-demo-password")`);
}

const DEMO_TAXONOMY = {
  content_pillars: [
    { name: 'Grow knowledge (DEMO)', color: 'green' },
    { name: 'Product stories (DEMO)', color: 'blue' },
    { name: 'Community (DEMO)', color: 'amber' },
  ],
  content_formats: [{ name: 'Reel (DEMO)' }, { name: 'Carousel (DEMO)' }, { name: 'Video (DEMO)' }],
  campaigns: [{ name: 'Autumn range (DEMO)' }, { name: 'Grower stories (DEMO)' }],
  audiences: [{ name: 'Hobby growers (DEMO)' }, { name: 'Retailers (DEMO)' }],
  cta_types: [{ name: 'Find a stockist (DEMO)' }, { name: 'Read the guide (DEMO)' }],
} as const;

type TaxonomyTable = keyof typeof DEMO_TAXONOMY;

/** Fictional content ideas and drafts. dayOffset is days from today, in the org's time zone. */
const DEMO_CONTENT: {
  title: string;
  status: 'IDEA' | 'DRAFT';
  platforms: string[];
  country: string | null;
  dayOffset: number | null;
  time?: string;
  pillar?: number;
  format?: number;
  campaign?: number;
  audience?: number;
  cta?: number;
  caption?: string;
  hashtags?: string[];
}[] = [
  {
    title: 'Autumn feeding tips reel (DEMO)',
    status: 'DRAFT',
    platforms: ['instagram', 'tiktok'],
    country: 'NL',
    dayOffset: 2,
    pillar: 0,
    format: 0,
    campaign: 0,
    audience: 0,
    cta: 1,
    caption: 'DEMO DATA. Feed little and often as the days get shorter.',
    hashtags: ['demo', 'growtips'],
  },
  {
    title: 'New range unboxing (DEMO)',
    status: 'DRAFT',
    platforms: ['youtube'],
    country: null,
    dayOffset: 5,
    time: '17:00',
    pillar: 1,
    format: 2,
    campaign: 0,
    cta: 0,
    caption: 'DEMO DATA. A first look at the autumn range.',
    hashtags: ['demo'],
  },
  {
    title: 'Grower of the month (DEMO)',
    status: 'IDEA',
    caption: "DEMO DATA. Meet this month's grower.",
    platforms: ['instagram', 'facebook'],
    country: 'ES',
    dayOffset: 9,
    pillar: 2,
    format: 1,
    campaign: 1,
    audience: 0,
  },
  {
    title: 'Stockist spotlight carousel (DEMO)',
    status: 'IDEA',
    platforms: ['linkedin'],
    country: 'GB',
    dayOffset: 14,
    pillar: 1,
    format: 1,
    audience: 1,
    cta: 0,
  },
  {
    title: 'pH basics explainer (DEMO)',
    status: 'DRAFT',
    platforms: ['instagram'],
    country: 'DE',
    dayOffset: -3,
    time: '12:30',
    pillar: 0,
    format: 0,
    cta: 1,
    caption: 'DEMO DATA. Why pH matters, in 30 seconds.',
  },
  {
    title: 'Behind the scenes at the lab (DEMO)',
    status: 'IDEA',
    platforms: ['tiktok'],
    country: null,
    dayOffset: null,
    pillar: 2,
  },
];

/** DEMO taxonomy and content items. Safe to re-run: rows are matched by name or title. */
async function seedContent(
  supabase: ReturnType<typeof createClient<Database>>,
  orgId: string,
  ownerId: string,
  managerId: string,
) {
  const ids = {} as Record<TaxonomyTable, string[]>;
  for (const table of Object.keys(DEMO_TAXONOMY) as TaxonomyTable[]) {
    ids[table] = [];
    for (const row of DEMO_TAXONOMY[table]) {
      const { data: existing, error: findError } = await supabase
        .from(table)
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', row.name)
        .maybeSingle();
      if (findError) throw findError;
      if (existing) {
        ids[table].push(existing.id);
        continue;
      }
      const { data, error } = await supabase
        .from(table)
        .insert({ ...row, organization_id: orgId, description: 'DEMO DATA.' })
        .select('id')
        .single();
      if (error) throw error;
      ids[table].push(data.id);
    }
  }

  const timeZone = DEMO_ORG.default_timezone;
  const today = utcToZonedParts(new Date(), timeZone).date;
  const dayFrom = (offset: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const pick = (table: TaxonomyTable, index: number | undefined) =>
    index === undefined ? null : ids[table][index]!;

  let created = 0;
  for (const [index, entry] of DEMO_CONTENT.entries()) {
    const item = {
      organization_id: orgId,
      title: entry.title,
      platform_keys: entry.platforms,
      country_code: entry.country,
      owner_user_id: index % 2 === 0 ? ownerId : managerId,
      pillar_id: pick('content_pillars', entry.pillar),
      content_format_id: pick('content_formats', entry.format),
      campaign_id: pick('campaigns', entry.campaign),
      audience_id: pick('audiences', entry.audience),
      cta_type_id: pick('cta_types', entry.cta),
      planned_publish_at:
        entry.dayOffset === null
          ? null
          : zonedDateTimeToUtc(
              dayFrom(entry.dayOffset),
              entry.time ?? '09:00',
              timeZone,
            ).toISOString(),
    };
    const { data: existing, error: findError } = await supabase
      .from('content_items')
      .select('id')
      .eq('organization_id', orgId)
      .eq('title', entry.title)
      .maybeSingle();
    if (findError) throw findError;
    let itemId = existing?.id;
    if (itemId) {
      const { error } = await supabase.from('content_items').update(item).eq('id', itemId);
      if (error) throw error;
      // Fill in copy added to the seed later, without overwriting edits.
      if (entry.caption) {
        const { error: captionError } = await supabase
          .from('content_versions')
          .update({ caption: entry.caption })
          .eq('content_item_id', itemId)
          .is('caption', null)
          .is('submitted_at', null);
        if (captionError) throw captionError;
      }
    } else {
      const { data, error } = await supabase
        .from('content_items')
        .insert({ ...item, status: entry.status, created_by: ownerId })
        .select('id')
        .single();
      if (error) throw error;
      itemId = data.id;
      created += 1;
      // Version 1 is created by the database; fill in its copy.
      const { error: versionError } = await supabase
        .from('content_versions')
        .update({
          caption: entry.caption ?? null,
          hashtags: entry.hashtags ?? [],
          notes: 'DEMO DATA. Fictional content for local development.',
        })
        .eq('content_item_id', itemId)
        .eq('version_number', 1);
      if (versionError) throw versionError;
    }
  }
  return { items: DEMO_CONTENT.length, created };
}

/**
 * DEMO review activity: submissions, decisions and comments made as the demo users through
 * the same functions the app uses, so stage history and notifications are real rows.
 * Only touches DEMO items that haven't been through review yet.
 */
async function seedReviews(
  url: string,
  password: string,
  orgId: string,
  ownerId: string,
): Promise<string> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return 'DEMO review activity skipped: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set';
  const signIn = async (email: string) => {
    const client = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
    return client;
  };
  const owner = await signIn(DEMO_USER_EMAIL);
  const manager = await signIn(DEMO_TEAM[0]!.email);
  const check = ({ error }: { error: { message: string } | null }) => {
    if (error) throw new Error(error.message);
  };

  const { data: items, error } = await owner
    .from('content_items')
    .select('id, title, status, content_reviews(id)')
    .eq('organization_id', orgId)
    .like('title', '%(DEMO)');
  if (error) throw error;
  const fresh = new Map(
    items
      .filter(
        (item) => item.content_reviews.length === 0 && ['IDEA', 'DRAFT'].includes(item.status),
      )
      .map((item) => [item.title, item.id]),
  );
  let flows = 0;
  const flow = async (title: string, steps: (id: string) => Promise<void>) => {
    const id = fresh.get(title);
    if (!id) return;
    await steps(id);
    flows += 1;
  };

  // Approved and scheduled.
  await flow('Autumn feeding tips reel (DEMO)', async (id) => {
    check(
      await owner.rpc('submit_content_for_review', {
        item_id: id,
        note: 'DEMO DATA. Ready for a look.',
      }),
    );
    check(
      await manager.rpc('review_content', {
        item_id: id,
        decision: 'APPROVED',
        comment: 'DEMO DATA. Looks good.',
      }),
    );
    check(await owner.rpc('set_content_scheduled', { item_id: id, scheduled: true }));
  });
  // Waiting for the owner's review, with a comment mentioning them.
  await flow('New range unboxing (DEMO)', async (id) => {
    check(
      await manager.rpc('submit_content_for_review', {
        item_id: id,
        note: 'DEMO DATA. Can you check the product names?',
      }),
    );
    check(
      await manager.from('content_comments').insert({
        organization_id: orgId,
        content_item_id: id,
        body: "DEMO DATA. The second shot still shows last year's label.",
        mentions: [ownerId],
      }),
    );
  });
  // Sent back with changes requested.
  await flow('Grower of the month (DEMO)', async (id) => {
    check(await owner.rpc('submit_content_for_review', { item_id: id }));
    check(
      await manager.rpc('review_content', {
        item_id: id,
        decision: 'CHANGES_REQUESTED',
        comment: 'DEMO DATA. Please add a quote from the grower.',
      }),
    );
  });
  // Approved and published, in the past.
  await flow('pH basics explainer (DEMO)', async (id) => {
    check(await owner.rpc('submit_content_for_review', { item_id: id }));
    check(await manager.rpc('review_content', { item_id: id, decision: 'APPROVED' }));
    check(await owner.rpc('mark_content_published', { item_id: id }));
  });
  return `DEMO review activity for ${flows} content items`;
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});

const DEMO_STRATEGY = {
  name: 'Autumn Europe (DEMO)',
  summary:
    'DEMO DATA. Grow the home grower community in our biggest European markets this quarter.',
  countryCodes: ['NL', 'DE', 'ES', 'GB'],
  toneOfVoice: 'DEMO DATA. Friendly and expert. Short sentences, no jargon, no slang.',
  priorities: [
    'More grower stories (DEMO)',
    'Reels first on Instagram (DEMO)',
    'Answer every question within a day (DEMO)',
  ],
  // Shares of output per DEMO pillar, by DEMO_TAXONOMY.content_pillars index.
  pillars: [
    { pillar: 0, targetShare: 40 },
    { pillar: 1, targetShare: 30 },
    { pillar: 2, targetShare: 30 },
  ],
  objectives: [
    { name: 'Publish 12 pieces of content (DEMO)', kpi: 'published_content', target: 12 },
    { name: 'Post 5 times a week (DEMO)', kpi: 'posts_per_week', target: 5 },
    { name: 'Gain 2,000 followers (DEMO)', kpi: 'follower_growth', target: 2000 },
    { name: 'More stockist mentions (DEMO)', kpi: 'manual', target: null },
  ],
  // Content items linked to an objective, by title and objective index.
  links: [
    { title: 'Autumn feeding tips reel (DEMO)', objective: 0 },
    { title: 'pH basics explainer (DEMO)', objective: 0 },
    { title: 'Grower of the month (DEMO)', objective: 2 },
  ],
} as const;

/** A DEMO strategy for the current quarter. Safe to re-run: matched by name. */
async function seedStrategy(
  supabase: ReturnType<typeof createClient<Database>>,
  orgId: string,
  ownerId: string,
) {
  const period = quarterOf(utcToZonedParts(new Date(), DEMO_ORG.default_timezone).date);
  const { data: existing, error: findError } = await supabase
    .from('strategies')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', DEMO_STRATEGY.name)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return `DEMO strategy "${DEMO_STRATEGY.name}" already there`;

  const { data: strategy, error } = await supabase
    .from('strategies')
    .insert({
      organization_id: orgId,
      name: DEMO_STRATEGY.name,
      summary: DEMO_STRATEGY.summary,
      status: 'active',
      period_start: period.start,
      period_end: period.end,
      country_codes: [...DEMO_STRATEGY.countryCodes],
      tone_of_voice: DEMO_STRATEGY.toneOfVoice,
      priorities: [...DEMO_STRATEGY.priorities],
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (error) throw error;

  const byName = async (table: 'content_pillars' | 'audiences', names: readonly string[]) => {
    const { data, error } = await supabase
      .from(table)
      .select('id, name')
      .eq('organization_id', orgId)
      .in('name', [...names]);
    if (error) throw error;
    return names.map((name) => data.find((row) => row.name === name)!.id);
  };
  const pillarIds = await byName(
    'content_pillars',
    DEMO_TAXONOMY.content_pillars.map((p) => p.name),
  );
  const audienceIds = await byName(
    'audiences',
    DEMO_TAXONOMY.audiences.map((a) => a.name),
  );

  const { data: objectives, error: objectiveError } = await supabase
    .from('strategy_objectives')
    .insert(
      DEMO_STRATEGY.objectives.map((o, position) => ({
        organization_id: orgId,
        strategy_id: strategy.id,
        name: o.name,
        description: 'DEMO DATA.',
        kpi: o.kpi,
        target_value: o.target,
        position,
      })),
    )
    .select('id, position');
  if (objectiveError) throw objectiveError;
  const objectiveAt = (position: number) => objectives.find((o) => o.position === position)!.id;

  const { error: pillarError } = await supabase.from('strategy_pillars').insert(
    DEMO_STRATEGY.pillars.map((p) => ({
      organization_id: orgId,
      strategy_id: strategy.id,
      pillar_id: pillarIds[p.pillar]!,
      target_share: p.targetShare,
    })),
  );
  if (pillarError) throw pillarError;

  const { error: audienceError } = await supabase.from('strategy_audiences').insert(
    audienceIds.map((audienceId) => ({
      organization_id: orgId,
      strategy_id: strategy.id,
      audience_id: audienceId,
    })),
  );
  if (audienceError) throw audienceError;

  const { data: competitors, error: competitorFindError } = await supabase
    .from('social_accounts')
    .select('id')
    .eq('organization_id', orgId)
    .eq('business_role', 'competitor')
    .in('country_code', [...DEMO_STRATEGY.countryCodes]);
  if (competitorFindError) throw competitorFindError;
  if (competitors.length) {
    const { error: competitorError } = await supabase.from('strategy_competitors').insert(
      competitors.map((c) => ({
        organization_id: orgId,
        strategy_id: strategy.id,
        social_account_id: c.id,
      })),
    );
    if (competitorError) throw competitorError;
  }

  for (const link of DEMO_STRATEGY.links) {
    const { error: linkError } = await supabase
      .from('content_items')
      .update({ strategy_objective_id: objectiveAt(link.objective) })
      .eq('organization_id', orgId)
      .eq('title', link.title);
    if (linkError) throw linkError;
  }

  return `DEMO strategy "${DEMO_STRATEGY.name}" for ${period.start} to ${period.end}`;
}
