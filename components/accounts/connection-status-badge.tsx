import { Badge } from '@/components/ui/badge';
import {
  CONNECTION_STATUS_HELP,
  CONNECTION_STATUS_LABELS,
  type ConnectionStatus,
} from '@/lib/accounts/labels';

const VARIANT: Record<ConnectionStatus, React.ComponentProps<typeof Badge>['variant']> = {
  not_connected: 'muted',
  connected: 'success',
  needs_reauth: 'warning',
  error: 'destructive',
  demo: 'demo',
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <Badge variant={VARIANT[status]} title={CONNECTION_STATUS_HELP[status]}>
      {CONNECTION_STATUS_LABELS[status]}
    </Badge>
  );
}
