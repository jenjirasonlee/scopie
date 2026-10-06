import { FlaskConical } from 'lucide-react';

/** Persistent notice shown whenever an organization or view contains demo data. */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="border-warning/40 bg-warning/12 text-warning-foreground flex items-center gap-2 border-b px-6 py-1.5 text-xs"
    >
      <FlaskConical className="size-3.5" aria-hidden />
      <span>
        <strong className="font-semibold tracking-wide uppercase">Demo data.</strong> This
        organization contains fictional accounts for development. Nothing here is real CANNA data.
      </span>
    </div>
  );
}
