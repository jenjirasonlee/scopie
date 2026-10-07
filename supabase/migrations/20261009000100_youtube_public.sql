-- Phase 4: public YouTube channels through the YouTube Data API v3 (API key, no OAuth).
-- Any public channel can be read; private metrics (watch time, demographics, revenue)
-- need the owner's authorization and are not collected.

update public.platforms set public_data_status = 'available' where key = 'youtube';

insert into public.platform_metric_map
  (platform_key, scope, source_metric, metric_key, comparability_class, api_version, value_transform, notes)
values
  ('youtube', 'account', 'statistics.subscriberCount', 'followers', 'yt_subscribers_rounded', 'v3', null,
   'Public; YouTube rounds it down to three significant figures, so small changes are invisible'),
  ('youtube', 'account', 'statistics.videoCount', 'posts_total', 'posts_total', 'v3', null, 'Public videos on the channel'),
  ('youtube', 'account', 'statistics.viewCount', 'views', 'yt_channel_views', 'v3', null, 'Lifetime channel views, public'),
  ('youtube', 'post', 'statistics.viewCount', 'views', 'yt_public_views', 'v3', null, 'Public view count'),
  ('youtube', 'post', 'statistics.likeCount', 'likes', 'likes', 'v3', null, 'Missing when the owner hides likes'),
  ('youtube', 'post', 'statistics.commentCount', 'comments', 'comments', 'v3', null, 'Missing when comments are off');
