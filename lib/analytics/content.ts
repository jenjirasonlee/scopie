import { postEngagement } from './engagement';
import type { DataSource, MediaFormat, PostRecord } from './types';

export const MEDIA_FORMAT_LABELS: Record<MediaFormat, string> = {
  image: 'Image',
  carousel: 'Carousel',
  short_video: 'Reel / short video',
  long_video: 'Long video',
  video: 'Video',
  text: 'Text',
  link: 'Link',
  story: 'Story',
  live: 'Live',
  other: 'Other',
};

export type FormatShare = { format: MediaFormat; posts: number; share: number };
export type FormatMix = { total: number; formats: FormatShare[] };

/** Share of posts by format, largest first. Empty when there are no posts. */
export function formatMix(posts: readonly Pick<PostRecord, 'mediaFormat'>[]): FormatMix {
  const counts = new Map<MediaFormat, number>();
  for (const post of posts) counts.set(post.mediaFormat, (counts.get(post.mediaFormat) ?? 0) + 1);
  const total = posts.length;
  return {
    total,
    formats: [...counts.entries()]
      .map(([format, count]) => ({ format, posts: count, share: count / total }))
      .sort((a, b) => b.posts - a.posts || a.format.localeCompare(b.format)),
  };
}

export type TopPost = {
  post: PostRecord;
  engagement: number;
  likes: number;
  comments: number;
  dataSource: DataSource;
};

/**
 * Posts ranked by public engagement at the fixed age. Posts with hidden likes or without a
 * value are left out (never ranked as 0). Ties keep the newer post first.
 */
export function topPosts(posts: readonly PostRecord[], limit = 5): TopPost[] {
  const ranked: TopPost[] = [];
  for (const post of posts) {
    const engagement = postEngagement(post);
    if (engagement.status !== 'ok') continue;
    ranked.push({
      post,
      engagement: engagement.value,
      likes: engagement.likes,
      comments: engagement.comments,
      dataSource: engagement.dataSource,
    });
  }
  return ranked
    .sort(
      (a, b) =>
        b.engagement - a.engagement ||
        Date.parse(b.post.publishedAt) - Date.parse(a.post.publishedAt),
    )
    .slice(0, limit);
}

/** How many posts use each hashtag, most used first. */
export function hashtagCounts(
  posts: readonly Pick<PostRecord, 'hashtags'>[],
  limit = 10,
): { tag: string; posts: number }[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of new Set(post.hashtags.map((t) => t.toLowerCase()))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, posts: count }))
    .sort((a, b) => b.posts - a.posts || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
