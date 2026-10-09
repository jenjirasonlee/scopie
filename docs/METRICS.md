# Scopie — Metrics

> Status: dictionary built in Phase 2. Last updated: 2026-10-07

The metric dictionary is `METRIC_DEFINITIONS` in `lib/metrics/registry.ts`, mirrored in the
`metric_definitions` table (a test checks they match). Every number on screen uses a key from it.

## 1. Rules

1. **Each metric has one meaning.** Reach is unique accounts reached; impressions and views count
   every time content was shown. They are never swapped for each other.
2. **Unknown is not zero.** A number a platform withholds is stored as `not_permitted`, one still being
   calculated as `pending`, a failed read as `error`, and one that doesn't apply (watch time on an
   image) as `not_applicable`. None of them carries a value.
3. **Derived metrics are computed, never stored.** Engagement rates, follower change and growth rate
   are calculated from stored values when shown, so their formula can't drift.
4. **Compare like with like.** Two values may be compared or added up only when their comparability
   class matches (see §3).

## 2. Dictionary

| Key                                                                | Label                  | Unit    | Combines over time | Applies to      |
| ------------------------------------------------------------------ | ---------------------- | ------- | ------------------ | --------------- |
| `followers`                                                        | Followers              | count   | last value         | accounts        |
| `followers_gained`                                                 | Followers gained       | count   | sum                | accounts        |
| `followers_lost`                                                   | Followers lost         | count   | sum                | accounts        |
| `reach`                                                            | Reach                  | count   | not additive       | accounts, posts |
| `impressions`                                                      | Impressions            | count   | sum                | accounts, posts |
| `views`                                                            | Views                  | count   | sum                | accounts, posts |
| `profile_views`                                                    | Profile views          | count   | sum                | accounts        |
| `interactions`                                                     | Interactions           | count   | sum                | accounts, posts |
| `likes`, `reactions`, `comments`, `shares`, `saves`, `link_clicks` | —                      | count   | sum                | posts           |
| `watch_time`                                                       | Watch time             | seconds | sum                | posts           |
| `avg_watch_duration`                                               | Average watch duration | seconds | recompute          | posts           |
| `completion_rate`                                                  | Completion rate        | percent | recompute          | posts           |

Derived (never stored): `follower_change`, `follower_growth_rate`, `posts_published` and the three
engagement rates (by reach, by impressions, by followers). Their inputs are listed in the registry and
their formulas in the `metric_definitions.formula` column.

The registry is the place to check exact keys, units and "higher is better"; this table is a summary.

**Reach is not additive.** Daily reach can't be added into weekly reach, because the same person
can be reached on several days. Weekly or monthly reach will only be shown where the platform
reports it for that period.

## 3. Comparability classes

Each platform metric maps to a Scopie metric and a comparability class (`PLATFORM_METRIC_MAP`,
mirrored in `platform_metric_map`):

- Instagram and Facebook reach share the class `meta_reach`, so they can be compared.
- Followers on any platform share `audience_size`.
- Facebook reactions (`fb_reactions`) and Instagram likes (`likes`) are different classes.
- A metric with no mapping, such as an imported LinkedIn impression, gets the class
  `<platform>:<metric>` and is only compared within that platform.

## 4. Snapshots

Post metrics are lifetime totals captured at a point in time. Each snapshot stores `post_age_hours`,
and the `post_metrics_at_age` view finds the snapshot closest to a given age (within 15%, at least
6 hours), so posts are compared at the same age rather than "whatever was last read".

Account metrics are daily values dated in the platform's reporting timezone. Followers is a running
total dated the day it was read.
