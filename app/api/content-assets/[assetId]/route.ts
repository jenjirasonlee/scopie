import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { assetStore } from '@/lib/content/store';
import { createClient } from '@/lib/db/server';

/**
 * Serves one content file to a member of its organization. Row Level Security decides
 * whether the asset row is visible; only then is the file read from the private store.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  if (!z.uuid().safeParse(assetId).success) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data: asset } = await supabase
    .from('content_assets')
    .select('storage_path, mime_type, file_name')
    .eq('id', assetId)
    .maybeSingle();
  const store = assetStore();
  if (!asset || !store) return new NextResponse(null, { status: 404 });

  let body: Uint8Array;
  try {
    body = await store.get(asset.storage_path);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  const download = request.nextUrl.searchParams.get('download') === '1';
  const name = encodeURIComponent(asset.file_name);
  return new NextResponse(Buffer.from(body), {
    headers: {
      'Content-Type': asset.mime_type,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
