import { Clock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { navItem } from '@/lib/navigation';

/** Honest placeholder for modules that are not built yet. Shows no fake data. */
export function ComingSoon({ moduleKey }: { moduleKey: string }) {
  const item = navItem(moduleKey);
  const Icon = item.icon;
  return (
    <div className="space-y-6">
      <PageHeader title={item.label} description={item.summary} />
      <section
        aria-labelledby="coming-soon-title"
        className="bg-card flex flex-col gap-5 rounded-lg border border-dashed px-6 py-8 sm:flex-row sm:items-start"
      >
        <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
              <Clock className="size-3.5" aria-hidden />
              {item.phase ? `Planned for Phase ${item.phase}` : 'Planned'}
            </p>
            <h2 id="coming-soon-title" className="text-base font-semibold">
              Coming in a future phase.
            </h2>
            <p className="text-muted-foreground text-[13px]">
              This module isn&apos;t built yet, so there is nothing to show here. No sample or
              placeholder data is displayed.
            </p>
          </div>
          {item.planned?.length ? (
            <div>
              <p className="mb-1.5 text-[13px] font-medium">What it will do</p>
              <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-[13px]">
                {item.planned.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
