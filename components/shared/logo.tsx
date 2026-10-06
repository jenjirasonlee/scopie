import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 24 24" className="text-primary size-5" aria-hidden>
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.25" />
        <path d="M16.2 16.2 21 21" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
        <path
          d="M8 13v-2M11 13V9M14 13v-3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
      Scopie
    </span>
  );
}
