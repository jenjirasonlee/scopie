import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReviewHistoryEntry } from '@/lib/approvals/queries';
import { formatDateTime, historyNote, historyTitle } from '@/lib/content/review';
import { cn } from '@/lib/utils';

const DOT: Record<string, string> = {
  APPROVED: 'bg-success',
  CHANGES_REQUESTED: 'bg-warning',
  REJECTED: 'bg-destructive',
};

/** Every stage change and review decision, newest first. */
export function ReviewHistory({
  history,
  timeZone,
}: {
  history: ReviewHistoryEntry[];
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>Stage changes and review decisions, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length ? (
          <ol className="space-y-4">
            {history.map((entry) => {
              const note = entry.kind === 'review' ? entry.comment : historyNote(entry.note);
              return (
                <li key={`${entry.kind}-${entry.id}`} className="relative pl-4 text-[13px]">
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1.5 left-0 size-1.5 rounded-full',
                      (entry.kind === 'review' && DOT[entry.decision]) || 'bg-muted-foreground/50',
                    )}
                  />
                  <p className="font-medium">{historyTitle(entry)}</p>
                  <p className="text-muted-foreground text-xs">
                    {[
                      entry.actorName,
                      entry.kind === 'event' && entry.versionNumber
                        ? `version ${entry.versionNumber}`
                        : null,
                      formatDateTime(entry.at, timeZone),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  {note ? (
                    <p className="bg-muted/40 mt-1 rounded border-l-2 px-2 py-1 break-words whitespace-pre-line">
                      {note}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-muted-foreground text-[13px]">Nothing yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
