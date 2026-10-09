import type { SupabaseClient } from '@supabase/supabase-js';
import { isEditableStatus } from '@/lib/content/shared';
import type { Database } from '@/lib/db/types';

// Saves a chosen caption as a NEW version of a content item, through the same database
// function as "Start version N" (create_content_version), then fills in the caption. Runs
// as the signed-in person, so the database checks their permission. Earlier versions are
// never changed, the status stays what it was (idea, draft or changes requested), and
// nothing is submitted or published.

export type SaveResult =
  { status: 'ok'; versionId: string; versionNumber: number } | { status: 'error'; message: string };

export async function saveCaptionAsNewVersion(
  db: SupabaseClient<Database>,
  input: {
    orgId: string;
    itemId: string;
    caption: string;
    hashtags: string[];
    /** Builds the new version's notes from the notes it copied. */
    notes: (previous: string | null) => string;
  },
): Promise<SaveResult> {
  const { data: item, error } = await db
    .from('content_items')
    .select('status, current_version_id')
    .eq('organization_id', input.orgId)
    .eq('id', input.itemId)
    .maybeSingle();
  if (error || !item) return { status: 'error', message: 'Content not found.' };
  if (!isEditableStatus(item.status)) {
    return {
      status: 'error',
      message: 'Suggestions can only be saved on ideas, drafts and content with changes requested.',
    };
  }
  const { data: current } = await db
    .from('content_versions')
    .select('submitted_at')
    .eq('id', item.current_version_id!)
    .maybeSingle();
  if (current?.submitted_at) {
    return { status: 'error', message: 'This version is submitted for review and can’t change.' };
  }

  const { data: versionId, error: versionError } = await db.rpc('create_content_version', {
    item_id: input.itemId,
  });
  if (versionError || !versionId) {
    return {
      status: 'error',
      message:
        versionError?.code === '42501' ? versionError.message : 'Could not start a new version.',
    };
  }
  const { data: version, error: copyError } = await db
    .from('content_versions')
    .select('notes, version_number')
    .eq('id', versionId)
    .single();
  if (copyError) return { status: 'error', message: 'Could not read the new version.' };
  const { error: updateError } = await db
    .from('content_versions')
    .update({
      caption: input.caption.slice(0, 5000),
      hashtags: input.hashtags.slice(0, 60),
      notes: input.notes(version.notes),
    })
    .eq('id', versionId);
  if (updateError) {
    return {
      status: 'error',
      message: `Version ${version.version_number} was started, but the caption couldn’t be saved in it.`,
    };
  }
  return { status: 'ok', versionId, versionNumber: version.version_number };
}
