import {
  comparePeriods,
  countryBenchmark,
  platformsOf,
  rankProfiles,
  summarizePeriodGroup,
  type BenchmarkMetric,
  type BenchmarkProfileData,
  type CountryRow,
  type PeriodGroupSummary,
  type PeriodRow,
  type Ranking,
} from './benchmark';
import { roleGroup } from './compare';
import { periodsFor } from './range';
import type { DataSource, Period, ProfileRecord } from './types';

export type BenchmarkGroupInput = { id: string; name: string; memberIds: readonly string[] };

export type BenchmarkView = {
  metric: BenchmarkMetric;
  /** 'all' or a group id. */
  setKey: string;
  /** Lower-case phrase for sentences: "all monitored profiles", "group “Spain”". */
  setLabel: string;
  setProfiles: ProfileRecord[];
  platforms: { key: string; count: number }[];
  /** null when the set has no profiles. */
  platformKey: string | null;
  periods: { current: Period; previous: Period };
  ranking: Ranking | null;
  countries: CountryRow[];
  periodRows: PeriodRow[];
  periodGroups: PeriodGroupSummary[];
};

/**
 * Everything the Benchmarks page shows, from stored observations only. The set is every
 * active profile or one benchmark group; rankings, countries and period comparisons are made
 * on one platform at a time (the requested one if the set has it, else the set's largest).
 */
export function buildBenchmarkView(input: {
  metric: BenchmarkMetric;
  set: string | undefined;
  platform: string | undefined;
  days: number;
  now: Date;
  source: DataSource;
  profiles: readonly ProfileRecord[];
  data: ReadonlyMap<string, BenchmarkProfileData>;
  groups: readonly BenchmarkGroupInput[];
}): BenchmarkView {
  const periods = periodsFor(input.now, input.days);
  const byId = new Map(input.profiles.map((p) => [p.id, p]));
  const group = input.groups.find((g) => g.id === input.set);
  const setKey = group ? group.id : 'all';
  const setLabel = group ? `group “${group.name}”` : 'all monitored profiles';
  // A group shows its paused members too (listed as paused); "all" means active profiles.
  const setProfiles = group
    ? group.memberIds.flatMap((id) => {
        const profile = byId.get(id);
        return profile ? [profile] : [];
      })
    : input.profiles.filter((p) => p.isActive);

  const platforms = platformsOf(setProfiles);
  const platformKey =
    platforms.find((p) => p.key === input.platform)?.key ?? platforms[0]?.key ?? null;

  const empty: BenchmarkView = {
    metric: input.metric,
    setKey,
    setLabel,
    setProfiles,
    platforms,
    platformKey,
    periods,
    ranking: null,
    countries: [],
    periodRows: [],
    periodGroups: [],
  };
  if (!platformKey) return empty;

  const dataOf = (profile: ProfileRecord): BenchmarkProfileData =>
    input.data.get(profile.id) ?? { profile, followers: [], posts: [] };

  const ranking = rankProfiles({
    metric: input.metric,
    platformKey,
    data: setProfiles.map(dataOf),
    period: periods.current,
    source: input.source,
    setLabel,
  });

  const onPlatform = (profile: ProfileRecord) =>
    profile.isActive && profile.platformKey === platformKey;
  const rowsById = new Map<string, PeriodRow>();
  const rowFor = (profile: ProfileRecord) => {
    let row = rowsById.get(profile.id);
    if (!row) {
      row = comparePeriods({
        metric: input.metric,
        data: dataOf(profile),
        periods,
        source: input.source,
      });
      rowsById.set(profile.id, row);
    }
    return row;
  };
  const periodRows = setProfiles.filter(onPlatform).map(rowFor);
  periodRows.sort(
    (a, b) =>
      roleOrder(a.profile) - roleOrder(b.profile) || a.profile.name.localeCompare(b.profile.name),
  );

  const periodGroups: PeriodGroupSummary[] = [
    summarizePeriodGroup('set', group ? group.name : 'All monitored profiles', periodRows),
  ];
  const own = periodRows.filter((r) => roleGroup(r.profile.businessRole) === 'owned');
  const competitors = periodRows.filter((r) => roleGroup(r.profile.businessRole) === 'competitor');
  if (own.length && own.length < periodRows.length) {
    periodGroups.push(summarizePeriodGroup('own', 'Own profiles', own));
  }
  if (competitors.length && competitors.length < periodRows.length) {
    periodGroups.push(summarizePeriodGroup('competitors', 'Competitors', competitors));
  }
  for (const other of input.groups) {
    if (other.id === group?.id) continue;
    const members = other.memberIds.flatMap((id) => {
      const profile = byId.get(id);
      return profile && onPlatform(profile) ? [profile] : [];
    });
    if (members.length) {
      periodGroups.push(summarizePeriodGroup(other.id, other.name, members.map(rowFor)));
    }
  }

  return {
    ...empty,
    ranking,
    countries: countryBenchmark(ranking),
    periodRows,
    periodGroups,
  };
}

function roleOrder(profile: ProfileRecord): number {
  const group = roleGroup(profile.businessRole);
  return group === 'owned' ? 0 : group === 'competitor' ? 1 : 2;
}
