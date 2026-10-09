import 'server-only';
import { createClient, type ServerClient } from '@/lib/db/server';
import { isPillarColor, type PillarColor } from '@/lib/taxonomy/shared';
import { compareStrategies, type StrategyKpi, type StrategyStatus } from './shared';

/** The fields every strategy view uses. Dates are calendar days ("2026-10-01"), both included. */
export type StrategySummary = {
  id: string;
  name: string;
  summary: string | null;
  status: StrategyStatus;
  periodStart: string;
  periodEnd: string;
  /** Empty means all markets. */
  countryCodes: string[];
  /** Empty means all platforms. */
  platformKeys: string[];
  objectiveCount: number;
  updatedAt: string;
};

export type StrategyObjective = {
  id: string;
  name: string;
  description: string | null;
  kpi: StrategyKpi;
  /** Null only for manual objectives without a target. */
  targetValue: number | null;
  position: number;
};

export type StrategyPillarTarget = {
  pillarId: string;
  name: string;
  color: PillarColor | null;
  isActive: boolean;
  /** Percentage of the strategy's content, above 0 and at most 100. */
  targetShare: number;
};

export type StrategyAudience = { audienceId: string; name: string; isActive: boolean };

export type StrategyCompetitor = {
  accountId: string;
  name: string;
  handle: string | null;
  platformKey: string;
  countryCode: string | null;
  isActive: boolean;
};

/** One strategy with everything the detail page shows. Passed to the coverage and progress panels. */
export type StrategyDetail = Omit<StrategySummary, 'objectiveCount'> & {
  organizationId: string;
  toneOfVoice: string | null;
  priorities: string[];
  createdAt: string;
  /** In position order. */
  objectives: StrategyObjective[];
  /** Highest target first. */
  pillars: StrategyPillarTarget[];
  audiences: StrategyAudience[];
  competitors: StrategyCompetitor[];
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Every strategy of the organization: active first, then drafts, then archived. */
export async function listStrategies(orgId: string, db?: ServerClient): Promise<StrategySummary[]> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase
    .from('strategies')
    .select(
      'id, name, summary, status, period_start, period_end, country_codes, platform_keys, updated_at, strategy_objectives(count)',
    )
    .eq('organization_id', orgId)
    .limit(500);
  if (error) throw error;
  return data
    .map((row) => ({
      id: row.id,
      name: row.name,
      summary: row.summary,
      status: row.status,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      countryCodes: row.country_codes,
      platformKeys: row.platform_keys,
      objectiveCount: row.strategy_objectives[0]?.count ?? 0,
      updatedAt: row.updated_at,
    }))
    .sort(compareStrategies);
}

export async function getStrategy(
  orgId: string,
  id: string,
  db?: ServerClient,
): Promise<StrategyDetail | null> {
  const supabase = db ?? (await createClient());
  const { data: row, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [objectives, pillars, audiences, competitors] = await Promise.all([
    supabase
      .from('strategy_objectives')
      .select('id, name, description, kpi, target_value, position, created_at')
      .eq('organization_id', orgId)
      .eq('strategy_id', id)
      .order('position')
      .order('created_at'),
    supabase
      .from('strategy_pillars')
      .select('pillar_id, target_share, content_pillars(name, color, is_active)')
      .eq('organization_id', orgId)
      .eq('strategy_id', id),
    supabase
      .from('strategy_audiences')
      .select('audience_id, audiences(name, is_active)')
      .eq('organization_id', orgId)
      .eq('strategy_id', id),
    supabase
      .from('strategy_competitors')
      .select(
        'social_account_id, social_accounts(display_name, handle, platform_key, country_code, is_active)',
      )
      .eq('organization_id', orgId)
      .eq('strategy_id', id),
  ]);
  for (const result of [objectives, pillars, audiences, competitors]) {
    if (result.error) throw result.error;
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    summary: row.summary,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    countryCodes: row.country_codes,
    platformKeys: row.platform_keys,
    toneOfVoice: row.tone_of_voice,
    priorities: row.priorities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    objectives: (objectives.data ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      kpi: o.kpi,
      targetValue: o.target_value === null ? null : Number(o.target_value),
      position: o.position,
    })),
    pillars: (pillars.data ?? [])
      .filter((p) => p.content_pillars)
      .map((p) => ({
        pillarId: p.pillar_id,
        name: p.content_pillars!.name,
        color: isPillarColor(p.content_pillars!.color) ? p.content_pillars!.color : null,
        isActive: p.content_pillars!.is_active,
        targetShare: Number(p.target_share),
      }))
      .sort((a, b) => b.targetShare - a.targetShare || byName(a, b)),
    audiences: (audiences.data ?? [])
      .filter((a) => a.audiences)
      .map((a) => ({
        audienceId: a.audience_id,
        name: a.audiences!.name,
        isActive: a.audiences!.is_active,
      }))
      .sort(byName),
    competitors: (competitors.data ?? [])
      .filter((c) => c.social_accounts)
      .map((c) => ({
        accountId: c.social_account_id,
        name: c.social_accounts!.display_name,
        handle: c.social_accounts!.handle,
        platformKey: c.social_accounts!.platform_key,
        countryCode: c.social_accounts!.country_code,
        isActive: c.social_accounts!.is_active,
      }))
      .sort((a, b) => a.platformKey.localeCompare(b.platformKey) || byName(a, b)),
  };
}

/** Profiles that can be watched as competitors: those marked with the competitor role. */
export async function listCompetitorProfiles(orgId: string): Promise<StrategyCompetitor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .select('id, display_name, handle, platform_key, country_code, is_active')
    .eq('organization_id', orgId)
    .eq('business_role', 'competitor')
    .order('platform_key')
    .order('display_name');
  if (error) throw error;
  return data.map((row) => ({
    accountId: row.id,
    name: row.display_name,
    handle: row.handle,
    platformKey: row.platform_key,
    countryCode: row.country_code,
    isActive: row.is_active,
  }));
}

export type ObjectiveOption = {
  value: string;
  label: string;
  /** The strategy, used to group the choices. */
  groupId: string;
  group: string;
  /** False for objectives of archived strategies: only listed when content already uses them. */
  active: boolean;
};

/**
 * Objectives content can be linked to, grouped by strategy. Objectives of archived strategies
 * are included but marked inactive, so the content form only shows them when already chosen.
 */
export async function listObjectiveOptions(orgId: string): Promise<ObjectiveOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('strategy_objectives')
    .select('id, name, position, strategies!inner(id, name, status, period_start)')
    .eq('organization_id', orgId)
    .limit(1000);
  if (error) throw error;
  return data
    .map((row) => ({
      value: row.id,
      label: row.name,
      groupId: row.strategies.id,
      group: row.strategies.name,
      active: row.strategies.status !== 'archived',
      position: row.position,
      status: row.strategies.status,
      periodStart: row.strategies.period_start,
    }))
    .sort(
      (a, b) =>
        compareStrategies(
          { status: a.status, periodStart: a.periodStart, name: a.group },
          { status: b.status, periodStart: b.periodStart, name: b.group },
        ) ||
        a.groupId.localeCompare(b.groupId) ||
        a.position - b.position,
    )
    .map(({ value, label, groupId, group, active }) => ({ value, label, groupId, group, active }));
}
