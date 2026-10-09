import { ArrowLeft, Info, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AskForm, ClearChatForm, ReadyQuestionsForm } from '@/components/insights/chat-forms';
import { ChatThread } from '@/components/insights/chat-thread';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  askReadyQuestionAction,
  askTypedQuestionAction,
  clearChatAction,
} from '@/lib/ai/chat/actions';
import { MAX_QUESTION_CHARS } from '@/lib/ai/chat/agent';
import { aiSetup, listChatMessages } from '@/lib/ai/chat/run';
import { READY_QUESTIONS } from '@/lib/ai/chat/shared';
import { can } from '@/lib/auth/permissions';
import { formatDateTime } from '@/lib/content/review';
import { createClient } from '@/lib/db/server';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Ask Scopie' };

export default async function InsightsChatPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role, user } = await getOrgContext(orgSlug);
  const messages = await listChatMessages(await createClient(), org.id, user.id);
  const setup = aiSetup();
  // Only people who set up the organization's AI see what the server is missing.
  const isManager = can(role, 'strategy.manage');
  const when = (iso: string) => formatDateTime(iso, org.default_timezone);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ask Scopie"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {org.is_demo ? <Badge variant="demo">Demo</Badge> : null}
            <span>
              Questions about your stored data, answered from Scopie’s analytics. Every answer shows
              the data it used. Your conversation is private to you.
            </span>
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/${orgSlug}/insights`}>
              <ArrowLeft aria-hidden />
              AI Insights
            </Link>
          </Button>
        }
      />

      {org.is_demo ? (
        <p className="text-muted-foreground flex items-start gap-1.5 text-[13px]">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This organization holds DEMO DATA. Every answer here is about made-up numbers.
        </p>
      ) : null}

      <Card>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Ready questions</h2>
            <p className="text-muted-foreground text-xs">
              Answered by Scopie’s own rules from your numbers. No AI model is involved.
            </p>
          </div>
          <ReadyQuestionsForm
            action={askReadyQuestionAction.bind(null, orgSlug)}
            questions={READY_QUESTIONS}
          />
        </CardContent>
      </Card>

      {messages.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Your conversation</h2>
            <ClearChatForm action={clearChatAction.bind(null, orgSlug)} />
          </div>
          <ChatThread messages={messages} when={when} />
          <p className="text-muted-foreground text-xs">Times in {org.default_timezone}.</p>
        </section>
      ) : (
        <div className="bg-card rounded-lg border border-dashed px-6 py-10 text-center">
          <div className="bg-muted text-muted-foreground mx-auto mb-3 flex size-10 items-center justify-center rounded-md">
            <MessagesSquare className="size-5" aria-hidden />
          </div>
          <p className="text-muted-foreground mx-auto max-w-md text-[13px]">
            No questions yet. Pick a ready question above
            {setup.modelReady ? ' or type your own below' : ''}.
          </p>
        </div>
      )}

      <Card>
        <CardContent>
          <AskForm
            action={askTypedQuestionAction.bind(null, orgSlug)}
            enabled={setup.modelReady}
            maxLength={MAX_QUESTION_CHARS}
            disabledReason={
              isManager ? (
                <>
                  Typed questions need an AI model on the server. Missing:{' '}
                  {setup.missing.join(', ')}. See .env.example.
                </>
              ) : (
                'Typed questions need an AI key on the server. Ask an owner, admin or manager to set one up.'
              )
            }
          />
          {setup.modelReady ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Answered by the AI model {setup.model} using Scopie’s read-only tools. Scopie checks
              every number in the answer against the data; if one doesn’t match, you see Scopie’s
              own summary instead.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
