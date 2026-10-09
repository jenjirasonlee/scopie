import { describe, expect, it } from 'vitest';
import {
  assetStoragePath,
  checkAssetFile,
  formatBytes,
  imageSize,
  safeFileName,
  sniffAssetType,
} from '@/lib/content/files';
import { isEditableStatus, parseContentFilters } from '@/lib/content/shared';
import { contentItemSchema, parseHashtags } from '@/schemas/content';

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );

const PNG = bytes(
  0x89,
  'PNG',
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
  'IHDR',
  0,
  0,
  4,
  56,
  0,
  0,
  2,
  128,
);

describe('content files', () => {
  it('reads the type from the first bytes, not the name', () => {
    expect(sniffAssetType(PNG)).toBe('image/png');
    expect(sniffAssetType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffAssetType(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffAssetType(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp');
    expect(sniffAssetType(bytes('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffAssetType(bytes(0, 0, 0, 24, 'ftypisom'))).toBe('video/mp4');
    expect(sniffAssetType(bytes(0, 0, 0, 20, 'ftypqt  '))).toBe('video/quicktime');
  });

  it('refuses SVG, HTML and anything unknown', () => {
    expect(sniffAssetType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffAssetType(bytes('<!doctype html><script>'))).toBeNull();
    expect(checkAssetFile({ name: 'logo.png', size: 40 }, bytes('<svg>'))).toMatchObject({
      ok: false,
    });
  });

  it('limits sizes per type and refuses empty files', () => {
    expect(checkAssetFile({ name: 'a.png', size: 21 * 1024 * 1024 }, PNG)).toMatchObject({
      ok: false,
      message: expect.stringContaining('20 MB'),
    });
    expect(
      checkAssetFile({ name: 'clip.mp4', size: 45 * 1024 * 1024 }, bytes(0, 0, 0, 24, 'ftypisom')),
    ).toEqual({ ok: true, mimeType: 'video/mp4' });
    expect(checkAssetFile({ name: 'empty.png', size: 0 }, PNG)).toMatchObject({ ok: false });
  });

  it('keeps file names safe inside the item’s folder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('Autumn Reel (final) v2.mp4')).toBe('Autumn-Reel-final-v2.mp4');
    expect(safeFileName('<script>.png')).toBe('script.png');
    expect(safeFileName('...')).toBe('file');
    expect(assetStoragePath('org-1', 'item-1', 'r', 'my cover.png')).toBe(
      'org/org-1/content/item-1/r-my-cover.png',
    );
  });

  it('reads image sizes from PNG headers', () => {
    expect(imageSize(PNG)).toEqual({ width: 1080, height: 640 });
    expect(imageSize(bytes('%PDF-'))).toBeNull();
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('content form', () => {
  const base = { title: 'Autumn tips', status: 'IDEA', platformKeys: [] };

  it('turns hashtags into a clean list', () => {
    expect(parseHashtags('#Hydro, #hydro #grow-tips  coco')).toEqual(['hydro', 'growtips', 'coco']);
  });

  it('accepts a title alone and turns empty fields into nothing', () => {
    const parsed = contentItemSchema.parse({ ...base, countryCode: '', pillarId: '', caption: '' });
    expect(parsed).toMatchObject({
      countryCode: null,
      pillarId: null,
      caption: null,
      hashtags: [],
    });
  });

  it('only allows idea or draft, and a time needs a date', () => {
    expect(contentItemSchema.safeParse({ ...base, status: 'APPROVED' }).success).toBe(false);
    const timeOnly = contentItemSchema.safeParse({ ...base, plannedTime: '10:00' });
    expect(timeOnly.success).toBe(false);
    expect(timeOnly.error?.issues[0]?.path).toEqual(['plannedDate']);
    expect(contentItemSchema.safeParse({ ...base, title: '  ' }).success).toBe(false);
  });

  it('reads list filters safely', () => {
    expect(
      parseContentFilters({ status: 'DRAFT', country: 'nl', pillar: 'not-a-uuid', owner: [] }),
    ).toMatchObject({ status: 'DRAFT', country: 'NL', pillar: undefined, archived: false });
    expect(parseContentFilters({ status: 'ARCHIVED' }).archived).toBe(true);
    expect(parseContentFilters({ status: 'NOPE' }).status).toBeUndefined();
    expect(isEditableStatus('DRAFT')).toBe(true);
    expect(isEditableStatus('APPROVED')).toBe(false);
  });
});
