import { Badge } from '@/components/ui/badge';
import { DATA_SOURCE_LABELS, type DataSource } from '@/lib/accounts/labels';

const VARIANT: Record<DataSource, React.ComponentProps<typeof Badge>['variant']> = {
  authenticated: 'success',
  public: 'secondary',
  imported: 'outline',
  manual: 'outline',
  demo: 'demo',
};

const HELP: Record<DataSource, string> = {
  authenticated: 'Read from the platform with your permission',
  public: 'Read from public platform data',
  imported: 'Uploaded from a CSV file',
  manual: 'Typed in by a team member',
  demo: 'DEMO DATA: generated for testing, not real',
};

/** Every number in Scopie shows where it came from. */
export function DataSourceBadge({ source }: { source: DataSource }) {
  return (
    <Badge variant={VARIANT[source]} title={HELP[source]}>
      {DATA_SOURCE_LABELS[source]}
    </Badge>
  );
}
