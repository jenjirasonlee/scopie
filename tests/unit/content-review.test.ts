import { describe, expect, it } from 'vitest';
import {
  canArchive,
  canEditPlan,
  formatDateTime,
  historyNote,
  historyTitle,
  reviewOptions,
  threadComments,
} from '@/lib/content/review';
import { contentPlanSchema } from '@/schemas/content';

const enabled = (options: ReturnType<typeof reviewOptions>) =>
  Object.entries(options)
    .filter(([, on]) => on)
    .map(([key]) => key)
    .sort();

describe('review options', () => {
  it('lets editors submit an unsubmitted idea, draft or reworked version', () => {
    for (const status of ['IDEA', 'DRAFT', 'CHANGES_REQUESTED'] as const) {
      const options = reviewOptions({
        status,
        role: 'EDITOR',
        versionSubmitted: false,
        submittedByMe: false,
      });
      expect(options.submit).toBe(true);
      expect(options.needsNewVersion).toBe(false);
    }
  });

  it('asks for a new version when changes were requested on the submitted one', () => {
    const options = reviewOptions({
      status: 'CHANGES_REQUESTED',
      role: 'EDITOR',
      versionSubmitted: true,
      submittedByMe: true,
    });
    expect(enabled(options)).toEqual(['archive', 'needsNewVersion']);
  });

  it('gives editors only withdraw while in review', () => {
    const options = reviewOptions({
      status: 'IN_REVIEW',
      role: 'EDITOR',
      versionSubmitted: true,
      submittedByMe: true,
    });
    expect(enabled(options)).toEqual(['withdraw']);
  });

  it('lets reviewers decide, except managers on their own submission', () => {
    const base = { status: 'IN_REVIEW', versionSubmitted: true } as const;
    expect(reviewOptions({ ...base, role: 'MANAGER', submittedByMe: false }).decide).toBe(true);
    const own = reviewOptions({ ...base, role: 'MANAGER', submittedByMe: true });
    expect(own.decide).toBe(false);
    expect(own.ownSubmission).toBe(true);
    for (const role of ['ADMIN', 'OWNER'] as const) {
      const admin = reviewOptions({ ...base, role, submittedByMe: true });
      expect(admin.decide).toBe(true);
      expect(admin.ownSubmission).toBe(false);
    }
  });

  it('offers schedule, publish and a new version once approved', () => {
    const approved = reviewOptions({
      status: 'APPROVED',
      role: 'EDITOR',
      versionSubmitted: true,
      submittedByMe: false,
    });
    expect(enabled(approved)).toEqual(['newVersion', 'publish', 'schedule']);
    const scheduled = reviewOptions({
      status: 'SCHEDULED',
      role: 'MANAGER',
      versionSubmitted: true,
      submittedByMe: false,
    });
    expect(enabled(scheduled)).toEqual(['archive', 'newVersion', 'publish', 'unschedule']);
  });

  it('offers rework or archive when rejected', () => {
    const options = reviewOptions({
      status: 'REJECTED',
      role: 'EDITOR',
      versionSubmitted: true,
      submittedByMe: false,
    });
    expect(enabled(options)).toEqual(['archive', 'newVersion']);
  });

  it('gives viewers no actions', () => {
    for (const status of ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'] as const) {
      expect(
        enabled(
          reviewOptions({ status, role: 'VIEWER', versionSubmitted: false, submittedByMe: false }),
        ),
      ).toEqual([]);
    }
  });
});

describe('archiving', () => {
  it('follows the stage and the role', () => {
    expect(canArchive('DRAFT', 'EDITOR')).toBe(true);
    expect(canArchive('REJECTED', 'EDITOR')).toBe(true);
    expect(canArchive('APPROVED', 'EDITOR')).toBe(false);
    expect(canArchive('SCHEDULED', 'MANAGER')).toBe(true);
    expect(canArchive('IN_REVIEW', 'OWNER')).toBe(false);
    expect(canArchive('PUBLISHED', 'OWNER')).toBe(false);
    expect(canArchive('ARCHIVED', 'OWNER')).toBe(false);
    expect(canArchive('DRAFT', 'VIEWER')).toBe(false);
  });

  it('keeps publish date and owner editable until published', () => {
    expect(canEditPlan('IN_REVIEW')).toBe(true);
    expect(canEditPlan('SCHEDULED')).toBe(true);
    expect(canEditPlan('PUBLISHED')).toBe(false);
    expect(canEditPlan('ARCHIVED')).toBe(false);
  });
});

describe('history', () => {
  it('describes stage changes and decisions in plain words', () => {
    const event = (from: string | null, to: string, note: string | null = null) =>
      historyTitle({ kind: 'event', from, to, note } as Parameters<typeof historyTitle>[0]);
    expect(event(null, 'IDEA')).toBe('Created as an idea');
    expect(event(null, 'APPROVED')).toBe('Approved');
    expect(event('DRAFT', 'IN_REVIEW')).toBe('Submitted for review');
    expect(event('IN_REVIEW', 'DRAFT')).toBe('Taken out of review');
    expect(event('APPROVED', 'SCHEDULED')).toBe('Marked as scheduled');
    expect(event('SCHEDULED', 'APPROVED')).toBe('Moved back to approved');
    expect(event('APPROVED', 'DRAFT')).toBe('Back to draft');
    expect(event('IDEA', 'DRAFT')).toBe('Moved to draft');
    expect(event('ARCHIVED', 'DRAFT')).toBe('Restored as a draft');
    expect(historyTitle({ kind: 'review', decision: 'CHANGES_REQUESTED', versionNumber: 2 })).toBe(
      'Asked for changes to version 2',
    );
  });

  it('hides notes the history line already says', () => {
    expect(historyNote('Withdrawn from review')).toBeNull();
    expect(historyNote('  ')).toBeNull();
    expect(historyNote('Check the price')).toBe('Check the price');
  });

  it('formats times in the organization time zone', () => {
    expect(formatDateTime('2026-10-08T12:00:00Z', 'Europe/Amsterdam')).toBe('8 Oct 2026, 14:00');
  });
});

describe('comment threads', () => {
  const c = (
    id: string,
    at: string,
    parentId: string | null = null,
    resolvedAt: string | null = null,
  ) => ({
    id,
    parentId,
    createdAt: `2026-10-0${at}T10:00:00Z`,
    resolvedAt,
  });

  it('groups replies under their comment and puts resolved threads last', () => {
    const threads = threadComments([
      c('r2', '5', 'a'),
      c('b', '2', null, '2026-10-06T00:00:00Z'),
      c('a', '1'),
      c('r1', '3', 'a'),
      c('c', '4'),
      c('orphan', '6', 'gone'),
    ]);
    expect(threads.map((t) => t.comment.id)).toEqual(['a', 'c', 'b']);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('plan form', () => {
  it('needs a date when a time is given', () => {
    expect(contentPlanSchema.safeParse({ plannedTime: '10:00' }).success).toBe(false);
    expect(
      contentPlanSchema.parse({ plannedDate: '2026-10-20', plannedTime: '', ownerUserId: '' }),
    ).toEqual({ plannedDate: '2026-10-20', plannedTime: '', ownerUserId: null });
  });
});
