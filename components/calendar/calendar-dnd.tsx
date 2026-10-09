'use client';

import { AlertCircle, Loader2, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { rescheduleContentItem } from '@/lib/calendar/actions';

/**
 * Drag and drop for editors, on top of the server-rendered calendar: chips marked
 * `data-move-item` can be dropped on any cell marked `data-drop-date`. Without JavaScript the
 * calendar still works; dates change from the side panel instead.
 */
export function CalendarDnd({
  orgSlug,
  className,
  children,
}: {
  orgSlug: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef<{ id: string; from: string | undefined } | null>(null);
  const over = useRef<HTMLElement | null>(null);

  function highlight(cell: HTMLElement | null) {
    if (over.current && over.current !== cell) delete over.current.dataset.dropActive;
    if (cell) cell.dataset.dropActive = 'true';
    over.current = cell;
  }

  function cellAt(target: EventTarget | null) {
    return target instanceof Element ? target.closest<HTMLElement>('[data-drop-date]') : null;
  }

  return (
    <div
      className={className}
      onDragStart={(event) => {
        const chip =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-move-item]')
            : null;
        if (!chip?.dataset.moveItem) return;
        dragging.current = { id: chip.dataset.moveItem, from: cellAt(chip)?.dataset.dropDate };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', chip.textContent ?? '');
        setError(null);
      }}
      onDragOver={(event) => {
        if (!dragging.current) return;
        const cell = cellAt(event.target);
        highlight(cell);
        if (!cell) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={(event) => {
        if (over.current && !over.current.contains(event.relatedTarget as Node | null)) {
          highlight(null);
        }
      }}
      onDrop={(event) => {
        const drag = dragging.current;
        const date = cellAt(event.target)?.dataset.dropDate;
        dragging.current = null;
        highlight(null);
        if (!drag || !date) return;
        event.preventDefault();
        if (date === drag.from) return;
        startTransition(async () => {
          try {
            const result = await rescheduleContentItem(orgSlug, drag.id, date);
            if (!result.ok) setError(result.message);
          } catch {
            setError('Could not move the content. Please try again.');
          }
        });
      }}
      onDragEnd={() => {
        dragging.current = null;
        highlight(null);
      }}
    >
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-end sm:inset-x-auto sm:right-6"
      >
        {pending ? (
          <p className="bg-card flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] shadow-md">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Moving…
          </p>
        ) : error ? (
          <p
            role="alert"
            className="bg-card text-destructive border-destructive/40 pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] shadow-md"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-muted-foreground hover:text-foreground -mr-1 ml-1 rounded-sm p-0.5"
              aria-label="Dismiss"
            >
              <X className="size-4" aria-hidden />
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
