import { mean, median } from './stats';
import { unavailable, type DataSource, type PostRecord, type Result } from './types';

export const ENGAGEMENT_AGE_DAYS = 7;
export const MIN_POSTS_FOR_COMPARISON = 5;

export type PostEngagement =
  | { status: 'ok'; value: number; likes: number; comments: number; dataSource: DataSource }
  | { status: 'hidden_by_owner' }
  | { status: 'missing' };

/**
 * Public engagement of one post at the fixed age: likes + comments. Posts whose owner hides
 * likes are reported as such (never counted as 0 likes); posts without both values at that
 * age are "missing". Likes and comments must come from the same data source.
 */
export function postEngagement(post: PostRecord): PostEngagement {
  if (post.likes?.availability === 'hidden_by_owner') return { status: 'hidden_by_owner' };
  const { likes, comments } = post;
  if (
    !likes ||
    !comments ||
    likes.availability !== 'available' ||
    comments.availability !== 'available' ||
    likes.value === null ||
    comments.value === null ||
    likes.dataSource !== comments.dataSource
  ) {
    return { status: 'missing' };
  }
  return {
    status: 'ok',
    value: likes.value + comments.value,
    likes: likes.value,
    comments: comments.value,
    dataSource: likes.dataSource,
  };
}

export type Engagement = Result<{
  median: number;
  mean: number;
  /** Posts with a value, i.e. the sample size. */
  posts: number;
  excludedHidden: number;
  excludedMissing: number;
  dataSource: DataSource;
}> & { excludedHidden: number; excludedMissing: number };

/**
 * Median and mean public engagement per post at the fixed age, with the number of posts
 * behind them. Posts with hidden likes and posts without a value at that age are excluded
 * and counted, so the UI can say so. All posts must carry values of one data source.
 */
export function publicEngagement(posts: readonly PostRecord[]): Engagement {
  const values: number[] = [];
  const sources = new Set<DataSource>();
  let excludedHidden = 0;
  let excludedMissing = 0;
  for (const post of posts) {
    const engagement = postEngagement(post);
    if (engagement.status === 'hidden_by_owner') excludedHidden++;
    else if (engagement.status === 'missing') excludedMissing++;
    else {
      values.push(engagement.value);
      sources.add(engagement.dataSource);
    }
  }
  if (sources.size > 1) {
    throw new Error('publicEngagement: values from more than one data source');
  }
  if (!values.length) {
    const why = excludedHidden
      ? `${excludedHidden} post(s) have likes hidden by the owner.`
      : 'No post in this period has been measured at 7 days old yet.';
    return {
      ...unavailable('no_posts_at_age', why),
      excludedHidden,
      excludedMissing,
    };
  }
  return {
    status: 'ok',
    median: median(values)!,
    mean: mean(values)!,
    posts: values.length,
    excludedHidden,
    excludedMissing,
    dataSource: [...sources][0]!,
  };
}
