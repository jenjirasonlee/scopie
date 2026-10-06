import type { Metadata } from 'next';
import { ProfileForm } from '@/components/settings/profile-form';
import { getMyProfile } from '@/lib/profile/queries';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfileSettingsPage() {
  const profile = await getMyProfile();
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="text-muted-foreground text-[13px]">How you appear to your teammates.</p>
      </div>
      <ProfileForm
        email={profile.email}
        fullName={profile.full_name ?? ''}
        timezone={profile.timezone ?? ''}
      />
    </section>
  );
}
