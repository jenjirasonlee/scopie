/**
 * Rules for content asset files. Pure, so the upload route and tests share them.
 * The file type is read from the file's first bytes, never trusted from the browser,
 * and only types that can't carry scripts are accepted (no SVG or HTML).
 */

export const ASSET_TYPES = {
  'image/jpeg': { label: 'JPEG image', maxBytes: 20 * 1024 * 1024, kind: 'image' },
  'image/png': { label: 'PNG image', maxBytes: 20 * 1024 * 1024, kind: 'image' },
  'image/webp': { label: 'WebP image', maxBytes: 20 * 1024 * 1024, kind: 'image' },
  'image/gif': { label: 'GIF image', maxBytes: 20 * 1024 * 1024, kind: 'image' },
  'video/mp4': { label: 'MP4 video', maxBytes: 50 * 1024 * 1024, kind: 'video' },
  'video/quicktime': { label: 'MOV video', maxBytes: 50 * 1024 * 1024, kind: 'video' },
  'application/pdf': { label: 'PDF', maxBytes: 20 * 1024 * 1024, kind: 'document' },
} as const;

export type AssetMimeType = keyof typeof ASSET_TYPES;
export type AssetKind = (typeof ASSET_TYPES)[AssetMimeType]['kind'];

/** The largest file any type allows; the upload route refuses bigger requests early. */
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
/** How many files one version can hold. */
export const MAX_ASSETS_PER_VERSION = 20;

export const ACCEPTED_FILE_TYPES = '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.pdf';
export const ACCEPTED_FILES_HINT =
  'JPEG, PNG, WebP, GIF, MP4, MOV or PDF. Up to 20 MB, videos 50 MB.';

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Detects the file type from its first bytes (at least 16), or null when it isn't allowed. */
export function sniffAssetType(head: Uint8Array): AssetMimeType | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(head, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

export type AssetCheck = { ok: true; mimeType: AssetMimeType } | { ok: false; message: string };

export function checkAssetFile(file: { name: string; size: number }, head: Uint8Array): AssetCheck {
  if (file.size === 0) return { ok: false, message: `${file.name} is empty.` };
  const mimeType = sniffAssetType(head);
  if (!mimeType) {
    return {
      ok: false,
      message: `${file.name} isn't a supported file. Use ${ACCEPTED_FILES_HINT}`,
    };
  }
  const { maxBytes, label } = ASSET_TYPES[mimeType];
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `${file.name} is too large. A ${label} can be up to ${maxBytes / 1024 / 1024} MB.`,
    };
  }
  return { ok: true, mimeType };
}

/** A file name that is safe in a storage path and a download header. Keeps the extension. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-120);
  return cleaned || 'file';
}

/** Where an asset lives in the store. The database checks the org and item prefix. */
export function assetStoragePath(orgId: string, itemId: string, randomId: string, name: string) {
  return `org/${orgId}/content/${itemId}/${randomId}-${safeFileName(name)}`;
}

export function assetKind(mimeType: string): AssetKind | null {
  return mimeType in ASSET_TYPES ? ASSET_TYPES[mimeType as AssetMimeType].kind : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Width and height from a PNG, GIF or JPEG header, when it is easy to read. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = sniffAssetType(bytes);
  if (type === 'image/png' && bytes.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === 'image/gif' && bytes.length >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}
