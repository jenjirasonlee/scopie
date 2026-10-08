import { z } from 'zod';

/**
 * Server-only configuration for the data pipeline. Never import this from a client
 * component; none of these values may reach the browser.
 * Every variable is optional so the app runs without them: features that need one
 * say so on screen instead of failing.
 */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  /** 32 random bytes, base64. Encrypts platform tokens at rest (lib/crypto/tokens.ts). */
  SCOPIE_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes, base64')
    .optional(),
  META_APP_ID: z.string().regex(/^\d+$/, 'must be the numeric Meta App ID').optional(),
  META_APP_SECRET: z.string().min(16).optional(),
  /** YouTube Data API v3 key for public channels (Google Cloud Console → Credentials). */
  YOUTUBE_API_KEY: z.string().min(20).optional(),
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .optional(),
  /** Where content files go: a private Supabase Storage bucket, or a local folder (dev, tests). */
  ASSET_STORAGE: z.enum(['supabase', 'local']).optional(),
  /** Folder for ASSET_STORAGE=local. Defaults to .scopie-assets in the app folder. */
  ASSET_LOCAL_DIR: z.string().min(1).optional(),
  /** Optional. With it, a model words the insights; without it, Scopie's own rules do. */
  OPENAI_API_KEY: z.string().min(20).optional(),
  /** The OpenAI model that words insights. */
  AI_MODEL_INSIGHTS: z.string().min(1).max(100).optional(),
  /** Analyses per organization per day that may call the model (default 20). */
  AI_MAX_RUNS_PER_DAY: z.coerce.number().int().min(0).max(1000).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const blankToUndefined = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  const result = serverEnvSchema.safeParse(blankToUndefined);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')} (${issue.message})`)
      .join(', ');
    throw new Error(`Invalid server environment variables: ${problems}. See .env.example.`);
  }
  return result.data;
}

export function serverEnv(): ServerEnv {
  return parseServerEnv({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SCOPIE_ENCRYPTION_KEY: process.env.SCOPIE_ENCRYPTION_KEY,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    ASSET_STORAGE: process.env.ASSET_STORAGE,
    ASSET_LOCAL_DIR: process.env.ASSET_LOCAL_DIR,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_MODEL_INSIGHTS: process.env.AI_MODEL_INSIGHTS,
    AI_MAX_RUNS_PER_DAY: process.env.AI_MAX_RUNS_PER_DAY,
  });
}

export type MetaConfig = { appId: string; appSecret: string; version?: string };

/** Meta connector settings, or null when the Meta app isn't configured yet. */
export function metaConfig(env: ServerEnv = serverEnv()): MetaConfig | null {
  if (!env.META_APP_ID || !env.META_APP_SECRET) return null;
  return {
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    version: env.META_GRAPH_API_VERSION,
  };
}

/** What the data pipeline still needs before it can talk to Meta, in plain words. */
export function pipelineSetupGaps(env: ServerEnv = serverEnv()): string[] {
  const gaps: string[] = [];
  if (!env.META_APP_ID || !env.META_APP_SECRET) gaps.push('Meta app ID and secret');
  if (!env.SCOPIE_ENCRYPTION_KEY) gaps.push('token encryption key');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) gaps.push('Supabase service role key');
  return gaps;
}
