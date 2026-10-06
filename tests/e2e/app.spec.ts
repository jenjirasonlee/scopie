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
  await expect(
    page.getByText('Performance analytics aren’t available yet'.replace('’', "'")),
  ).toBeVisible();

  // Empty state, then a validation error that keeps what was typed.
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByText('No social accounts yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Add your first account' }).click();
  await page.locator('#handle:visible').fill('@canna_de_e2e');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.locator('#platformKey-error:visible')).toHaveText('Choose a platform');
  await expect(page.locator('#handle:visible')).toHaveValue('@canna_de_e2e');

  await page.locator('#platformKey:visible').selectOption('instagram');
  await page.locator('#displayName:visible').fill('CANNA Germany E2E');
  await page.locator('#countryCode:visible').selectOption('DE');
  await page.locator('#language:visible').fill('de');
  await page.getByRole('button', { name: 'Add account' }).click();

  await expect(page).toHaveURL(new RegExp(`/${slug}/accounts\\?created=1`));
  const row = page.getByRole('row', { name: /CANNA Germany E2E/ });
  await expect(row).toContainText('@canna_de_e2e');
  await expect(row).toContainText('Germany');
  await expect(row).toContainText('Not connected');
  await expect(row).toContainText('Never');

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
  await expect(page.getByRole('link', { name: 'Add account' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);

  await page.goto(`/${org.slug}/accounts/new`);
  await expect(page.getByText('Only owners and admins can add social accounts.')).toBeVisible();
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
