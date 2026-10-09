import { describe, expect, it } from 'vitest';
import {
  needsAnotherReviewer,
  QUEUE_TAB_EMPTY,
  QUEUE_TAB_LABELS,
} from '@/components/approvals/queue-shared';
import { QUEUE_TABS } from '@/lib/approvals/shared';
import {
  badgeCount,
  formatAbsoluteTime,
  formatNotificationTime,
  notificationHref,
} from '@/lib/notifications/shared';

describe('notification links', () => {
  const itemId = '11111111-1111-4111-8111-111111111111';

  it('opens the content, or its comments for comment notifications', () => {
    expect(notificationHref('acme', { kind: 'approved', itemId })).toBe(`/acme/content/${itemId}`);
    expect(notificationHref('acme', { kind: 'review_requested', itemId })).toBe(
      `/acme/content/${itemId}`,
    );
    expect(notificationHref('acme', { kind: 'mentioned', itemId })).toBe(
      `/acme/content/${itemId}#comments`,
    );
    expect(notificationHref('acme', { kind: 'commented', itemId })).toBe(
      `/acme/content/${itemId}#comments`,
    );
  });

  it('has no link when the content is gone', () => {
    expect(notificationHref('acme', { kind: 'approved', itemId: null })).toBeNull();
  });
});

describe('badge counts', () => {
  it('shows nothing for zero and caps at 99+', () => {
    expect(badgeCount(0)).toBeNull();
    expect(badgeCount(-1)).toBeNull();
    expect(badgeCount(Number.NaN)).toBeNull();
    expect(badgeCount(1)).toBe('1');
    expect(badgeCount(99)).toBe('99');
    expect(badgeCount(100)).toBe('99+');
  });
});

describe('notification times', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('uses plain relative words for the last day', () => {
    expect(formatNotificationTime(ago(20_000), now, 'Europe/Amsterdam')).toBe('Just now');
    expect(formatNotificationTime(ago(60_000), now, 'Europe/Amsterdam')).toBe('1 minute ago');
    expect(formatNotificationTime(ago(45 * 60_000), now, 'Europe/Amsterdam')).toBe(
      '45 minutes ago',
    );
    expect(formatNotificationTime(ago(60 * 60_000), now, 'Europe/Amsterdam')).toBe('1 hour ago');
    expect(formatNotificationTime(ago(23 * 3_600_000), now, 'Europe/Amsterdam')).toBe(
      '23 hours ago',
    );
  });

  it('shows the date and time in the organization time zone after a day', () => {
    expect(formatNotificationTime('2026-10-06T22:30:00Z', now, 'Europe/Amsterdam')).toBe(
      '7 Oct, 00:30',
    );
    expect(formatNotificationTime('2025-12-31T23:30:00Z', now, 'UTC')).toBe('31 Dec 2025, 23:30');
  });

  it('formats absolute times with the year', () => {
    expect(formatAbsoluteTime('2026-10-08T07:05:00Z', 'Asia/Tokyo')).toBe('8 Oct 2026, 16:05');
  });
});

describe('review queue', () => {
  const me = '22222222-2222-4222-8222-222222222222';
  const someoneElse = '33333333-3333-4333-8333-333333333333';

  it('flags a manager’s own submissions for another reviewer', () => {
    expect(needsAnotherReviewer('MANAGER', me, me)).toBe(true);
    expect(needsAnotherReviewer('MANAGER', me, someoneElse)).toBe(false);
    expect(needsAnotherReviewer('MANAGER', me, null)).toBe(false);
  });

  it('lets admins and owners review their own submissions', () => {
    expect(needsAnotherReviewer('ADMIN', me, me)).toBe(false);
    expect(needsAnotherReviewer('OWNER', me, me)).toBe(false);
  });

  it('labels and explains every tab', () => {
    for (const tab of QUEUE_TABS) {
      expect(QUEUE_TAB_LABELS[tab]).toBeTruthy();
      expect(QUEUE_TAB_EMPTY[tab].body).not.toContain('—');
    }
  });
});
