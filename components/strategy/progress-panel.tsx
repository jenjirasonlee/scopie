import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ObjectiveInput, ObjectiveProgress } from '@/lib/strategy/progress';
import { cn } from '@/lib/utils';

const number = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 1 });

const UNIT: Record<ObjectiveInput['kpi'], string> = {
  published_content: 'published',
  posts_per_week: 'posts a week',
  follower_growth: 'new followers',
  manual: '',
};

export function ProgressCard({
  progress,
}: {
  progress: { objective: ObjectiveInput; result: ObjectiveProgress }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Objectives</CardTitle>
        <CardDescription>
          Progress measured from what Scopie has stored. Anything it can’t measure says why.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {progress.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">This strategy has no objectives yet.</p>
        ) : (
          <ul className="space-y-4">
            {progress.map(({ objective, result }) => (
              <li key={objective.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-medium">{objective.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {result.status === 'measured' ? (
                      <>
                        {number(result.value)}
                        <span className="text-muted-foreground">
                          {' '}
                          of {number(result.target)} {UNIT[objective.kpi]}
                        </span>
                      </>
                    ) : result.target !== null && result.target !== undefined ? (
                      <span className="text-muted-foreground">
                        Target {number(result.target)} {UNIT[objective.kpi]}
                      </span>
                    ) : null}
                  </span>
                </div>
                {result.status === 'measured' ? (
                  <>
                    <div className="bg-muted relative h-2 overflow-hidden rounded-full">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          result.ratio >= 1 ? 'bg-success' : 'bg-primary',
                        )}
                        style={{ width: `${Math.min(100, result.ratio * 100)}%` }}
                      />
                      {result.expectedByNow !== null && result.target > 0 ? (
                        <div
                          aria-hidden
                          className="bg-foreground absolute top-0 h-full w-0.5"
                          style={{
                            left: `${Math.min(100, (result.expectedByNow / result.target) * 100)}%`,
                          }}
                        />
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {result.basis}
                      {result.expectedByNow !== null
                        ? ` At an even pace it would be about ${number(Math.round(result.expectedByNow))} by now (the line).`
                        : ''}
                    </p>
                    {result.leftOut.length ? (
                      <details className="text-muted-foreground text-xs">
                        <summary className="cursor-pointer">
                          {result.leftOut.length}{' '}
                          {result.leftOut.length === 1 ? 'profile' : 'profiles'} not counted
                        </summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {result.leftOut.map((p) => (
                            <li key={p.name}>
                              {p.name}: {p.reason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {result.status === 'manual'
                      ? 'Tracked outside Scopie.'
                      : result.status === 'not_started'
                        ? `Measured once the strategy starts on ${new Date(`${result.startsOn}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}.`
                        : `Not measured: ${result.reason}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
