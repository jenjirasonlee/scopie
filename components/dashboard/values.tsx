import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { BUSINESS_ROLE_LABELS } from '@/lib/accounts/labels';
import {
  UNAVAILABLE_LABELS,
  type DataSource,
  type ProfileRecord,
  type Unavailable,
} from '@/lib/analytics/types';

/** Shown instead of a number that isn't available. Never a zero. */
export function Missing({ result, label }: { result?: Unavailable; label?: string }) {
  return (
    <span className="text-muted-foreground text-xs italic" title={result?.detail}>
      {label ?? (result ? UNAVAILABLE_LABELS[result.reason] : 'not available')}
    </span>
  );
}

/** One badge per distinct source. */
export function SourceBadges({ sources }: { sources: Iterable<DataSource> }) {
  const unique = [...new Set(sources)];
  return (
    <span className="inline-flex gap-1">
      {unique.map((source) => (
        <DataSourceBadge key={source} source={source} />
      ))}
    </span>
  );
}

export function ProfileLink({
  orgSlug,
  profile,
  showRole = false,
}: {
  orgSlug: string;
  profile: ProfileRecord;
  showRole?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <PlatformMark platformKey={profile.platformKey} />
      <span className="min-w-0">
        <Link
          href={`/${orgSlug}/accounts/${profile.id}`}
          className="block truncate font-medium hover:underline"
        >
          {profile.name}
        </Link>
        {showRole ? (
          <span className="text-muted-foreground block text-xs">
            {BUSINESS_ROLE_LABELS[profile.businessRole]}
            {profile.countryCode ? ` · ${profile.countryCode}` : ''}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-5 py-6 text-[13px]">{children}</p>;
}
