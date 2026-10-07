import { Badge } from '@/components/ui/badge';
import { DATA_SOURCE_HELP, DATA_SOURCE_LABELS, type DataSource } from '@/lib/accounts/labels';

const VARIANT: Record<DataSource, React.ComponentProps<typeof Badge>['variant']> = {
  live_public: 'secondary',
  live_connected: 'success',
  imported: 'outline',
  estimated: 'warning',
  demo: 'demo',
};

/** Every number in Scopie shows where it came from. */
export function DataSourceBadge({ source }: { source: DataSource }) {
  return (
    <Badge variant={VARIANT[source]} title={DATA_SOURCE_HELP[source]}>
      {DATA_SOURCE_LABELS[source]}
    </Badge>
  );
}
