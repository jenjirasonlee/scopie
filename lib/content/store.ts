import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAdminClient } from '@/lib/db/admin';
import { serverEnv } from '@/lib/server-env';
import { MAX_ASSET_BYTES } from './files';

/**
 * Where content asset files are kept. Files are private: the browser never gets a
 * storage URL, only /api/content-assets/{id}, which checks membership first.
 *
 * - `supabase`: a private Supabase Storage bucket, used through the service role.
 * - `local`: a folder on the server's disk, for development and tests.
 */
export interface AssetStore {
  readonly kind: 'supabase' | 'local';
  put(storagePath: string, body: Uint8Array, mimeType: string): Promise<void>;
  get(storagePath: string): Promise<Uint8Array>;
  remove(storagePaths: string[]): Promise<void>;
}

export const ASSET_BUCKET = 'content-assets';

class SupabaseAssetStore implements AssetStore {
  readonly kind = 'supabase';
  private bucketReady = false;

  private get storage() {
    return createAdminClient().storage;
  }

  private async ensureBucket() {
    if (this.bucketReady) return;
    const { error } = await this.storage.createBucket(ASSET_BUCKET, {
      public: false,
      fileSizeLimit: MAX_ASSET_BYTES,
    });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
    this.bucketReady = true;
  }

  async put(storagePath: string, body: Uint8Array, mimeType: string) {
    await this.ensureBucket();
    const { error } = await this.storage
      .from(ASSET_BUCKET)
      .upload(storagePath, body, { contentType: mimeType, upsert: false });
    if (error) throw error;
  }

  async get(storagePath: string) {
    const { data, error } = await this.storage.from(ASSET_BUCKET).download(storagePath);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(storagePaths: string[]) {
    if (!storagePaths.length) return;
    const { error } = await this.storage.from(ASSET_BUCKET).remove(storagePaths);
    if (error) throw error;
  }
}

class LocalAssetStore implements AssetStore {
  readonly kind = 'local';

  constructor(private readonly root: string) {}

  private resolve(storagePath: string) {
    const full = path.resolve(this.root, storagePath);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error('Asset path escapes the asset folder');
    }
    return full;
  }

  async put(storagePath: string, body: Uint8Array) {
    const full = this.resolve(storagePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { flag: 'wx' });
  }

  async get(storagePath: string) {
    return new Uint8Array(await readFile(this.resolve(storagePath)));
  }

  async remove(storagePaths: string[]) {
    await Promise.all(storagePaths.map((p) => rm(this.resolve(p), { force: true })));
  }
}

/** The configured store, or null when uploads aren't set up on this server. */
export function assetStore(): AssetStore | null {
  const env = serverEnv();
  const kind = env.ASSET_STORAGE ?? (env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : undefined);
  if (kind === 'local') return new LocalAssetStore(env.ASSET_LOCAL_DIR ?? '.scopie-assets');
  if (kind === 'supabase' && env.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseAssetStore();
  return null;
}
