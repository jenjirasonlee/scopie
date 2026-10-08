import 'server-only';
import { getAccountFormOptions } from '@/lib/accounts/form-options';
import type { ContentFormOptionLists } from '@/components/content/content-form';
import { getContentFormOptions } from './queries';

/** Everything the content form and the content filters choose from. */
export async function getContentOptionLists(orgId: string): Promise<ContentFormOptionLists> {
  const [base, taxonomy] = await Promise.all([
    getAccountFormOptions(orgId),
    getContentFormOptions(orgId),
  ]);
  return { ...base, ...taxonomy };
}
