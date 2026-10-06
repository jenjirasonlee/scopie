import { SubmitButton } from '@/components/shared/submit-button';
import { setSocialAccountActive } from '@/lib/accounts/actions';

export function ActiveToggle({
  orgSlug,
  accountId,
  isActive,
  size = 'sm',
}: {
  orgSlug: string;
  accountId: string;
  isActive: boolean;
  size?: 'sm' | 'default';
}) {
  return (
    <form action={setSocialAccountActive.bind(null, orgSlug)}>
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="active" value={isActive ? 'false' : 'true'} />
      <SubmitButton variant={isActive ? 'ghost' : 'outline'} size={size}>
        {isActive ? 'Deactivate' : 'Activate'}
      </SubmitButton>
    </form>
  );
}
