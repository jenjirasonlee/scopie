import type { Metadata } from 'next';
import { AccountForm } from '@/components/accounts/account-form';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { createSocialAccount } from '@/lib/accounts/actions';
import { getAccountFormOptions } from '@/lib/accounts/form-options';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Add account' };

export default async function NewAccountPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role } = await getOrgContext(orgSlug);
  const options = await getAccountFormOptions(org.id);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add social account"
        description="Record an account manually. It won't sync any data until its platform connector is available and connected."
      />
      {can(role, 'accounts.manage') ? (
        <AccountForm
          action={createSocialAccount.bind(null, orgSlug)}
          submitLabel="Add account"
          cancelHref={`/${orgSlug}/accounts`}
          {...options}
        />
      ) : (
        <Alert>
          <AlertDescription>Only owners and admins can add social accounts.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
