'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import type { FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { MAX_QUESTION_CHARS } from './agent';
import { aiSetup, askReadyQuestion, askTypedQuestion } from './run';
import { isReadyQuestionId, READY_QUESTIONS } from './shared';

// Every member may chat, viewers too: the tools only read, as the signed-in person.

const chatPath = (orgSlug: string) => `/${orgSlug}/insights/chat`;

export async function askReadyQuestionAction(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, user } = await getOrgContext(orgSlug);
  const id = formData.get('question');
  if (!isReadyQuestionId(id)) return { status: 'error', message: 'Pick one of the questions.' };
  const label = READY_QUESTIONS.find((q) => q.id === id)!.label;
  const result = await askReadyQuestion({
    org: { id: org.id, isDemo: org.is_demo, timeZone: org.default_timezone },
    userId: user.id,
    db: await createClient(),
    id,
    label,
  });
  if (result.status === 'error') return result;
  revalidatePath(chatPath(orgSlug));
  return { status: 'success' };
}

export async function askTypedQuestionAction(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, user } = await getOrgContext(orgSlug);
  const raw = formData.get('question');
  const question = typeof raw === 'string' ? raw.trim() : '';
  if (!question) return { status: 'error', message: 'Type a question first.' };
  if (question.length > MAX_QUESTION_CHARS) {
    return {
      status: 'error',
      message: `Keep the question under ${MAX_QUESTION_CHARS} characters.`,
      values: { question },
    };
  }
  if (!aiSetup().modelReady) {
    return {
      status: 'error',
      message:
        'Typed questions need an AI key on the server. The ready questions above still work.',
      values: { question },
    };
  }
  const result = await askTypedQuestion({
    org: { id: org.id, isDemo: org.is_demo, timeZone: org.default_timezone },
    userId: user.id,
    db: await createClient(),
    question,
  });
  if (result.status === 'error') return { ...result, values: { question } };
  revalidatePath(chatPath(orgSlug));
  return { status: 'success' };
}

/** Deletes the signed-in person's own conversation in this organization. */
export async function clearChatAction(orgSlug: string): Promise<FormState> {
  const { org, user } = await getOrgContext(orgSlug);
  const supabase = await createClient();
  const { error } = await supabase
    .from('ai_chat_messages')
    .delete()
    .eq('organization_id', org.id)
    .eq('user_id', user.id);
  if (error) return { status: 'error', message: 'Could not clear the conversation.' };
  revalidatePath(chatPath(orgSlug));
  return { status: 'success', message: 'Conversation cleared.' };
}
