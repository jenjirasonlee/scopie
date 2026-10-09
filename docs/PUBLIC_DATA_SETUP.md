# Scopie — Setting up public data

> A step-by-step guide for marketers, no coding needed. Last updated: 2026-10-07

This guide sets Scopie up to follow public Instagram profiles, such as competitors, industry accounts
and creators. The profiles you track don't approve anything and never know you follow them in
Scopie.

You do this once. After that, adding a competitor takes a username and one click.

## What you need

| You need                                              | Why                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| A personal Facebook account                           | To create the Meta app and to log in when you connect Scopie             |
| A Meta developer app (step 1)                         | Meta only lets approved apps read Instagram data                         |
| A Facebook Page you manage (step 2)                   | Meta requires the viewer account to be linked to a Page                  |
| An Instagram professional account: the viewer account | Meta sends every request through one Instagram account of yours (step 2) |
| An owner or admin role in your Scopie organization    | Only owners and admins can connect accounts and add profiles             |
| Someone who runs the Scopie server                    | They enter the app's ID and secret on the server (step 1)                |

**The viewer account doesn't need to be a CANNA brand account.** It can be any Instagram business or
creator account you control, for example a small research account for the marketing team. You don't
need admin access to CANNA's Meta Business portfolio. It must be a real account that you run
properly under Instagram's terms, not a fake persona.

## Step 1. Create a Meta developer app

1. Go to [developers.facebook.com](https://developers.facebook.com/) and log in with your Facebook
   account. If asked, register as a developer.
2. Choose **My Apps → Create app**, and pick the **Business** app type. Connect it to a business
   portfolio if Meta asks.
3. Add the product **Facebook Login for Business**.
4. In its settings, add the web address Scopie gives you under _Valid OAuth Redirect URIs_. It ends in
   `/api/connections/meta/callback`. Ask whoever runs Scopie for the exact address.
5. Open **App settings → Basic**. You'll see the **App ID** and the **App secret**.
6. Give both to the person who runs the Scopie server, through a password manager or another safe
   channel. **Never paste the App secret in email, chat or a shared document.** They put them on the
   server as `META_APP_ID` and `META_APP_SECRET`.

Meta's screens change often. If something looks different, follow Meta's current wording. The
technical version of this step is in [API_INTEGRATIONS.md](API_INTEGRATIONS.md) §4.

Because you created the app, you have a role on it (admin). That matters for step 6.

## Step 2. Prepare the viewer account

1. **Pick or create an Instagram account** for the viewer. It can be an existing account you manage
   or a new one.
2. **Make it a professional account.** In the Instagram app's settings, switch the account to a
   professional account, type Business or Creator.
3. **Link it to a Facebook Page you manage.** If you don't have a Page, create one on Facebook first.
   Then link the Instagram account to the Page (Instagram settings → Accounts Center).

## Step 3. Connect it in Scopie

1. In Scopie, open **Settings → Connections**.
2. Click **Connect with Meta**.
3. Log in as the Facebook user who manages the Page from step 2, and approve the permissions. Scopie
   only reads data; it never posts or changes anything.
4. Back in Scopie, the Instagram account from step 2 appears in the list of accounts found.

If it doesn't appear, check that the Instagram account is professional and linked to the Page, and
that you logged in as someone who manages that Page.

## Step 4. Choose it in Settings → Public data

1. Open **Settings → Public data**.
2. Under **Viewer account**, choose the Instagram account and click **Use this account**.
3. The badge changes to **Active**.

From now on, Scopie reads public profiles through this account. You can change it or stop it on the
same page.

## Step 5. Add competitor profiles

**One profile at a time:**

1. Open **Accounts → Add profile**.
2. Under **Public Instagram profile**, type the username (with or without `@`, or paste the profile
   link) and click **Preview**.
3. Scopie shows the profile's name, followers and post count, and what it can and can't track.
4. Choose **Why you track it** (Own profile, Competitor, Industry, Influencer / creator, Other) and,
   if you like, a country.
5. Click **Start tracking**.

**Many at once:** on the same page, under **Add several Instagram profiles**, paste one username per
line, or upload a CSV file. You can add a country code after a comma, for example `hydro_rival,NL`.
Choose why you track them and click **Add all**. Up to 200 at a time. No preview is made; each
profile is checked on its first sync.

**What happens next:** the first observation happens on the next sync, usually within 15 minutes.
Then Scopie:

- records followers and post count once a day;
- re-reads recent posts every 3 hours, so each post's likes and comments are measured as it ages;
- reads back up to 12 months of older posts once.

The profile page says how much history exists, for example "Observed since 7 Oct 2026; posts complete
back to 3 Mar 2025."

## What can and can't be tracked

| Scopie tracks                                   | Scopie can't track                            |
| ----------------------------------------------- | --------------------------------------------- |
| Followers, from the day you add the profile     | Follower history before you added it          |
| Number of posts on the profile                  | Reach, impressions, saves and shares          |
| Bio and website, with changes recorded          | Audience demographics                         |
| Posts: link, caption, date, format and hashtags | Stories                                       |
| Likes per post, unless the owner hides them     | Comment text                                  |
| Comments per post                               | Following count                               |
| Views on Reels (these include paid views)       | Personal accounts and age-restricted accounts |

Some things to know:

- **Only business and creator accounts can be read.** If Instagram can't find the username as one,
  Scopie says so. You can still add data for it by CSV import.
- **Hidden likes show as "hidden by owner"**, never as zero.
- **History starts the day you add a profile.** Scopie never fills in days it didn't observe.
- **Reel views include paid views**, so Scopie never compares them with view numbers from your own
  connected accounts.
- **Removing a profile** (on its page, **Remove profile and data**, then type DELETE) deletes
  everything Scopie stored about it, as Meta's terms require. It can't be undone.

## Limits

Meta limits how many requests an app makes per hour. Scopie:

- pauses public reads when Meta reports 80% of the hourly limit used, and resumes within the hour;
- allows 30 add-profile previews per organization per hour. You can still add a profile without a
  preview.

About 30 profiles fit comfortably inside the limit.

## Meta access level: please read

Meta apps have two access levels, **Standard Access** and **Advanced Access**.

- With Standard Access, an app works for people who have a role on the app (admin, developer,
  tester). You have that role because you created the app.
- **It is not yet certain** whether Standard Access is enough to look up competitor accounts, which
  have no role on your app. Meta's documentation suggests it is, because the request runs through
  your own viewer account. This will be confirmed on the first live test.
- If it turns out not to be enough, the app needs **Advanced Access**, which means Meta's **App
  Review** and possibly **Business Verification**. That takes extra time and is done in the Meta
  developer dashboard.
- A Scopie installation that serves other companies would need Advanced Access in any case.

Meta's own pages:

- [Business Discovery reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)
- [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)

## If something goes wrong

| What you see                                                       | What to do                                                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| "Reading public profiles isn't set up on this server yet"          | The server doesn't have the Meta app's ID and secret yet. Ask whoever runs Scopie (step 1).                          |
| "No Instagram professional account is connected yet"               | Do step 3 first.                                                                                                     |
| "Choose a viewer account in Settings → Public data first"          | Do step 4.                                                                                                           |
| The viewer account shows **Needs reconnect**                       | Meta stopped accepting its login (for example after a password change). Do step 3 again with the same Facebook user. |
| "Instagram has no business or creator account …"                   | Check the spelling. Personal and age-restricted accounts can't be read.                                              |
| "Your organization has used its 30 profile previews for this hour" | Add the profile without a preview, or wait an hour.                                                                  |
| A profile's sync says the username belongs to a different account  | The username was taken over by someone else. Check the username; Scopie stored nothing for it.                       |

Before using Scopie for competitor monitoring at CANNA, a short legal or privacy check is
recommended.
