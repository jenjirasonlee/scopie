import { SubmitButton } from '@/components/shared/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { removeProfileAndData } from '@/lib/public-data/actions';

/** Deletes a profile and everything stored about it, after typing DELETE. */
export function RemoveProfileCard({
  orgSlug,
  accountId,
  name,
  status,
}: {
  orgSlug: string;
  accountId: string;
  name: string;
  status: string | null;
}) {
  return (
    <Card className="border-destructive/40 h-fit">
      <CardHeader>
        <CardTitle>Remove profile and data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        <p className="text-muted-foreground">
          Deletes {name} with all its posts, observations and imports. This can&apos;t be undone. To
          only stop collecting, set the profile to inactive instead.
        </p>
        {status === 'confirm' ? (
          <p className="text-destructive" role="alert">
            Type DELETE to confirm.
          </p>
        ) : status === 'failed' ? (
          <p className="text-destructive" role="alert">
            Could not remove the profile. Please try again.
          </p>
        ) : null}
        <form action={removeProfileAndData.bind(null, orgSlug)} className="space-y-2">
          <input type="hidden" name="accountId" value={accountId} />
          <Label htmlFor="remove-confirm">Type DELETE to confirm</Label>
          <Input id="remove-confirm" name="confirm" autoComplete="off" />
          <SubmitButton variant="destructive" size="sm" pendingLabel="Removing…">
            Remove profile and data
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
