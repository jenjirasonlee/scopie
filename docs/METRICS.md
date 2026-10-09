# Scopie — Metrics

> Status: dictionary built in Phase 2; public metrics, sources and availability reasons added in Phase 3. Last updated: 2026-10-07

The metric dictionary is `METRIC_DEFINITIONS` in `lib/metrics/registry.ts`, mirrored in the
`metric_definitions` table (a test checks they match). Every number on screen uses a key from it.

## 1. Rules

1. **Each metric has one meaning.** Reach is unique accounts reached; impressions and views count
   every time content was shown. They are never swapped for each other.
2. **Unknown is not zero.** A missing number is stored with a reason and no value (§5).
3. **Derived metrics are computed, never stored.** Engagement rates, follower change and growth rate
   are calculated from stored values when shown, so their formula can't drift.
4. **Compare like with like.** Two values are compared only when they share the metric key, the
   comparability class (§3) and the data source (§5).
5. **Every value says where it came from.** Each stored value carries its data source, shown as a
   label next to the number.

## 2. Dictionary

| Key                                                                | Label                  | Unit    | Combines over time | Applies to      |
| ------------------------------------------------------------------ | ---------------------- | ------- | ------------------ | --------------- |
| `followers`                                                        | Followers              | count   | last value         | accounts        |
| `following`                                                        | Following              | count   | last value         | accounts        |
| `posts_total`                                                      | Posts on profile       | count   | last value         | accounts        |
| `followers_gained`                                                 | Followers gained       | count   | sum                | accounts        |
| `followers_lost`                                                   | Followers lost         | count   | sum                | accounts        |
| `reach`                                                            | Reach                  | count   | not additive       | accounts, posts |
| `impressions`                                                      | Impressions            | count   | sum                | accounts, posts |
| `views`                                                            | Views                  | count   | sum                | accounts, posts |
| `profile_views`                                                    | Profile views          | count   | sum                | accounts        |
| `interactions`                                                     | Interactions           | count   | sum                | accounts, posts |
| `likes`, `reactions`, `comments`, `shares`, `saves`, `link_clicks` | —                      | count   | sum                | posts           |
| `quotes`                                                           | Quotes                 | count   | sum                | posts           |
| `watch_time`                                                       | Watch time             | seconds | sum                | posts           |
| `avg_watch_duration`                                               | Average watch duration | seconds | recompute          | posts           |
| `completion_rate`                                                  | Completion rate        | percent | recompute          | posts           |

Derived (never stored): `follower_change`, `follower_growth_rate`, `posts_published`,
`public_engagement` and the three engagement rates (by reach, by impressions, by followers). Their inputs are listed in the registry and
their formulas in the `metric_definitions.formula` column.

**Public engagement** is likes plus comments: the engagement anyone can see. Scopie computes it; it
is not the platform's own engagement figure (`interactions`, which only connected accounts have).
`posts_total` is the post count the platform reports for the profile. `following` is in the
dictionary, but Business Discovery doesn't return it as public, so public profiles don't have it.

The registry is the place to check exact keys, units and "higher is better"; this table is a summary.

**Reach is not additive.** Daily reach can't be added into weekly reach, because the same person
can be reached on several days. Weekly or monthly reach will only be shown where the platform
reports it for that period.

## 3. Comparability classes

Each platform metric maps to a Scopie metric and a comparability class (`PLATFORM_METRIC_MAP`,
mirrored in `platform_metric_map`):

- Instagram and Facebook reach share the class `meta_reach`, so they can be compared.
- Followers on any platform share `audience_size`, from insights or from Business Discovery.
- Likes and comments from Business Discovery share `likes` and `comments` with the insights values.
- Post count from Business Discovery is `posts_total`.
- **Instagram public Reel views** (`business_discovery.view_count`) are `ig_public_reel_views`. They
  include paid views and exist only for Reels, so they are never compared with insights `views`
  (`meta_views`), even on the same account.
- Facebook reactions (`fb_reactions`) and Instagram likes (`likes`) are different classes.
- **YouTube subscribers** (`statistics.subscriberCount`) are `yt_subscribers_rounded`, not
  `audience_size`: YouTube rounds them to 3 significant figures, so they are never ranked against
  exact follower counts.
- YouTube channel views are `yt_channel_views` (lifetime) and video views are `yt_public_views`.
  Neither is compared with Instagram or connected views.
- YouTube likes and comments share `likes` and `comments`; video count is `posts_total`.
- **X** and **Bluesky**: followers share `audience_size`, likes and replies share `likes` and
  `comments`; reposts are `shares` in class `reposts` (not comparable with Meta shares); quote posts
  are `quotes`. X post counts (`x_tweet_count`) and Bluesky post counts (`bsky_posts_count`) include
  replies, so they are not `posts_total`. X bookmarks are `saves` in class `x_bookmarks`, and X
  impressions, shown on X as views, are `views` in class `x_public_views`, never compared with other
  platforms' views. Bluesky has no views at all.
- A metric with no mapping, such as an imported LinkedIn impression, gets the class
  `<platform>:<metric>` and is only compared within that platform.

`comparabilityClass()` takes the source metric when it is known, because one Scopie metric can come
from sources that are not comparable (Reel views above).

## 4. Snapshots

Post metrics are lifetime totals captured at a point in time. Each snapshot stores `post_age_hours`,
and the `post_metrics_at_age` view finds the snapshot closest to a given age (within 15%, at least
6 hours), so posts are compared at the same age rather than "whatever was last read".

Account metrics are daily values dated in the platform's reporting timezone. Followers is a running
total dated the day it was read.

Public profiles have no daily insights. Their follower history is Scopie's own observations: one
`lifetime` value a day from the day the profile was added. Nothing before that is shown or estimated.

## 5. Data sources and availability

Every stored value carries a data source:

| Source           | Label     | Meaning                                                                   |
| ---------------- | --------- | ------------------------------------------------------------------------- |
| `live_public`    | PUBLIC    | Observed from public platform data, without the owner's login             |
| `live_connected` | CONNECTED | Read through the owner's connection, including private metrics            |
| `imported`       | IMPORTED  | From a CSV file                                                           |
| `estimated`      | ESTIMATED | Reserved. Nothing produces it yet, and it is never mixed with live values |
| `demo`           | DEMO      | Generated for testing; only in demo organizations                         |

**Comparison rule.** Two values are compared only if they share the metric key, the comparability
class and the data source. A connected CANNA profile is compared with competitors on its
`live_public` values, not its insights. A metric missing for one side is shown as unavailable for that
side, not as zero.

A value that couldn't be read has an availability reason instead of a number:

| Availability      | Shown as        | When                                                                                    |
| ----------------- | --------------- | --------------------------------------------------------------------------------------- |
| `available`       | the value       | The platform returned it                                                                |
| `not_permitted`   | not shared      | A permission is missing or the platform withheld it                                     |
| `not_applicable`  | n/a             | It doesn't apply, for example views on an Instagram photo                               |
| `hidden_by_owner` | hidden by owner | The owner hides it, for example Instagram like counts                                   |
| `not_public`      | not public      | Only the account owner can see it, such as reach, saves and shares for a public profile |
| `pending`         | pending         | The platform hasn't reported that day yet                                               |
| `error`           | error           | The read failed                                                                         |

The public collector doesn't request private metrics at all, so no `not_public` rows are stored
today; the reason exists so screens can say why such a metric is missing.

## 6. Dashboard and analytics

The dashboard and analytics (`lib/analytics`) compute everything from stored observations. Nothing is
interpolated or back-filled. The rules, from [PHASE_3_PLAN.md](PHASE_3_PLAN.md) §8:

- **Observed growth:** first and last follower observation inside the range, `(last − first) / first`,
  shown with both dates. Needs at least two observations at least 24 hours apart.
- **Posting frequency:** posts per week from `published_at`, only for periods after
  `earliest_post_at`, so incomplete history isn't counted as "no posts".
- **Public engagement per post:** likes plus comments at a fixed post age (7 days by default), median
  and mean, with the post count. Posts with hidden likes are excluded, and the count says so.
- **Comparisons** follow the rule in §5.

## 7. Benchmarks

Benchmarks (`lib/analytics/benchmark.ts`) rank profiles with the same rules as §6:

- **One platform and one data source at a time.** Derived metrics have platform-specific
  comparability classes, so profiles on different platforms are never ranked together.
- **Every ranking states its basis:** metric, period, data source, platform and set.
- **No value, no rank.** A profile without a comparable value is listed as "Not ranked" with the
  reason (not enough observations, post history starts later, too few posts measured, likes hidden by
  owner, paused, not comparable). It is never ranked as 0.
- **Posts per week** ranks only profiles whose post history covers the whole period.
- **Engagement** needs at least 5 posts measured at 7 days old.
- **Followers** is the last observation inside the period.
- **Country vs country** shows medians with how many profiles each rests on; **period comparisons**
  use equal-length periods and only profiles with a value in both.
