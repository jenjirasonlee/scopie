import 'server-only';
import { getAccountFormOptions } from '@/lib/accounts/form-options';
import type { ContentFormOptionLists } from '@/components/content/content-form';
import { listObjectiveOptions } from '@/lib/strategy/queries';
import { getContentFormOptions } from './queries';

/** Everything the content form and the content filters choose from. */
export async function getContentOptionLists(orgId: string): Promise<ContentFormOptionLists> {
  const [base, taxonomy, objectives] = await Promise.all([
    getAccountFormOptions(orgId),
    getContentFormOptions(orgId),
    listObjectiveOptions(orgId),
  ]);
  return { ...base, ...taxonomy, objectives };
}
