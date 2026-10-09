import { CheckCircle2, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { deleteComment, setCommentResolved } from '@/lib/approvals/actions';
import type { ContentComment } from '@/lib/approvals/queries';
import { formatDateTime, threadComments } from '@/lib/content/review';
import { cn } from '@/lib/utils';
import { CommentForm } from './comment-form';

type Member = { value: string; label: string };

/** Comments on the item with one level of replies. Editors write, reply and resolve. */
export function ContentComments({
  orgSlug,
  itemId,
  comments,
  canComment,
  currentUserId,
  members,
  timeZone,
}: {
  orgSlug: string;
  itemId: string;
  comments: ContentComment[];
  canComment: boolean;
  currentUserId: string | null;
  members: Member[];
  timeZone: string;
}) {
  const threads = threadComments(comments);
  const open = threads.filter((t) => !t.comment.resolvedAt).length;
  const mentionable = members.filter((m) => m.value !== currentUserId);
  const resolve = setCommentResolved.bind(null, orgSlug);
  const remove = deleteComment.bind(null, orgSlug);

  const body = (comment: ContentComment, isReply: boolean) => (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className="font-medium">{comment.authorName ?? 'A former member'}</span>
        <span className="text-muted-foreground text-xs">
          {formatDateTime(comment.createdAt, timeZone)}
          {comment.versionNumber ? ` · version ${comment.versionNumber}` : ''}
          {comment.editedAt ? ' · edited' : ''}
        </span>
      </p>
      <p className="text-[13px] break-words whitespace-pre-line">{comment.body}</p>
      {comment.mentions.length ? (
        <p className="flex flex-wrap gap-1">
          {comment.mentions.map((mention) => (
            <Badge key={mention.id} variant="secondary">
              @{mention.name}
            </Badge>
          ))}
        </p>
      ) : null}
      {canComment ? (
        <div className="flex flex-wrap gap-1">
          {!isReply ? (
            <form action={resolve}>
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="commentId" value={comment.id} />
              <input type="hidden" name="resolved" value={comment.resolvedAt ? 'false' : 'true'} />
              <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                {comment.resolvedAt ? <RotateCcw aria-hidden /> : <CheckCircle2 aria-hidden />}
                {comment.resolvedAt ? 'Reopen' : 'Resolve'}
              </Button>
            </form>
          ) : null}
          {comment.authorId && comment.authorId === currentUserId ? (
            <form action={remove}>
              <input type="hidden" name="itemId" value={itemId} />
              <input type="hidden" name="commentId" value={comment.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 px-2 text-xs"
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <Card id="comments">
      <CardHeader>
        <CardTitle>Comments</CardTitle>
        <CardDescription>
          {threads.length
            ? `${open} open${threads.length > open ? `, ${threads.length - open} resolved` : ''}.`
            : 'Questions and feedback on this content. Mention people to notify them.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {threads.length ? (
          <ul className="space-y-4">
            {threads.map(({ comment, replies }) => {
              const thread = (
                <>
                  {body(comment, false)}
                  {replies.length ? (
                    <ul className="mt-3 space-y-3 border-l-2 pl-4">
                      {replies.map((reply) => (
                        <li key={reply.id}>{body(reply, true)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {canComment && !comment.resolvedAt ? (
                    <details className="mt-2 pl-4">
                      <summary className="text-muted-foreground cursor-pointer text-xs select-none">
                        Reply
                      </summary>
                      <div className="pt-2">
                        <CommentForm
                          orgSlug={orgSlug}
                          itemId={itemId}
                          parentId={comment.id}
                          members={mentionable}
                        />
                      </div>
                    </details>
                  ) : null}
                </>
              );
              return (
                <li
                  key={comment.id}
                  className={cn('rounded-md border px-4 py-3', comment.resolvedAt && 'bg-muted/30')}
                >
                  {comment.resolvedAt ? (
                    <details>
                      <summary className="text-muted-foreground cursor-pointer text-[13px] select-none">
                        Resolved
                        {comment.resolvedByName ? ` by ${comment.resolvedByName}` : ''}:{' '}
                        <span className="italic">{excerpt(comment.body)}</span>
                      </summary>
                      <div className="pt-3">{thread}</div>
                    </details>
                  ) : (
                    thread
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {canComment ? (
          <CommentForm orgSlug={orgSlug} itemId={itemId} members={mentionable} />
        ) : !threads.length ? (
          <p className="text-muted-foreground text-[13px]">No comments yet.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function excerpt(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 80).trimEnd()}…` : line;
}
