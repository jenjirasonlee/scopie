-- Phase 10: more platforms with public data, read by handle with no login from the owner.
--   X: official X API v2 with an app-only Bearer token (X_BEARER_TOKEN, pay-per-use credits).
--   Bluesky: the public AT Protocol AppView, no key at all.
-- Threads and Pinterest are listed so the app can say plainly that their public numbers
-- can't be read; their profiles get data through CSV import. See docs/API_INTEGRATIONS.md §4c, §4d, §6.

update public.platforms
  set public_data_status = 'available', reporting_timezone = 'UTC'
  where key = 'x';

insert into public.platforms (key, name, sort_order, public_data_status, private_data_status, reporting_timezone) values
  ('bluesky',   'Bluesky',   65, 'available',     'not_available', 'UTC'),
  ('threads',   'Threads',   66, 'not_available', 'planned',       null),
  ('pinterest', 'Pinterest', 67, 'not_available', 'planned',       null);

-- A public profile is just a profile: the APIs don't say whether it is a business.
insert into public.platform_account_types (platform_key, key, label) values
  ('x', 'profile', 'Profile'),
  ('bluesky', 'profile', 'Profile'),
  ('threads', 'profile', 'Profile'),
  ('pinterest', 'business', 'Business'),
  ('pinterest', 'personal', 'Personal');

-- Quote posts (X, Bluesky). A post quoting another isn't a repost, so it gets its own metric.
insert into public.metric_definitions
  (key, label, definition, unit, aggregation, higher_is_better, applies_to_accounts, applies_to_posts, is_derived, formula, inputs, sort_order)
values
  ('quotes', 'Quotes', 'Posts that quote this post (X, Bluesky).', 'count', 'sum', true, false, true, false, null, '{}', 135);

insert into public.platform_metric_map
  (platform_key, scope, source_metric, metric_key, comparability_class, api_version, value_transform, notes)
values
  ('x', 'account', 'public_metrics.followers_count', 'followers', 'audience_size', '2', null, 'Public'),
  ('x', 'account', 'public_metrics.following_count', 'following', 'following', '2', null, 'Public'),
  ('x', 'account', 'public_metrics.tweet_count', 'posts_total', 'x_tweet_count', '2', null,
   'Includes replies and reposts, so not comparable with other platforms'' post counts'),
  ('x', 'post', 'public_metrics.like_count', 'likes', 'likes', '2', null, 'Public'),
  ('x', 'post', 'public_metrics.reply_count', 'comments', 'comments', '2', null, 'Replies'),
  ('x', 'post', 'public_metrics.retweet_count', 'shares', 'reposts', '2', null, 'Reposts'),
  ('x', 'post', 'public_metrics.quote_count', 'quotes', 'quotes', '2', null, 'Quote posts'),
  ('x', 'post', 'public_metrics.bookmark_count', 'saves', 'x_bookmarks', '2', null, 'Bookmarks, public on X'),
  ('x', 'post', 'public_metrics.impression_count', 'views', 'x_public_views', '2', null,
   'Shown as views on X; never compared with other platforms'' views'),
  ('bluesky', 'account', 'followersCount', 'followers', 'audience_size', 'appview', null, 'Public'),
  ('bluesky', 'account', 'followsCount', 'following', 'following', 'appview', null, 'Public'),
  ('bluesky', 'account', 'postsCount', 'posts_total', 'bsky_posts_count', 'appview', null,
   'Includes replies, so not comparable with other platforms'' post counts'),
  ('bluesky', 'post', 'likeCount', 'likes', 'likes', 'appview', null, 'Public'),
  ('bluesky', 'post', 'replyCount', 'comments', 'comments', 'appview', null, 'Replies'),
  ('bluesky', 'post', 'repostCount', 'shares', 'reposts', 'appview', null, 'Reposts'),
  ('bluesky', 'post', 'quoteCount', 'quotes', 'quotes', 'appview', null, 'Quote posts');
