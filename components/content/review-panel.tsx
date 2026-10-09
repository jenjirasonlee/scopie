'use client';

import { Archive, CopyPlus, Send, Undo2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  markPublished,
  reviewContent,
  setScheduled,
  submitForReview,
  withdrawFromReview,
} from '@/lib/approvals/actions';
import { DECISION_LABELS, type ReviewDecision } from '@/lib/approvals/shared';
import { setContentArchived, startNewVersion } from '@/lib/content/actions';
import type { ReviewOptions } from '@/lib/content/review';
import {
  CONTENT_STATUS_HELP,
  CONTENT_STATUS_LABELS,
  CONTENT_STATUS_VARIANT,
  type ContentStatus,
} from '@/lib/content/shared';
import { initialFormState, type FormState } from '@/lib/forms';

const DECISION_VARIANT: Record<ReviewDecision, 'success' | 'warning' | 'destructive'> = {
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
  REJECTED: 'destructive',
};

/**
 * The message of whichever action finished last. Each action keeps its own state, so the
 * forms work without JavaScript; this picks the one that just changed.
 */
function useLatest(states: FormState[]) {
  const [seen, setSeen] = useState(states);
  const [latest, setLatest] = useState<FormState>(initialFormState);
  const changed = states.find((state, i) => state !== seen[i]);
  if (changed) {
    setSeen(states);
    setLatest(changed);
  }
  return changed ?? latest;
}

export type LatestDecision = {
  decision: ReviewDecision;
  comment: string | null;
  reviewerName: string | null;
  versionNumber: number | null;
  /** Already formatted in the organization's time zone. */
  when: string;
};

/** The item's stage, the last decision, and what this person can do next. */
export function ReviewPanel({
  orgSlug,
  itemId,
  status,
  options,
  versionNumber,
  submittedLabel,
  hasPlannedDate,
  latestDecision,
}: {
  orgSlug: string;
  itemId: string;
  status: ContentStatus;
  options: ReviewOptions;
  /** The current version's number. */
  versionNumber: number;
  /** "Sam, 8 Oct 2026, 14:05" when the current version is in review. */
  submittedLabel: string | null;
  hasPlannedDate: boolean;
  latestDecision: LatestDecision | null;
}) {
  const [submitState, submitAction] = useActionState(
    submitForReview.bind(null, orgSlug),
    initialFormState,
  );
  const [withdrawState, withdrawAction] = useActionState(
    withdrawFromReview.bind(null, orgSlug),
    initialFormState,
  );
  const [reviewState, reviewAction] = useActionState(
    reviewContent.bind(null, orgSlug),
    initialFormState,
  );
  const [scheduleState, scheduleAction] = useActionState(
    setScheduled.bind(null, orgSlug),
    initialFormState,
  );
  const [publishState, publishAction] = useActionState(
    markPublished.bind(null, orgSlug),
    initialFormState,
  );
  const message = useLatest([submitState, withdrawState, reviewState, scheduleState, publishState]);
  const itemField = <input type="hidden" name="itemId" value={itemId} />;
  const next = versionNumber + 1;

  return (
    <Card id="review">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Review</CardTitle>
          <Badge variant={CONTENT_STATUS_VARIANT[status]}>{CONTENT_STATUS_LABELS[status]}</Badge>
        </div>
        <CardDescription>{CONTENT_STATUS_HELP[status]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormMessage state={message} />

        {status === 'IN_REVIEW' && submittedLabel ? (
          <p className="text-[13px]">
            Version {versionNumber} was submitted by {submittedLabel}.
          </p>
        ) : null}

        {latestDecision ? (
          <div className="bg-muted/40 space-y-1.5 rounded-md border px-3 py-2.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <span className="text-muted-foreground">Last decision</span>
              <Badge variant={DECISION_VARIANT[latestDecision.decision]}>
                {DECISION_LABELS[latestDecision.decision]}
              </Badge>
              <span>
                {latestDecision.reviewerName ?? 'A former member'}
                {latestDecision.versionNumber ? `, on version ${latestDecision.versionNumber}` : ''}
                <span className="text-muted-foreground">, {latestDecision.when}</span>
              </span>
            </p>
            {latestDecision.comment ? (
              <p className="text-[13px] break-words whitespace-pre-line">
                {latestDecision.comment}
              </p>
            ) : null}
          </div>
        ) : null}

        {options.submit ? (
          <form action={submitAction} className="space-y-3">
            {itemField}
            <FormField
              id="review-note"
              label="Note for the reviewer"
              optional
              hint="What to look at, or what changed since last time."
            >
              <Textarea name="note" rows={2} maxLength={1000} />
            </FormField>
            <SubmitButton pendingLabel="Submitting…">
              <Send aria-hidden />
              Submit version {versionNumber} for review
            </SubmitButton>
            <p className="text-muted-foreground text-xs">
              The version is locked once submitted. Reviewers get a notification.
            </p>
          </form>
        ) : null}

        {options.needsNewVersion ? (
          <div className="space-y-3">
            <p className="text-[13px]">
              Version {versionNumber} was reviewed and is kept as it was. Start version {next}, make
              the changes, then submit it again.
            </p>
            <form action={startNewVersion.bind(null, orgSlug)}>
              {itemField}
              <SubmitButton pendingLabel="Starting…">
                <CopyPlus aria-hidden />
                Start version {next}
              </SubmitButton>
            </form>
          </div>
        ) : null}

        {options.decide ? (
          <form action={reviewAction} className="space-y-3">
            {itemField}
            <FormField
              id="review-comment"
              label="Comment for the author"
              hint="Needed when you ask for changes or reject."
              errors={reviewState.fieldErrors?.comment}
            >
              <Textarea
                name="comment"
                rows={3}
                maxLength={5000}
                defaultValue={reviewState.values?.comment ?? ''}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="decision" value="APPROVED">
                Approve
              </SubmitButton>
              <SubmitButton name="decision" value="CHANGES_REQUESTED" variant="outline">
                Request changes
              </SubmitButton>
              <SubmitButton name="decision" value="REJECTED" variant="outline">
                Reject
              </SubmitButton>
            </div>
          </form>
        ) : null}

        {options.ownSubmission ? (
          <p className="text-[13px]">
            You submitted this version, so another manager, an admin or an owner has to review it.
          </p>
        ) : null}

        {status === 'IN_REVIEW' && !options.decide && !options.ownSubmission && options.withdraw ? (
          <p className="text-[13px]">Waiting for a manager, admin or owner to review it.</p>
        ) : null}

        {options.withdraw ? (
          <form action={withdrawAction} className="space-y-2">
            {itemField}
            <SubmitButton variant="outline" size="sm" pendingLabel="Withdrawing…">
              <Undo2 aria-hidden />
              Withdraw from review
            </SubmitButton>
            <p className="text-muted-foreground text-xs">
              Takes it back to draft so you can keep editing.
            </p>
          </form>
        ) : null}

        {options.schedule || options.unschedule || options.publish ? (
          <div className="flex flex-wrap items-start gap-2">
            {options.schedule ? (
              <form action={scheduleAction}>
                {itemField}
                <input type="hidden" name="scheduled" value="true" />
                <SubmitButton disabled={!hasPlannedDate} pendingLabel="Saving…">
                  Mark as scheduled
                </SubmitButton>
              </form>
            ) : null}
            {options.publish ? (
              <form action={publishAction}>
                {itemField}
                <SubmitButton
                  variant={status === 'SCHEDULED' ? 'default' : 'outline'}
                  pendingLabel="Saving…"
                >
                  Mark as published
                </SubmitButton>
              </form>
            ) : null}
            {options.unschedule ? (
              <form action={scheduleAction}>
                {itemField}
                <input type="hidden" name="scheduled" value="false" />
                <SubmitButton variant="ghost" pendingLabel="Saving…">
                  Back to approved
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
        {options.schedule ? (
          <p className="text-muted-foreground text-xs">
            {hasPlannedDate
              ? 'Mark it as scheduled once it’s queued in your publishing tool.'
              : 'Add a publish date below before you mark it as scheduled.'}
          </p>
        ) : null}
        {options.publish ? (
          <p className="text-muted-foreground text-xs">
            Mark it as published once it’s live. This can’t be undone.
          </p>
        ) : null}

        {options.newVersion ? (
          status === 'REJECTED' ? (
            <div className="space-y-3">
              <p className="text-[13px]">
                To rework it, start version {next}. It goes back to draft and needs a new review. Or
                archive it if it’s not going ahead.
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={startNewVersion.bind(null, orgSlug)}>
                  {itemField}
                  <SubmitButton variant="outline" pendingLabel="Starting…">
                    <CopyPlus aria-hidden />
                    Start version {next}
                  </SubmitButton>
                </form>
                {options.archive ? (
                  <form action={setContentArchived.bind(null, orgSlug)}>
                    {itemField}
                    <input type="hidden" name="status" value="ARCHIVED" />
                    <SubmitButton variant="ghost">
                      <Archive aria-hidden />
                      Archive
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            </div>
          ) : (
            <details className="group rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-medium">
                Need to change something?
              </summary>
              <div className="space-y-3 pt-2">
                <p className="text-[13px]">
                  Changes go into a new version. Starting version {next} means the approval no
                  longer applies: it goes back to draft and needs to be reviewed again.
                </p>
                <form action={startNewVersion.bind(null, orgSlug)}>
                  {itemField}
                  <SubmitButton variant="outline" size="sm" pendingLabel="Starting…">
                    <CopyPlus aria-hidden />
                    Start version {next}
                  </SubmitButton>
                </form>
              </div>
            </details>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
