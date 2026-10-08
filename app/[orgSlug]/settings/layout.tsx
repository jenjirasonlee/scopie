import { Suspense } from 'react';
import { SettingsNav } from '@/components/settings/settings-nav';
import { PageHeader } from '@/components/shared/page-header';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your profile, organization settings, members, data sources and content taxonomy."
      />
      <div className="grid gap-8 md:grid-cols-[180px_minmax(0,1fr)]">
        <Suspense>
          <SettingsNav />
        </Suspense>
        <div className="max-w-3xl min-w-0">{children}</div>
      </div>
    </div>
  );
}
