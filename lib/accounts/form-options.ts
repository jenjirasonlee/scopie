import 'server-only';
import { listMembers } from '@/lib/members/queries';
import { listCountries, listPlatforms } from './queries';

export async function getAccountFormOptions(orgId: string) {
  const [platforms, countries, members] = await Promise.all([
    listPlatforms(),
    listCountries(),
    listMembers(orgId),
  ]);
  return {
    platforms: platforms.map((platform) => ({ value: platform.key, label: platform.name })),
    countries: countries.map((country) => ({ value: country.code, label: country.name })),
    members: members.map((member) => ({
      value: member.userId,
      label: member.fullName ?? member.email,
    })),
  };
}
