import type { Enums } from '@/lib/db/types';

export type ImportKind = Enums<'import_kind'>;

export type TemplateColumn = {
  name: string;
  required: boolean;
  description: string;
};

/** Account metric columns. followers is a running total as of the date; the rest are per day. */
export const ACCOUNT_METRIC_COLUMNS: Record<
  string,
  { metricKey: string; period: 'day' | 'lifetime' }
> = {
  followers: { metricKey: 'followers', period: 'lifetime' },
  followers_gained: { metricKey: 'followers_gained', period: 'day' },
  followers_lost: { metricKey: 'followers_lost', period: 'day' },
  reach: { metricKey: 'reach', period: 'day' },
  impressions: { metricKey: 'impressions', period: 'day' },
  views: { metricKey: 'views', period: 'day' },
  profile_views: { metricKey: 'profile_views', period: 'day' },
  interactions: { metricKey: 'interactions', period: 'day' },
};

/** Post metric columns, stored as lifetime totals at captured_at. */
export const POST_METRIC_COLUMNS = [
  'reach',
  'impressions',
  'views',
  'likes',
  'reactions',
  'comments',
  'shares',
  'saves',
  'link_clicks',
  'interactions',
  'watch_time',
  'avg_watch_duration',
  'completion_rate',
] as const;

/**
 * Other names for Scopie columns, so common platform exports (e.g. LinkedIn's post
 * export) can be imported without renaming columns by hand. Keys are normalized headers.
 */
export const COLUMN_ALIASES: Record<string, string> = {
  post_link: 'permalink',
  post_url: 'permalink',
  url: 'permalink',
  link: 'permalink',
  created_date: 'published_at',
  date_posted: 'published_at',
  published: 'published_at',
  post_title: 'caption',
  post_text: 'caption',
  text: 'caption',
  clicks: 'link_clicks',
  reposts: 'shares',
  saved: 'saves',
  engagements: 'interactions',
  total_interactions: 'interactions',
  post_type: 'format',
  content_type: 'format',
  new_followers: 'followers_gained',
  page_views: 'profile_views',
  id: 'post_id',
  external_id: 'post_id',
};

export const MEDIA_FORMAT_ALIASES: Record<string, Enums<'media_format'>> = {
  image: 'image',
  photo: 'image',
  picture: 'image',
  carousel: 'carousel',
  album: 'carousel',
  document: 'carousel',
  reel: 'short_video',
  reels: 'short_video',
  short: 'short_video',
  shorts: 'short_video',
  short_video: 'short_video',
  long_video: 'long_video',
  video: 'video',
  text: 'text',
  article: 'link',
  link: 'link',
  story: 'story',
  live: 'live',
  other: 'other',
};

export const TEMPLATES: Record<
  ImportKind,
  { title: string; columns: TemplateColumn[]; example: string }
> = {
  account_metrics: {
    title: 'Account metrics by day',
    columns: [
      { name: 'date', required: true, description: 'The day the numbers are for, as YYYY-MM-DD.' },
      ...Object.keys(ACCOUNT_METRIC_COLUMNS).map((name) => ({
        name,
        required: false,
        description:
          name === 'followers'
            ? 'Total followers on that day.'
            : `${name.replace(/_/g, ' ')} during that day.`,
      })),
    ],
    example:
      'date,followers,reach,impressions\n2026-09-01,12840,5120,8410\n2026-09-02,12861,,7990\n',
  },
  posts: {
    title: 'Posts with their metrics',
    columns: [
      {
        name: 'post_id',
        required: true,
        description: "The platform's ID for the post, or its link if there's no ID.",
      },
      {
        name: 'published_at',
        required: true,
        description:
          'When it was published, e.g. 2026-09-01T14:30:00+02:00. A date alone is read as 12:00 UTC.',
      },
      { name: 'permalink', required: false, description: 'Link to the post.' },
      { name: 'caption', required: false, description: 'Post text.' },
      {
        name: 'format',
        required: false,
        description: 'image, carousel, video, short_video, long_video, text, link, story or live.',
      },
      {
        name: 'captured_at',
        required: false,
        description:
          'When these numbers were read (YYYY-MM-DD or a date and time). Defaults to the time of import.',
      },
      ...POST_METRIC_COLUMNS.map((name) => ({
        name,
        required: false,
        description:
          name === 'watch_time' || name === 'avg_watch_duration'
            ? `${name.replace(/_/g, ' ')} in seconds.`
            : name === 'completion_rate'
              ? 'Completion rate as a percentage, e.g. 42.5.'
              : `${name.replace(/_/g, ' ')} as a total.`,
      })),
    ],
    example:
      'post_id,published_at,permalink,format,captured_at,impressions,reactions,comments,shares,link_clicks\n' +
      'urn:li:share:7100000000000000001,2026-09-01T09:00:00Z,https://www.linkedin.com/feed/update/urn:li:share:7100000000000000001,image,2026-09-08,4210,96,7,5,38\n',
  },
};
