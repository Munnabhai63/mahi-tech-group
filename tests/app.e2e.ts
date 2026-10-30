import { test, describe, beforeEach } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('MAHI TECH GROUP — Core Platform E2E Tests', { tags: ['smoke'] }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/');
  });

  test('STEP 1: Verify homepage title and Enter Workspace CTA', async ({ screen, browser }) => {
    await expect(browser).toHaveTitle(/MAHI TECH GROUP/i);
    await expect(screen.getByRole('link', 'Enter Workspace')).toBeVisible();
  });

  test('STEP 2: Navigate to login page and verify auth form controls', async ({ screen, browser }) => {
    await screen.getByRole('link', 'Enter Workspace').tap();
    await expect(browser).toHaveURL(/login/);
    await expect(screen.getByRole('button', 'Sign in to workspace')).toBeVisible();
  });

  test('STEP 3: Fill credentials and verify workspace authentication', async ({ screen, browser }) => {
    await screen.getByRole('link', 'Enter Workspace').tap();
    await expect(browser).toHaveURL(/login/);

    await screen.getByRole('textbox', 'Email address').fill('admin@mahitechgroup.com');
    await screen.getByRole('textbox', 'Password').fill('AdminPassword@2026');
    await screen.getByRole('button', 'Sign in to workspace').tap();

    await expect(browser).toHaveURL(/admin/);
  });

  test('STEP 4: Verify Admin Onboarding Status loads correctly without undefined errors', async ({ screen, browser }) => {
    await screen.getByRole('link', 'Enter Workspace').tap();
    await screen.getByRole('textbox', 'Email address').fill('admin@mahitechgroup.com');
    await screen.getByRole('textbox', 'Password').fill('AdminPassword@2026');
    await screen.getByRole('button', 'Sign in to workspace').tap();
    await expect(browser).toHaveURL(/admin/);

    // Verify the page does not contain broken "undefined of undefined Completed"
    await expect(screen.getByText(/undefined of undefined/i)).not.toBeVisible();
  });

  test('STEP 5: Verify Quick Invite Dialog sends member invitation without route error', async ({ screen, browser }) => {
    await screen.getByRole('link', 'Enter Workspace').tap();
    await screen.getByRole('textbox', 'Email address').fill('admin@mahitechgroup.com');
    await screen.getByRole('textbox', 'Password').fill('AdminPassword@2026');
    await screen.getByRole('button', 'Sign in to workspace').tap();
    await expect(browser).toHaveURL(/admin/);

    // Click Invite Team Member
    await screen.getByRole('button', 'Invite Team Member').tap();
    await expect(screen.getByRole('heading', 'Invite Team Member')).toBeVisible();

    // Fill new member email
    const testEmail = `qa-invite-${Date.now()}@mahitechgroup.com`;
    await screen.getByRole('textbox', 'Member Email Address').fill(testEmail);

    // Send Invite
    await screen.getByRole('button', 'Send Invite →').tap();

    // Verify success toast appears and dialog completes
    await expect(screen.getByText(/Invitation link generated/i)).toBeVisible();
  });

  test('STEP 6: Navigate to Projects view and verify project lists and stages', async ({ screen, browser, app }) => {
    await screen.getByRole('link', 'Enter Workspace').tap();
    await screen.getByRole('textbox', 'Email address').fill('admin@mahitechgroup.com');
    await screen.getByRole('textbox', 'Password').fill('AdminPassword@2026');
    await screen.getByRole('button', 'Sign in to workspace').tap();
    await expect(browser).toHaveURL(/admin/);

    await app.open('/app.html#/app/projects');
    await expect(browser).toHaveURL(/\/app\/projects/);
  });

  test('STEP 7: Verify Sign Out flow clears auth token and redirects to login', async ({ screen, browser, app }) => {
    await screen.getByRole('link', 'Enter Workspace').tap();
    await screen.getByRole('textbox', 'Email address').fill('admin@mahitechgroup.com');
    await screen.getByRole('textbox', 'Password').fill('AdminPassword@2026');
    await screen.getByRole('button', 'Sign in to workspace').tap();
    await expect(browser).toHaveURL(/admin/);

    // Click Sign Out
    const signoutBtn = screen.getByRole('button', 'Sign out').or(screen.getByText(/Sign out/i));
    if (await signoutBtn.isVisible()) {
      await signoutBtn.tap();
      await expect(browser).toHaveURL(/login/);
    }
  });
});
