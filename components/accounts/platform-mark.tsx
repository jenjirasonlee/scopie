import { cn } from '@/lib/utils';

const MARKS: Record<string, { short: string; className: string }> = {
  instagram: { short: 'IG', className: 'bg-[#f6e3ef] text-[#8a1f5c]' },
  facebook: { short: 'FB', className: 'bg-[#e3ebfa] text-[#1d4596]' },
  linkedin: { short: 'IN', className: 'bg-[#e1eef7] text-[#0b5585]' },
  youtube: { short: 'YT', className: 'bg-[#fbe4e4] text-[#a11b1b]' },
  tiktok: { short: 'TT', className: 'bg-[#e6f6f5] text-[#0f5f5b]' },
  x: { short: 'X', className: 'bg-[#ececec] text-[#222]' },
  bluesky: { short: 'BS', className: 'bg-[#e2effc] text-[#0a4f94]' },
  threads: { short: 'TH', className: 'bg-[#efefef] text-[#333]' },
  pinterest: { short: 'PI', className: 'bg-[#fbe3e6] text-[#9b1027]' },
  reddit: { short: 'RD', className: 'bg-[#fdeadf] text-[#a13d0b]' },
  discord: { short: 'DC', className: 'bg-[#e9e9fb] text-[#3b3fa5]' },
};

/** Neutral text mark for a platform (no brand logos). */
export function PlatformMark({
  platformKey,
  className,
}: {
  platformKey: string;
  className?: string;
}) {
  const mark = MARKS[platformKey] ?? {
    short: platformKey.slice(0, 2).toUpperCase(),
    className: 'bg-muted',
  };
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-5 min-w-6 items-center justify-center rounded-sm px-1 text-[10px] font-semibold tracking-wide',
        mark.className,
        className,
      )}
    >
      {mark.short}
    </span>
  );
}
