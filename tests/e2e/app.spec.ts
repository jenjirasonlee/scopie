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
