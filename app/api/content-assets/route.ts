import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import {
  assetStoragePath,
  checkAssetFile,
  imageSize,
  MAX_ASSET_BYTES,
  MAX_ASSETS_PER_VERSION,
} from '@/lib/content/files';
import { isEditableStatus } from '@/lib/content/shared';
import { assetStore } from '@/lib/content/store';
import { createClient } from '@/lib/db/server';

/**
 * Uploads files to a content item's current version. A plain form post (works without
 * JavaScript): it redirects back to the item with the outcome in the URL.
 * Permission is checked before anything is stored; a file whose row can't be saved is
 * removed again.
 */
export async function POST(request: NextRequest) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_ASSET_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: 'Upload one file of up to 50 MB at a time.' },
      { status: 413 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Send the files as a form.' }, { status: 400 });
  }
  const itemId = z.uuid().safeParse(form.get('itemId'));
  if (!itemId.success) return NextResponse.json({ error: 'Content not found.' }, { status: 404 });

  const { data: item } = await supabase
    .from('content_items')
    .select('id, organization_id, current_version_id, status, organizations(slug)')
    .eq('id', itemId.data)
    .maybeSingle();
  if (!item || !item.current_version_id || !item.organizations) {
    return NextResponse.json({ error: 'Content not found.' }, { status: 404 });
  }
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(
        `/${item.organizations!.slug}/content/${item.id}?${new URLSearchParams(params)}#files`,
        request.url,
      ),
      303,
    );

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', item.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!can(membership?.role, 'content.edit')) {
    return back({ uploadError: 'Only editors, managers, admins and owners can add files.' });
  }
  if (!isEditableStatus(item.status)) {
    return back({ uploadError: 'Files can only be added to ideas and drafts.' });
  }
  const store = assetStore();
  if (!store) {
    return back({ uploadError: 'File uploads aren’t set up on this server yet.' });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return back({ uploadError: 'Choose a file to upload.' });

  const { count } = await supabase
    .from('content_assets')
    .select('id', { count: 'exact', head: true })
    .eq('content_version_id', item.current_version_id);
  if ((count ?? 0) + files.length > MAX_ASSETS_PER_VERSION) {
    return back({ uploadError: `A version can hold up to ${MAX_ASSETS_PER_VERSION} files.` });
  }

  let added = 0;
  for (const [index, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkAssetFile(file, bytes.subarray(0, 64));
    if (!check.ok) return back({ uploadError: check.message, uploaded: String(added) });

    const storagePath = assetStoragePath(item.organization_id, item.id, randomUUID(), file.name);
    try {
      await store.put(storagePath, bytes, check.mimeType);
    } catch {
      return back({
        uploadError: `Could not store ${file.name}. Please try again.`,
        uploaded: String(added),
      });
    }
    const size = check.mimeType.startsWith('image/')
      ? imageSize(bytes.subarray(0, 256 * 1024))
      : null;
    const { error } = await supabase.from('content_assets').insert({
      organization_id: item.organization_id,
      content_item_id: item.id,
      content_version_id: item.current_version_id,
      storage_path: storagePath,
      file_name: file.name.slice(0, 200) || 'file',
      mime_type: check.mimeType,
      bytes: file.size,
      width: size?.width ?? null,
      height: size?.height ?? null,
      position: (count ?? 0) + index,
    });
    if (error) {
      await store.remove([storagePath]).catch(() => undefined);
      return back({ uploadError: `Could not save ${file.name}.`, uploaded: String(added) });
    }
    added += 1;
  }
  return back({ uploaded: String(added) });
}
