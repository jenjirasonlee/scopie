import 'server-only';
import { DATA_SOURCE_LABELS } from '@/lib/accounts/labels';
import { comparisonSource } from '@/lib/analytics/compare';
import { createAdminClient } from '@/lib/db/admin';
import type { Json } from '@/lib/db/types';
import type { ServerClient } from '@/lib/db/server';
import { serverEnv } from '@/lib/server-env';
import { openAiProvider } from '../providers/openai';
import type { LlmProvider, ProviderUsage } from '../providers/types';
import {
  answerReadyQuestion,
  answerWithModel,
  CHAT_PROMPT_VERSION,
  type ChatAnswer,
} from './agent';
import { checkModelLimit, DEFAULT_MAX_PER_HOUR, type LimitCheck } from './limits';
import { chatLoaders } from './load';
import { readDataUsed, type ChatMessageView, type ReadyQuestionId } from './shared';
import type { ToolContext } from './tools';

// The chat on the server: what the server can do, the per-person limit, asking, logging and
// keeping the conversation. Tools read as the signed-in user; the model audit is written
// with the service role (people can't write ai_generations).

export const DEFAULT_CHAT_MODEL = 'gpt-4.1-mini';
const json = (value: unknown) => value as NonNullable<Json>;

export type AiSetup = {
  /** Typed questions and copy suggestions can call a model. */
  modelReady: boolean;
  model: string | null;
  /** What the server is missing for that, in plain words (for managers). */
  missing: string[];
};

/** Whether a model can be asked. Ready questions never need any of this. */
export function aiSetup(): AiSetup {
  const env = serverEnv();
  const missing: string[] = [];
  if (!env.OPENAI_API_KEY) missing.push('OpenAI API key (OPENAI_API_KEY)');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('Supabase service role key');
  return {
    modelReady: !missing.length,
    model: missing.length ? null : (env.AI_MODEL_CHAT ?? DEFAULT_CHAT_MODEL),
    missing,
  };
}

/** The provider for people's model requests, or null when the server has no key. */
export function chatProvider(): LlmProvider | null {
  const key = serverEnv().OPENAI_API_KEY;
  return key ? openAiProvider(key) : null;
}

/** Counts this person's and the organization's recent model requests and applies the limits. */
export async function checkUserModelLimit(
  orgId: string,
  userId: string,
  now = new Date(),
): Promise<LimitCheck> {
  const admin = createAdminClient();
  const purposes = ['chat', 'assistant'];
  const [user, org] = await Promise.all([
    admin
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('purpose', purposes)
      .gte('created_at', new Date(now.getTime() - 3_600_000).toISOString()),
    admin
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('purpose', purposes)
      .gte('created_at', new Date(now.getTime() - 86_400_000).toISOString()),
  ]);
  if (user.error || org.error)
    return { ok: false, message: 'Could not check the AI limits. Try again.' };
  return checkModelLimit({
    userLastHour: user.count ?? 0,
    orgLastDay: org.count ?? 0,
    perHour: serverEnv().AI_MAX_CHAT_PER_HOUR ?? DEFAULT_MAX_PER_HOUR,
  });
}

/** Writes one model call to the audit. Returns its id, or null when it couldn't be saved. */
export async function logGeneration(input: {
  orgId: string;
  userId: string;
  purpose: 'chat' | 'assistant';
  provider: string;
  model: string;
  promptVersion: string;
  generation: {
    input: unknown;
    output: unknown;
    error: string | null;
    usage: ProviderUsage;
    durationMs: number;
  };
}): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('ai_generations')
    .insert({
      organization_id: input.orgId,
      user_id: input.userId,
      purpose: input.purpose,
      provider: input.provider,
      model: input.model,
      prompt_version: input.promptVersion,
      input: json(input.generation.input),
      output: json(input.generation.output ?? null),
      error: input.generation.error,
      input_tokens: input.generation.usage.inputTokens,
      output_tokens: input.generation.usage.outputTokens,
      duration_ms: input.generation.durationMs,
    })
    .select('id')
    .single();
  if (error) {
    console.error('could not log a model call', error.code);
    return null;
  }
  return data.id;
}

type OrgInfo = { id: string; isDemo: boolean; timeZone: string };

function toolContext(
  org: OrgInfo,
  db: ServerClient,
  now: Date,
): { ctx: ToolContext; sourceLabel: string } {
  const source = comparisonSource(org.isDemo);
  return {
    ctx: {
      now,
      source,
      loaders: chatLoaders({
        orgId: org.id,
        isDemoOrg: org.isDemo,
        timeZone: org.timeZone,
        now,
        db,
      }),
    },
    sourceLabel: DATA_SOURCE_LABELS[source],
  };
}

async function store(
  db: ServerClient,
  org: OrgInfo,
  userId: string,
  question: string,
  answer: ChatAnswer,
): Promise<boolean> {
  const { error: questionError } = await db
    .from('ai_chat_messages')
    .insert({ organization_id: org.id, user_id: userId, role: 'user', content: question });
  if (questionError) return false;
  const { error } = await db.from('ai_chat_messages').insert({
    organization_id: org.id,
    user_id: userId,
    role: 'assistant',
    content: answer.text.slice(0, 8000),
    writer: answer.dataUsed.writer,
    model: answer.dataUsed.model,
    data_used: json(answer.dataUsed),
  });
  return !error;
}

export type AskResult = { status: 'ok' } | { status: 'error'; message: string };

/** A ready question: Scopie's tools and wording, no model. */
export async function askReadyQuestion(input: {
  org: OrgInfo;
  userId: string;
  db: ServerClient;
  id: ReadyQuestionId;
  label: string;
  now?: Date;
}): Promise<AskResult> {
  const { ctx, sourceLabel } = toolContext(input.org, input.db, input.now ?? new Date());
  let answer: ChatAnswer;
  try {
    answer = await answerReadyQuestion(input.id, ctx, sourceLabel);
  } catch (error) {
    console.error('chat ready question failed', error instanceof Error ? error.message : error);
    return {
      status: 'error',
      message: 'Scopie couldn’t read the data for this question. Try again.',
    };
  }
  const saved = await store(input.db, input.org, input.userId, input.label, answer);
  return saved
    ? { status: 'ok' }
    : { status: 'error', message: 'Could not save the answer. Try again.' };
}

/** A typed question, answered by the model with the tools. Callers check the setup first. */
export async function askTypedQuestion(input: {
  org: OrgInfo;
  userId: string;
  db: ServerClient;
  question: string;
  now?: Date;
}): Promise<AskResult> {
  const setup = aiSetup();
  const provider = chatProvider();
  if (!setup.modelReady || !setup.model || !provider) {
    return { status: 'error', message: 'Typed questions need an AI key on the server.' };
  }
  const limit = await checkUserModelLimit(input.org.id, input.userId);
  if (!limit.ok) return { status: 'error', message: limit.message };

  const { ctx, sourceLabel } = toolContext(input.org, input.db, input.now ?? new Date());
  const result = await answerWithModel({
    provider,
    model: setup.model,
    question: input.question,
    ctx,
    sourceLabel,
  }).catch((error: unknown) => {
    // Tool data that couldn't be read (not the model): nothing to log.
    console.error('chat question failed', error instanceof Error ? error.message : error);
    return null;
  });
  if (!result)
    return {
      status: 'error',
      message: 'Scopie couldn’t read the data for this question. Try again.',
    };

  await logGeneration({
    orgId: input.org.id,
    userId: input.userId,
    purpose: 'chat',
    provider: provider.id,
    model: setup.model,
    promptVersion: CHAT_PROMPT_VERSION,
    generation: result.generation,
  });
  if (result.status === 'error') return { status: 'error', message: result.message };
  const saved = await store(
    input.db,
    input.org,
    input.userId,
    input.question.trim(),
    result.answer,
  );
  return saved
    ? { status: 'ok' }
    : { status: 'error', message: 'Could not save the answer. Try again.' };
}

/** The signed-in person's conversation in this organization, oldest first. */
export async function listChatMessages(
  db: ServerClient,
  orgId: string,
  userId: string,
  limit = 60,
): Promise<ChatMessageView[]> {
  const { data, error } = await db
    .from('ai_chat_messages')
    .select('id, role, content, created_at, data_used')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data
    .map((row) => ({
      id: row.id,
      role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: row.content,
      createdAt: row.created_at,
      dataUsed: row.role === 'assistant' ? readDataUsed(row.data_used) : null,
    }))
    .reverse();
}
