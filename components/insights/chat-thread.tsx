import { Bot, Database, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  answerBlocks,
  answerWriterLabel,
  type AnswerPart,
  type ChatMessageView,
  type DataUsed,
} from '@/lib/ai/chat/shared';
import { cn } from '@/lib/utils';

function Parts({ parts }: { parts: AnswerPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'link' ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary font-medium hover:underline"
          >
            Open post
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function AnswerText({ text }: { text: string }) {
  const blocks = answerBlocks(text);
  const out: React.ReactNode[] = [];
  let items: React.ReactNode[] = [];
  const flush = () => {
    if (items.length) {
      out.push(
        <ul key={`list-${out.length}`} className="list-disc space-y-1 pl-5">
          {items}
        </ul>,
      );
      items = [];
    }
  };
  blocks.forEach((block, index) => {
    if (block.kind === 'item') {
      items.push(
        <li key={index}>
          <Parts parts={block.parts} />
        </li>,
      );
    } else {
      flush();
      out.push(
        <p key={index}>
          <Parts parts={block.parts} />
        </p>,
      );
    }
  });
  flush();
  return <div className="space-y-2">{out}</div>;
}

export function DataUsedPanel({ used }: { used: DataUsed }) {
  const profiles = Math.max(0, ...used.tools.map((t) => t.profiles ?? 0));
  const periods = [...new Set(used.tools.map((t) => t.period).filter(Boolean))];
  return (
    <details className="group mt-3 rounded-md border px-3 py-2 text-xs" open>
      <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1.5 font-medium select-none">
        <Database className="size-3.5" aria-hidden />
        Data used
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Tools</dt>
        <dd>
          {used.tools.length ? (
            <ul className="space-y-0.5">
              {used.tools.map((tool, index) => (
                <li key={index}>
                  {tool.label} <code className="text-muted-foreground">{tool.tool}</code>
                </li>
              ))}
            </ul>
          ) : (
            'None: no data was read for this answer.'
          )}
        </dd>
        {periods.length ? (
          <>
            <dt className="text-muted-foreground">Period</dt>
            <dd>{periods.join('; ')}</dd>
          </>
        ) : null}
        {used.tools.some((t) => t.profiles !== null) ? (
          <>
            <dt className="text-muted-foreground">Profiles</dt>
            <dd>{profiles}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Data source</dt>
        <dd>
          <Badge variant={used.source === 'DEMO' ? 'demo' : 'outline'}>{used.source}</Badge>
        </dd>
        <dt className="text-muted-foreground">Written by</dt>
        <dd>{answerWriterLabel(used)}</dd>
        {used.note ? (
          <>
            <dt className="text-muted-foreground">Note</dt>
            <dd>{used.note}</dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}

export function ChatThread({
  messages,
  when,
}: {
  messages: ChatMessageView[];
  when: (iso: string) => string;
}) {
  return (
    <ol className="space-y-4" aria-label="Conversation">
      {messages.map((message) => {
        const mine = message.role === 'user';
        return (
          <li key={message.id} className={cn('flex gap-3', mine && 'flex-row-reverse')}>
            <span
              className={cn(
                'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
              aria-hidden
            >
              {mine ? <User className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div
              className={cn(
                'min-w-0 rounded-lg border px-4 py-3 text-[13px]',
                mine ? 'bg-muted/60 max-w-xl' : 'bg-card max-w-3xl flex-1',
              )}
            >
              <p className="text-muted-foreground mb-1 text-xs">
                {mine ? 'You' : 'Scopie'} · {when(message.createdAt)}
              </p>
              {mine ? <p>{message.content}</p> : <AnswerText text={message.content} />}
              {message.dataUsed ? <DataUsedPanel used={message.dataUsed} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
