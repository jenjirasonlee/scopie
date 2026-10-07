import { Badge } from '@/components/ui/badge';
import type { Enums } from '@/lib/db/types';
import { SYNC_STATUS_LABELS } from '@/lib/accounts/labels';

const VARIANT: Record<Enums<'sync_status'>, React.ComponentProps<typeof Badge>['variant']> = {
  queued: 'muted',
  running: 'secondary',
  succeeded: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'muted',
};

export function SyncStatusBadge({ status }: { status: Enums<'sync_status'> }) {
  return <Badge variant={VARIANT[status]}>{SYNC_STATUS_LABELS[status]}</Badge>;
}
