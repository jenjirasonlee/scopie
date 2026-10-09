import type { ReportSnapshot } from '@/lib/reports/types';

// A realistic weekly report snapshot for the DEMO organization, for unit tests and for
// trying the report pages by hand. It has N/A numbers, a profile that wasn't ranked and no
// risks, so the pages' empty and unavailable states get exercised. All of it is DEMO DATA.

const ACCOUNTS = {
  nl: '0b4c1a52-6d0e-4c1f-9a51-1f0d6c1e0001',
  de: '0b4c1a52-6d0e-4c1f-9a51-1f0d6c1e0002',
  es: '0b4c1a52-6d0e-4c1f-9a51-1f0d6c1e0003',
  esFacebook: '0b4c1a52-6d0e-4c1f-9a51-1f0d6c1e0004',
  rival: '0b4c1a52-6d0e-4c1f-9a51-1f0d6c1e0005',
  rivalDe: '0b4c1a52-6d0e-4c1f-9a51-1f0d6c1e0006',
};

export const REPORT_SNAPSHOT_FIXTURE: ReportSnapshot = {
  version: 1,
  orgName: 'CANNA (DEMO)',
  isDemo: true,
  dataSource: 'demo',
  timeZone: 'Europe/Amsterdam',
  week: { start: '2026-09-28', end: '2026-10-04' },
  previousWeek: { start: '2026-09-21', end: '2026-09-27' },
  summary: [
    'Your own profiles gained 1,240 followers, 180 more than the week before.',
    'You published 14 posts, 3 fewer than the week before.',
    'CANNA Germany grew the most on Instagram (+412 followers).',
    'Reels were the format with the highest median engagement (1.6× your other formats).',
  ],
  kpis: [
    {
      key: 'followers_gained',
      label: 'Followers gained',
      value: 1240,
      display: '+1,240',
      previous: 1060,
      previousDisplay: '+1,060',
      change: '+180 on the week before',
      basis: 'Sum of follower growth on 5 own profiles with a count at both ends of the week.',
      unavailable: null,
    },
    {
      key: 'posts_published',
      label: 'Posts published',
      value: 14,
      display: '14',
      previous: 17,
      previousDisplay: '17',
      change: '−3 on the week before',
      basis: 'Posts published by own profiles, Monday to Sunday.',
      unavailable: null,
    },
    {
      key: 'median_engagement',
      label: 'Median engagement per post',
      value: 386,
      display: '386',
      previous: null,
      previousDisplay: 'N/A',
      change: null,
      basis: 'Median of likes + comments on 14 own posts.',
      unavailable: null,
    },
    {
      key: 'content_published',
      label: 'Planned content published',
      value: null,
      display: 'N/A',
      previous: null,
      previousDisplay: 'N/A',
      change: null,
      basis: 'Content items in Scopie marked published this week.',
      unavailable: 'No content items were planned for this week.',
    },
    {
      key: 'reviews',
      label: 'Reviews decided',
      value: null,
      display: 'N/A',
      previous: 4,
      previousDisplay: '4',
      change: null,
      basis: 'Approvals, change requests and rejections recorded in Scopie.',
      unavailable: 'Nothing was sent for review this week.',
    },
  ],
  markets: [
    {
      platformKey: 'instagram',
      platform: 'Instagram',
      basis:
        'Follower growth, 28 Sept – 4 Oct 2026, from DEMO follower counts at both ends of the week.',
      rows: [
        {
          rank: 1,
          accountId: ACCOUNTS.de,
          name: 'CANNA Germany',
          countryCode: 'DE',
          role: 'own',
          display: '+412',
          sample: '2 counts, 7 days apart',
        },
        {
          rank: 2,
          accountId: ACCOUNTS.nl,
          name: 'CANNA Netherlands',
          countryCode: 'NL',
          role: 'own',
          display: '+298',
          sample: '2 counts, 7 days apart',
        },
        {
          rank: 3,
          accountId: ACCOUNTS.es,
          name: 'CANNA Spain',
          countryCode: 'ES',
          role: 'own',
          display: '−14',
          sample: '2 counts, 6 days apart',
        },
      ],
      notRanked: [],
    },
    {
      platformKey: 'facebook',
      platform: 'Facebook',
      basis:
        'Follower growth, 28 Sept – 4 Oct 2026, from DEMO follower counts at both ends of the week.',
      rows: [],
      notRanked: [{ name: 'CANNA Spain (Facebook)', reason: 'Only one follower count this week' }],
    },
  ],
  competitors: [
    {
      platformKey: 'instagram',
      platform: 'Instagram',
      basis:
        'Follower growth, 28 Sept – 4 Oct 2026, own profiles and competitors on the same DEMO counts.',
      rows: [
        {
          rank: 1,
          accountId: ACCOUNTS.rival,
          name: 'GrowRival',
          countryCode: 'NL',
          role: 'competitor',
          display: '+530',
          sample: '2 counts, 7 days apart',
        },
        {
          rank: 2,
          accountId: ACCOUNTS.de,
          name: 'CANNA Germany',
          countryCode: 'DE',
          role: 'own',
          display: '+412',
          sample: '2 counts, 7 days apart',
        },
        {
          rank: 3,
          accountId: ACCOUNTS.nl,
          name: 'CANNA Netherlands',
          countryCode: 'NL',
          role: 'own',
          display: '+298',
          sample: '2 counts, 7 days apart',
        },
      ],
      notRanked: [{ name: 'GrowRival Deutschland', reason: 'Monitoring paused' }],
    },
  ],
  topContent: [
    {
      accountId: ACCOUNTS.de,
      profile: 'CANNA Germany',
      platform: 'Instagram',
      format: 'Reel',
      publishedAt: '2026-10-01T15:30:00.000Z',
      engagement: 1284,
      display: '1,284',
      permalink: 'https://example.com/demo/post/1',
    },
    {
      accountId: ACCOUNTS.nl,
      profile: 'CANNA Netherlands',
      platform: 'Instagram',
      format: 'Carousel',
      publishedAt: '2026-09-29T09:00:00.000Z',
      engagement: 912,
      display: '912',
      permalink: 'https://example.com/demo/post/2',
    },
    {
      accountId: ACCOUNTS.es,
      profile: 'CANNA Spain',
      platform: 'Instagram',
      format: 'Image',
      publishedAt: '2026-10-03T18:45:00.000Z',
      engagement: 455,
      display: '455',
      permalink: null,
    },
  ],
  strategies: [
    {
      id: '5d7f3a10-2b8e-4f6a-9c11-3e2a7b0c0001',
      name: 'Q4 2026 Germany growth',
      objectives: [
        { name: 'Grow Instagram followers in Germany', display: '+412 this week', note: null },
        {
          name: 'Median engagement per post',
          display: 'N/A',
          note: 'Fewer than 3 posts in the week, so no median.',
        },
      ],
      coverage: 'Pillars: Education 40% of posts (target 50%), Product 35% (target 30%).',
    },
  ],
  insights: {
    key: [
      {
        id: '7a9e2c44-1f3b-4d5e-8a6b-0c1d2e3f0001',
        kind: 'growth_change',
        title: 'Germany’s Instagram growth picked up',
        body: 'CANNA Germany gained 412 followers this week, against a 4-week median of 260. The rise is associated with two Reels posted on Wednesday and Thursday.',
        severity: 'notable',
      },
      {
        id: '7a9e2c44-1f3b-4d5e-8a6b-0c1d2e3f0002',
        kind: 'format_winner',
        title: 'Reels did best',
        body: 'Reels had a median engagement of 640 across 5 posts, 1.6× the median of your other formats.',
        severity: 'info',
      },
    ],
    opportunities: [
      {
        id: '7a9e2c44-1f3b-4d5e-8a6b-0c1d2e3f0003',
        kind: 'topic_gap',
        title: 'Competitors post about watering; you don’t',
        body: 'GrowRival published 4 posts about watering schedules in the last 28 days. Your profiles published none.',
        severity: 'notable',
      },
    ],
    risks: [],
  },
  actions: [
    {
      id: '9c1b5e77-3a2d-4c8f-b0e1-2d3c4b5a0001',
      title: 'Try two Reels a week in Spain',
      recommendation:
        'CANNA Spain posted no Reels this month. Post two Reels a week for 4 weeks and compare their engagement with your images.',
      confidence: 'medium',
    },
    {
      id: '9c1b5e77-3a2d-4c8f-b0e1-2d3c4b5a0002',
      title: 'Cover watering schedules',
      recommendation: 'Plan one educational post about watering schedules per market this month.',
      confidence: 'low',
    },
  ],
  analysis: {
    runId: '3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f50001',
    writer: 'rules',
    model: null,
    createdAt: '2026-10-05T04:00:00.000Z',
    periodStart: '2026-09-07T22:00:00.000Z',
    periodEnd: '2026-10-04T22:00:00.000Z',
  },
  notes: [
    'Engagement rate isn’t included: reach isn’t available for public profiles.',
    'CANNA Spain (Facebook) had only one follower count this week, so it isn’t ranked.',
  ],
};
