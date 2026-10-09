import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS, type ContentStatus } from '@/lib/calendar/dates';
import { cn } from '@/lib/utils';

const VARIANTS: Record<
  ContentStatus,
  'muted' | 'secondary' | 'outline' | 'warning' | 'success' | 'destructive' | 'default'
> = {
  IDEA: 'muted',
  DRAFT: 'secondary',
  IN_REVIEW: 'warning',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'outline',
  SCHEDULED: 'default',
  PUBLISHED: 'success',
  ANALYSED: 'success',
  REJECTED: 'destructive',
  ARCHIVED: 'muted',
};

export function StatusBadge({ status, className }: { status: ContentStatus; className?: string }) {
  return (
    <Badge variant={VARIANTS[status]} className={cn(className)}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
