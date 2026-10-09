'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/permissions';
import type { FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { generateWeeklyReport } from './generate';
import { reportHref } from './shared';

const NO_PERMISSION: FormState = {
  status: 'error',
  message: 'Only owners, admins and managers can make a report.',
};

/**
 * Makes the report for last week (Monday to Sunday in the organization's time zone) and
 * opens it. When it already exists, opens that one instead of making a second.
 */
export async function generateReportAction(orgSlug: string): Promise<FormState> {
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;

  const result = await generateWeeklyReport({ orgId: org.id, userId: user.id, madeBy: 'manual' });
  if (result.status === 'error') return { status: 'error', message: result.message };

  revalidatePath(`/${orgSlug}/reports`);
  redirect(reportHref(orgSlug, result.reportId));
}
