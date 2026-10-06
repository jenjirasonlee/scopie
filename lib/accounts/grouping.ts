export type Groupable = { country_code: string | null };

export type AccountGroup<T> = { key: string; label: string; accounts: T[] };

/** Groups accounts by country, sorted by country name; accounts without a country go last. */
export function groupByCountry<T extends Groupable>(
  accounts: T[],
  countryNames: Map<string, string>,
): AccountGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const account of accounts) {
    const key = account.country_code ?? '__none';
    const list = groups.get(key) ?? [];
    list.push(account);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: key === '__none' ? 'No country' : (countryNames.get(key) ?? key),
      accounts: list,
    }))
    .sort((a, b) => {
      if (a.key === '__none') return 1;
      if (b.key === '__none') return -1;
      return a.label.localeCompare(b.label);
    });
}
