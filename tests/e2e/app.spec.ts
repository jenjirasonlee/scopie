import { expect, test, type Page } from '@playwright/test';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  TEST_PASSWORD,
  uniqueEmail,
} from '../support/supabase';
import { utcToZonedParts } from '../../lib/calendar/time';

// End-to-end flows against the real app and a real Supabase stack.
// Form fields are located by id: Next.js keeps recently visited pages mounted (hidden),
// so label lookups can match fields on a previous page.
test.describe.configure({ mode: 'serial' });
test.afterAll(cleanup);

async function signIn(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => url.pathname !== '/sign-in');
}

test('signed-out visitors are sent to sign-in and back after signing in', async ({ page }) => {
  const user = await createUser('e2e-redirect');
  const org = await createOrg(user, 'Redirect Org');

  await page.goto(`/${org.slug}/accounts`);
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=%2F${org.slug}%2Faccounts`));

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(user.email);

  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/${org.slug}/accounts$`));
});

test('sign up, create an organization, manage accounts, sign out', async ({ page }) => {
  const email = uniqueEmail('e2e-signup');

  await page.goto('/sign-up');
  await page.getByLabel('Full name').fill('Jen Tester');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('a-strong-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('Organization name').fill('E2E Marketing Team');
  await expect(page.getByLabel('URL')).toHaveValue('e2e-marketing-team');
  const slug = `e2e-${Date.now().toString(36)}`;
  await page.getByLabel('URL').fill(slug);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page).toHaveURL(new RegExp(`/${slug}/dashboard$`));
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  // A new organization gets an honest empty state, not demo charts.
  await expect(page.getByText('No profiles to monitor yet')).toBeVisible();

  // Empty state, then a validation error that keeps what was typed.
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByText('No social accounts yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Add your first account' }).click();
  await page.locator('#handle:visible').fill('@canna_de_e2e');
  await page.getByRole('button', { name: 'Add profile' }).click();
  await expect(page.locator('#platformKey-error:visible')).toHaveText('Choose a platform');
  await expect(page.locator('#handle:visible')).toHaveValue('@canna_de_e2e');

  await page.locator('#platformKey:visible').selectOption('instagram');
  await page.locator('#displayName:visible').fill('CANNA Germany E2E');
  await page.locator('#countryCode:visible').selectOption('DE');
  await page.locator('#language:visible').fill('de');
  await page.getByRole('button', { name: 'Add profile' }).click();

  await expect(page).toHaveURL(new RegExp(`/${slug}/accounts\\?created=1`));
  const row = page.getByRole('row', { name: /CANNA Germany E2E/ });
  await expect(row).toContainText('@canna_de_e2e');
  await expect(row).toContainText('Germany');
  // An unconnected Instagram profile is read as a public profile.
  await expect(row).toContainText('PUBLIC');
  await expect(row).toContainText('Not yet');

  // Edit: change the country.
  await row.getByRole('link', { name: 'Edit' }).click();
  await page.locator('#countryCode:visible').selectOption('AT');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Account saved.')).toBeVisible();
  await page.goto(`/${slug}/accounts`);
  await expect(page.getByRole('row', { name: /CANNA Germany E2E/ })).toContainText('Austria');

  // Deactivate: disappears from the default (active) view, shows under "All statuses".
  await page
    .getByRole('row', { name: /CANNA Germany E2E/ })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(
    page
      .getByText('No social accounts yet.')
      .or(page.getByText('No accounts match these filters.')),
  ).toBeVisible();
  await page.goto(`/${slug}/accounts?status=all`);
  const inactive = page.getByRole('row', { name: /CANNA Germany E2E/ });
  await expect(inactive).toContainText('Inactive');
  await inactive.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByRole('row', { name: /CANNA Germany E2E/ })).toContainText('Active');

  // Placeholder modules say so plainly.
  await page.getByRole('link', { name: /Analytics/ }).click();
  await expect(page.getByText('Coming in a future phase.')).toBeVisible();

  // Sign out, then protected pages redirect to sign-in.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto(`/${slug}/dashboard`);
  await expect(page).toHaveURL(/\/sign-in\?next=/);

  // Tidy up the user created through the UI.
  const { data } = await adminClient().from('profiles').select('id').eq('email', email).single();
  await adminClient().from('organizations').delete().eq('slug', slug);
  if (data) await adminClient().auth.admin.deleteUser(data.id);
});

test('viewers get a read-only accounts page', async ({ page }) => {
  const owner = await createUser('e2e-owner');
  const viewer = await createUser('e2e-viewer');
  const org = await createOrg(owner, 'Viewer Org');
  await addMember(org.id, viewer, 'VIEWER');
  await owner.client
    .from('social_accounts')
    .insert({ organization_id: org.id, platform_key: 'facebook', display_name: 'Visible account' });

  await signIn(page, viewer.email);
  await page.goto(`/${org.slug}/accounts`);
  await expect(page.getByRole('row', { name: /Visible account/ })).toBeVisible();
  await expect(page.getByText('You have read-only access to accounts.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add profile' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);

  await page.goto(`/${org.slug}/accounts/new`);
  await expect(page.getByText('Only owners and admins can add profiles.')).toBeVisible();
});

test('members of one organization get a 404 for another', async ({ page }) => {
  const alice = await createUser('e2e-alice');
  const bob = await createUser('e2e-bob');
  await createOrg(alice, 'Alice E2E');
  const bobOrg = await createOrg(bob, 'Bob E2E');

  await signIn(page, alice.email);
  await expect(page).toHaveURL(/\/dashboard$/);
  // The membership check streams in behind Suspense, so the HTTP status is already sent;
  // what matters is that the not-found page renders and nothing of Bob's organization leaks.
  await page.goto(`/${bobOrg.slug}/accounts`);
  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Bob E2E');
});

test('import a CSV of posts and see them, labelled Imported, on the account page', async ({
  page,
}) => {
  const user = await createUser('e2e-import');
  const org = await createOrg(user, 'Import Org');
  const { data: account } = await user.client
    .from('social_accounts')
    .insert({
      organization_id: org.id,
      platform_key: 'linkedin',
      display_name: 'CANNA LinkedIn Test',
    })
    .select('id')
    .single();

  await signIn(page, user.email);
  await page.goto(`/${org.slug}/accounts/import`);
  await page.locator('#accountId:visible').selectOption(account!.id);
  await page.locator('#kind:visible').selectOption('posts');
  await page.locator('#file:visible').setInputFiles({
    name: 'linkedin-export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Post link,Created date,Post type,Impressions,Reactions\n' +
        'https://www.linkedin.com/feed/update/urn:li:share:1,2026-09-01,Image,4210,96\n' +
        'bad-row,not a date,Image,1,1\n',
    ),
  });
  await page.getByRole('button', { name: 'Import' }).click();
  const result = page.getByTestId('import-result');
  await expect(result).toContainText('Imported 1 of 2 rows');
  await expect(result).toContainText('Row 3');

  await page.reload();
  await expect(page.getByRole('cell', { name: 'linkedin-export.csv' })).toBeVisible();

  await page.goto(`/${org.slug}/accounts/${account!.id}`);
  await expect(page.getByText('Imported', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Impressions')).toBeVisible();
  await expect(page.getByText('4,210')).toBeVisible();
});

test('connections page explains what is missing instead of offering a broken button', async ({
  page,
}) => {
  const user = await createUser('e2e-connections');
  const org = await createOrg(user, 'Connections Org');
  await signIn(page, user.email);
  await page.goto(`/${org.slug}/settings/connections`);
  await expect(page.getByText('pages_read_engagement')).toBeVisible();
  // The test environment has no Meta app configured.
  await expect(page.getByText(/isn.t set up on this server yet/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect with Meta' })).toHaveCount(0);
});

test('public profiles: viewer setup explained, bulk add, observed history, remove with data', async ({
  page,
}) => {
  const user = await createUser('e2e-public');
  const org = await createOrg(user, 'Public Data Org');
  await signIn(page, user.email);

  await page.goto(`/${org.slug}/settings/public-data`);
  await expect(page.getByText('viewer account').first()).toBeVisible();
  await expect(page.getByText(/No Instagram professional account is connected yet/)).toBeVisible();

  // Without a viewer, profiles can be added but previews are off.
  await page.goto(`/${org.slug}/accounts/new`);
  await expect(page.getByRole('link', { name: 'choose a viewer account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
  await page.locator('#bulk-handles:visible').fill('rival_one_e2e,NL\n@rival_two_e2e\nnot valid!');
  await page.getByRole('button', { name: 'Add all' }).click();
  await expect(page.getByText(/Added 2 profiles, skipped 1/)).toBeVisible();
  await expect(page.getByText('not valid!: not a valid username')).toBeVisible();

  await page.goto(`/${org.slug}/accounts`);
  const row = page.getByRole('row', { name: /rival_one_e2e/ });
  await expect(row).toContainText('Competitor');
  await expect(row).toContainText('PUBLIC');
  await expect(row).toContainText('Netherlands');

  // Store two observations as the sync would, then check what the profile page shows.
  const admin = adminClient();
  const { data: account } = await admin
    .from('social_accounts')
    .select('id')
    .eq('organization_id', org.id)
    .eq('handle', 'rival_one_e2e')
    .single();
  const observe = (day: string, value: number) => ({
    organization_id: org.id,
    social_account_id: account!.id,
    metric_key: 'followers',
    source_metric: 'business_discovery.followers_count',
    value,
    availability: 'available' as const,
    period: 'lifetime' as const,
    metric_date: day,
    captured_at: `${day}T06:00:00Z`,
    data_source: 'live_public' as const,
  });
  await admin
    .from('account_metric_snapshots')
    .insert([observe('2026-09-07', 20400), observe('2026-10-07', 21300)]);
  await admin
    .from('social_accounts')
    .update({ first_observed_at: '2026-09-07T06:00:00Z', last_observed_at: '2026-10-07T06:00:00Z' })
    .eq('id', account!.id);
  const { data: post } = await admin
    .from('posts')
    .insert({
      organization_id: org.id,
      social_account_id: account!.id,
      platform_key: 'instagram',
      external_id: 'e2e-rival-post',
      published_at: '2026-10-01T10:00:00Z',
      published_local_date: '2026-10-01',
      caption: 'Rival launch',
      media_format: 'image',
      data_source: 'live_public',
    })
    .select('id')
    .single();
  await admin.from('post_metric_snapshots').insert({
    organization_id: org.id,
    post_id: post!.id,
    metric_key: 'likes',
    source_metric: 'business_discovery.like_count',
    value: null,
    availability: 'hidden_by_owner',
    period: 'lifetime',
    captured_at: '2026-10-02T06:00:00Z',
    post_age_hours: 0,
    data_source: 'live_public',
  });

  await page.goto(`/${org.slug}/accounts/${account!.id}`);
  await expect(page.getByText(/Observed since 07\/09\/2026/)).toBeVisible();
  await expect(page.getByText('+4.4% observed growth')).toBeVisible();

  // The dashboard shows the same observed growth from stored observations only.
  await page.goto(`/${org.slug}/dashboard?range=90`);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('No profiles to monitor yet')).toHaveCount(0);
  await page.goto(`/${org.slug}/accounts/${account!.id}`);
  await expect(page.getByText('hidden by owner')).toBeVisible();

  // Removing needs the word DELETE, then deletes the profile and its data.
  await page.getByRole('button', { name: 'Remove profile and data' }).click();
  await expect(page.getByText('Type DELETE to confirm.')).toBeVisible();
  await page.locator('#remove-confirm:visible').fill('DELETE');
  await page.getByRole('button', { name: 'Remove profile and data' }).click();
  await expect(page).toHaveURL(new RegExp(`/${org.slug}/accounts\\?removed=1`));
  const { count } = await admin
    .from('account_metric_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('social_account_id', account!.id);
  expect(count).toBe(0);
});

test('YouTube channels without OAuth, ranked in benchmarks only on what was observed', async ({
  page,
}) => {
  const user = await createUser('e2e-bench');
  const org = await createOrg(user, 'Benchmark Org');
  await signIn(page, user.email);

  // YouTube needs only a server API key; CI has none, so settings says so.
  await page.goto(`/${org.slug}/settings/public-data`);
  await expect(page.getByText('API key missing')).toBeVisible();
  // Every platform says plainly whether its public data can be read, and why not.
  await expect(page.getByText('Key not set')).toBeVisible();
  await expect(
    page.getByText('TikTok has no official way to read other accounts’ public numbers.'),
  ).toBeVisible();
  await expect(
    page.getByText('CSV import works for every platform, including those without public data.'),
  ).toBeVisible();

  await page.goto(`/${org.slug}/accounts/new`);
  await page.locator('#bulk-platform:visible').selectOption('youtube');
  await page
    .locator('#bulk-handles:visible')
    .fill('@growchannel_e2e,NL\nhttps://www.youtube.com/@otherchannel-e2e');
  await page.getByRole('button', { name: 'Add all' }).click();
  await expect(page.getByText(/Added 2 profiles/)).toBeVisible();

  // Two observations for one channel, none for the other.
  const admin = adminClient();
  const { data: channels } = await admin
    .from('social_accounts')
    .select('id, handle, platform_key, access_type')
    .eq('organization_id', org.id)
    .order('handle');
  expect(channels).toMatchObject([
    { handle: 'growchannel_e2e', platform_key: 'youtube', access_type: 'public' },
    { handle: 'otherchannel-e2e', platform_key: 'youtube', access_type: 'public' },
  ]);
  const day = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const observe = (date: string, value: number) => ({
    organization_id: org.id,
    social_account_id: channels![0]!.id,
    metric_key: 'followers',
    source_metric: 'statistics.subscriberCount',
    value,
    availability: 'available' as const,
    period: 'lifetime' as const,
    metric_date: date,
    captured_at: `${date}T06:00:00Z`,
    data_source: 'live_public' as const,
  });
  await admin
    .from('account_metric_snapshots')
    .insert([observe(day(20), 20000), observe(day(2), 21000)]);
  await admin
    .from('social_accounts')
    .update({ first_observed_at: `${day(20)}T06:00:00Z`, last_observed_at: `${day(2)}T06:00:00Z` })
    .eq('id', channels![0]!.id);

  await page.goto(`/${org.slug}/benchmarks?platform=youtube&range=30`);
  await expect(page.getByText(/Ranked by observed follower growth.*YouTube only/)).toBeVisible();
  await expect(page.getByText('Not ranked')).toBeVisible();
  await expect(page.getByText('not enough observations').first()).toBeVisible();

  // Benchmark groups.
  await page.goto(`/${org.slug}/benchmarks/groups`);
  await page.locator('input[name="name"]:visible').first().fill('Dutch channels');
  await page.getByRole('button', { name: /Create/ }).click();
  await expect(page.getByText('Dutch channels').first()).toBeVisible();
});

test('create content with a file and a pillar, and see it on the calendar', async ({ page }) => {
  const user = await createUser('e2e-content');
  const org = await createOrg(user, 'Content Org');
  await signIn(page, user.email);

  // A content pillar to tag it with.
  await page.goto(`/${org.slug}/settings/taxonomy`);
  await page.locator('#new-pillars-name:visible').fill('Grow knowledge');
  await page.getByRole('button', { name: /Add pillar/i }).click();
  await expect(page.getByRole('button', { name: 'Deactivate Grow knowledge' })).toBeVisible();

  // Plan it three days from now, in the organization's time zone.
  const { date } = utcToZonedParts(new Date(Date.now() + 3 * 86_400_000), org.default_timezone);
  await page.goto(`/${org.slug}/content/new`);
  await page.locator('#title:visible').fill('Autumn feeding tips reel');
  await page.locator('input[name="platformKeys"][value="instagram"]:visible').check();
  await page.locator('#plannedDate:visible').fill(date);
  await page.locator('#plannedTime:visible').fill('10:30');
  await page.locator('#pillarId:visible').selectOption({ label: 'Grow knowledge' });
  await page.locator('#caption:visible').fill('Feed little and often #hydro');
  await page.getByRole('button', { name: /Create|Save/ }).click();
  await page.waitForURL(/\/content\/[0-9a-f-]{36}/);
  const itemUrl = new URL(page.url());

  // Upload a tiny PNG to version 1.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await page
    .locator('#content-files:visible')
    .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('File added.')).toBeVisible();
  await expect(page.getByText('cover.png').first()).toBeVisible();
  const src = await page.locator('img[alt="cover.png"]').getAttribute('src');
  const file = await page.request.get(src!);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('image/png');

  // A file that only claims to be an image is refused.
  await page.locator('#content-files:visible').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /fake\.png/ })).toBeVisible();

  // On the calendar, on the planned day, and its details open in a panel.
  await page.goto(`/${org.slug}/calendar?view=month&date=${date}`);
  await page
    .getByRole('link', { name: /Autumn feeding tips reel/ })
    .first()
    .click();
  const panel = page.locator('aside[aria-labelledby="item-panel-title"]');
  await expect(panel.getByText('Autumn feeding tips reel')).toBeVisible();
  await expect(panel.getByText(/10:30/)).toBeVisible();
  await expect(panel.getByText('1 file')).toBeVisible();
  await expect(panel.getByText('Grow knowledge')).toBeVisible();

  // Archived content leaves the calendar but is kept.
  await page.goto(itemUrl.pathname);
  await page.getByRole('button', { name: /Archive/ }).click();
  await page.goto(`/${org.slug}/calendar?view=month&date=${date}`);
  await expect(page.getByRole('link', { name: /Autumn feeding tips reel/ })).toHaveCount(0);
});

test('submit for review, request changes with a mention, resubmit, approve', async ({
  browser,
}) => {
  const editor = await createUser('e2e-author', 'Ana Author');
  const manager = await createUser('e2e-reviewer', 'Rob Reviewer');
  const org = await createOrg(editor, 'Review Org');
  await addMember(org.id, manager, 'MANAGER');
  const { data: item, error } = await editor.client
    .from('content_items')
    .insert({ organization_id: org.id, title: 'Winter care reel', platform_keys: ['instagram'] })
    .select('id')
    .single();
  if (error) throw error;
  await editor.client
    .from('content_versions')
    .update({ caption: 'Keep roots warm' })
    .eq('content_item_id', item.id);
  const itemPath = `/${org.slug}/content/${item.id}`;

  const authorPage = await (await browser.newContext()).newPage();
  const reviewerPage = await (await browser.newContext()).newPage();

  // The author submits; the version locks.
  await signIn(authorPage, editor.email);
  await authorPage.goto(itemPath);
  await authorPage.locator('#review-note:visible').fill('Check the hashtags');
  await authorPage.getByRole('button', { name: 'Submit version 1 for review' }).click();
  await expect(authorPage.getByText(/Submitted for review/).first()).toBeVisible();
  await expect(authorPage.getByRole('button', { name: 'Withdraw' })).toBeVisible();

  // The reviewer is notified and finds it in the queue.
  await signIn(reviewerPage, manager.email);
  await reviewerPage.goto(`/${org.slug}/approvals`);
  await expect(reviewerPage.getByRole('link', { name: 'Notifications, 1 unread' })).toBeVisible();
  await reviewerPage.getByRole('link', { name: 'Winter care reel' }).click();
  await reviewerPage.waitForURL(new RegExp(item.id));

  // Asking for changes needs a comment.
  await reviewerPage.getByRole('button', { name: 'Request changes' }).click();
  await expect(reviewerPage.getByText(/Say what needs to change/).first()).toBeVisible();
  await reviewerPage.locator('#review-comment:visible').fill('Add the product name');
  await reviewerPage.getByRole('button', { name: 'Request changes' }).click();
  await expect(reviewerPage.getByText(/Changes requested/).first()).toBeVisible();

  // A comment mentioning the author.
  await reviewerPage.locator('#comment-body:visible').fill('Happy to look again today');
  await reviewerPage.locator('summary:visible', { hasText: 'Mention people' }).first().click();
  await reviewerPage.getByRole('checkbox', { name: 'Ana Author' }).first().check();
  await reviewerPage.getByRole('button', { name: 'Add comment' }).click();
  await expect(reviewerPage.getByText('Happy to look again today').first()).toBeVisible();

  // The author sees both in notifications, starts version 2 and resubmits.
  await authorPage.goto(`/${org.slug}/notifications`);
  await expect(authorPage.getByText(/asked for changes to/).first()).toBeVisible();
  await expect(authorPage.getByText(/mentioned you on/).first()).toBeVisible();
  await authorPage.goto(itemPath);
  await expect(authorPage.getByText('Add the product name').first()).toBeVisible();
  await authorPage.getByRole('button', { name: 'Start version 2' }).first().click();
  await authorPage.waitForURL(/versioned=1/);
  await authorPage.locator('#caption:visible').fill('Keep roots warm with CANNA');
  await authorPage.getByRole('button', { name: /^Save/ }).first().click();
  await expect(authorPage.getByText('Saved.').first()).toBeVisible();
  await authorPage.getByRole('button', { name: 'Submit version 2 for review' }).click();
  await expect(authorPage.getByRole('button', { name: 'Withdraw' })).toBeVisible();

  // The reviewer approves; the history keeps both decisions.
  await reviewerPage.goto(itemPath);
  await reviewerPage.getByRole('button', { name: 'Approve' }).click();
  await expect(reviewerPage.getByText('Approved.').first()).toBeVisible();
  await reviewerPage.reload();
  await expect(reviewerPage.getByText(/Asked for changes to version 1/).first()).toBeVisible();
  await expect(reviewerPage.getByText(/Approved version 2/).first()).toBeVisible();
});

test('plan a strategy with a pillar target and an objective, and see content count toward it', async ({
  page,
}) => {
  const user = await createUser('e2e-strategy');
  const org = await createOrg(user, 'Strategy Org');
  await signIn(page, user.email);

  await page.goto(`/${org.slug}/settings/taxonomy`);
  await page.locator('#new-pillars-name:visible').fill('Grow knowledge');
  await page.getByRole('button', { name: /Add pillar/i }).click();
  await expect(page.getByRole('button', { name: 'Deactivate Grow knowledge' })).toBeVisible();

  // New strategies start as drafts for the current quarter.
  await page.goto(`/${org.slug}/strategy/new`);
  await page.locator('#new-strategy-name:visible').fill('Autumn plan');
  await page.getByRole('button', { name: 'Create strategy' }).click();
  await page.waitForURL(/\/strategy\/[0-9a-f-]{36}/);
  const strategyUrl = page.url();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();

  await page.locator('summary', { hasText: 'Add an objective' }).click();
  await page.locator('#new-objective-name:visible').fill('Publish four pieces');
  await page.locator('#new-objective-targetValue:visible').fill('4');
  await page.getByRole('button', { name: 'Add objective' }).click();
  await expect(page.getByText('0 of 4 published')).toBeVisible();

  await page.locator('summary', { hasText: 'Set pillar targets' }).click();
  await page.getByLabel('Grow knowledge').fill('60');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByText('60% of content has a pillar target')).toBeVisible();
  await expect(page.getByText('No content is planned for this period yet.')).toBeVisible();

  // Content planned today, on the pillar and the objective, counts toward both.
  const { date } = utcToZonedParts(new Date(), org.default_timezone);
  await page.goto(`/${org.slug}/content/new`);
  await page.locator('#title:visible').fill('Feeding basics');
  await page.locator('input[name="platformKeys"][value="instagram"]:visible').check();
  await page.locator('#plannedDate:visible').fill(date);
  await page.locator('#plannedTime:visible').fill('12:00');
  await page.locator('#pillarId:visible').selectOption({ label: 'Grow knowledge' });
  await page.locator('#strategyObjectiveId:visible').selectOption({ label: 'Publish four pieces' });
  await page.getByRole('button', { name: /Create|Save/ }).click();
  await page.waitForURL(/\/content\/[0-9a-f-]{36}/);
  await expect(page.locator('#strategyObjectiveId:visible')).toHaveValue(/[0-9a-f-]{36}/);

  await page.goto(strategyUrl);
  await expect(page.getByText('1 item: 0 published, 1 planned.')).toBeVisible();
  await expect(page.getByText('100% of 60%')).toBeVisible();
  // Planned content isn't published, so the objective still reads 0.
  await expect(page.getByText('0 of 4 published')).toBeVisible();
});

test('managers run an analysis without an AI key; viewers read it', async ({ browser }) => {
  const manager = await createUser('e2e-analyst');
  const viewer = await createUser('e2e-reader');
  const org = await createOrg(manager, 'Insights Org');
  await addMember(org.id, viewer, 'VIEWER');

  const managerPage = await (await browser.newContext()).newPage();
  await signIn(managerPage, manager.email);
  await managerPage.goto(`/${org.slug}/insights`);
  await expect(managerPage.getByRole('heading', { name: 'No analysis yet' })).toBeVisible();
  await managerPage.getByRole('button', { name: 'Run analysis' }).click();
  await expect(
    managerPage.getByText(/Written from your numbers by Scopie’s own rules/),
  ).toBeVisible();
  // A new organization has no data, so nothing is reported, and nothing is made up.
  await expect(managerPage.getByText(/Nothing stood out enough in this period/)).toBeVisible();
  // Runs are spaced out.
  await managerPage.getByRole('button', { name: 'Run analysis again' }).click();
  await expect(managerPage.getByText(/less than 2 minutes ago/)).toBeVisible();

  const viewerPage = await (await browser.newContext()).newPage();
  await signIn(viewerPage, viewer.email);
  await viewerPage.goto(`/${org.slug}/insights`);
  await expect(
    viewerPage.getByText(/Written from your numbers by Scopie’s own rules/),
  ).toBeVisible();
  await expect(viewerPage.getByRole('button', { name: /Run analysis/ })).toHaveCount(0);
});

test('managers make last week’s report; viewers are told and read it', async ({ browser }) => {
  const manager = await createUser('e2e-reporter');
  const viewer = await createUser('e2e-report-reader');
  const org = await createOrg(manager, 'Reports Org');
  await addMember(org.id, viewer, 'VIEWER');

  const managerPage = await (await browser.newContext()).newPage();
  await signIn(managerPage, manager.email);
  await managerPage.goto(`/${org.slug}/reports`);
  await managerPage.getByRole('button', { name: 'Make last week’s report' }).click();
  await expect(managerPage).toHaveURL(new RegExp(`/${org.slug}/reports/[0-9a-f-]{36}$`));
  await expect(managerPage.getByRole('heading', { name: /^Weekly report, / })).toBeVisible();
  // A new organization has no profiles: numbers say N/A with a reason, never 0.
  await expect(managerPage.getByText('Nothing to report: no own profiles to rank.')).toBeVisible();
  await expect(managerPage.getByText('N/A').first()).toBeVisible();
  const reportUrl = managerPage.url();

  const viewerPage = await (await browser.newContext()).newPage();
  await signIn(viewerPage, viewer.email);
  await viewerPage.goto(`/${org.slug}/notifications`);
  await viewerPage.getByText(/Weekly report for .* is ready/).click();
  await expect(viewerPage).toHaveURL(reportUrl);
  await viewerPage.goto(`/${org.slug}/reports`);
  await expect(viewerPage.getByRole('button', { name: 'Make last week’s report' })).toHaveCount(0);
  await expect(
    viewerPage.getByRole('link', { name: /Weekly report, |Sept|Oct/ }).first(),
  ).toBeVisible();
});
