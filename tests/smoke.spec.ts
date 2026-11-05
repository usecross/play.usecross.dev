/**
 * Phase 0+ Smoke Tests
 * 
 * E2E tests verifying the full ASGI bridge:
 * - Service Worker registration
 * - Pyodide initialization
 * - Counter UI rendering
 * - POST → 303 → render cycle
 */

import { test, expect } from '@playwright/test';

test.describe('Phase 0 Smoke Tests', () => {
  test('shell loads without Vite error overlay', async ({ page }) => {
    await page.goto('/');
    
    // Verify no Vite error overlay
    const errorOverlay = page.locator('vite-error-overlay');
    await expect(errorOverlay).toHaveCount(0);
    
    // Verify shell loaded
    await expect(page.locator('h1')).toContainText('CrossInertia Playground');
    await expect(page.locator('p').first()).toContainText('Phase 0');
  });

  test('service worker registers successfully', async ({ page, context }) => {
    await page.goto('/');
    
    // Wait for Service Worker registration
    const swRegistered = await page.evaluate(async () => {
      // Give it a few seconds to register
      for (let i = 0; i < 10; i++) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && (registration.active || registration.installing || registration.waiting)) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return false;
    });
    
    expect(swRegistered).toBe(true);
  });

  test('preview iframe is present', async ({ page }) => {
    await page.goto('/');
    
    // Verify preview iframe exists
    const iframe = page.locator('iframe#preview');
    await expect(iframe).toBeVisible();
    
    // Verify iframe has correct src
    await expect(iframe).toHaveAttribute('src', '/preview/');
  });

  test('reload button is present and functional', async ({ page }) => {
    await page.goto('/');
    
    // Verify reload button exists
    const reloadBtn = page.locator('button#reload-btn');
    await expect(reloadBtn).toBeVisible();
    await expect(reloadBtn).toContainText('Reload Preview');
    
    // Verify button is clickable (won't actually test reload behavior in Phase 0)
    await expect(reloadBtn).toBeEnabled();
  });

  test('status indicator shows ready state', async ({ page }) => {
    await page.goto('/');
    
    // Status should show either "Ready" or "Service Worker registered"
    const status = page.locator('#status');
    await expect(status).toBeVisible();
    
    // Wait for initialization
    await page.waitForTimeout(2000);
    
    // Should show one of the expected states
    const statusText = await status.textContent();
    expect(
      statusText?.includes('Ready') || 
      statusText?.includes('registered') ||
      statusText?.includes('Registering')
    ).toBe(true);
  });

  test('no console errors during load', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    // Filter out expected development warnings
    const criticalErrors = errors.filter(err => 
      !err.includes('DevTools') && 
      !err.includes('Extension') &&
      !err.includes('favicon')
    );
    
    expect(criticalErrors).toHaveLength(0);
  });

  test('counter preview loads and displays UI', async ({ page }) => {
    await page.goto('/');
    
    // Wait for SW to be ready
    await page.waitForTimeout(2000);
    
    // Get the preview iframe
    const iframe = page.frameLocator('iframe#preview');
    
    // Wait for counter UI to load (this tests the full ASGI bridge)
    // The counter component should be visible with the count
    const counterTitle = iframe.locator('h1');
    await expect(counterTitle).toBeVisible({ timeout: 30000 });
    await expect(counterTitle).toHaveText('Counter');
    
    // Check that the counter value is displayed
    const counterValue = iframe.locator('div').filter({ hasText: /^[0-9]+$/ }).first();
    await expect(counterValue).toBeVisible();
  });

  test('counter increment works through ASGI bridge', async ({ page }) => {
    await page.goto('/');
    
    // Wait for Python worker to be ready
    await page.waitForFunction(
      () => document.getElementById('status')?.textContent?.includes('Ready'),
      { timeout: 60000 }
    );
    
    // Get the preview iframe
    const iframe = page.frameLocator('iframe#preview');
    
    // Wait for counter to load
    await expect(iframe.locator('h1')).toHaveText('Counter', { timeout: 30000 });
    
    // Get initial count
    const counterDisplay = iframe.locator('div').filter({ hasText: /^[0-9]+$/ }).first();
    const initialCount = parseInt(await counterDisplay.textContent() || '0');
    
    // Click increment button (+)
    const incrementBtn = iframe.locator('button').filter({ hasText: '+' });
    await incrementBtn.click();
    
    // Wait for Inertia to process (POST → 303 → GET)
    await page.waitForTimeout(1000);
    
    // Verify count increased
    const newCount = parseInt(await counterDisplay.textContent() || '0');
    expect(newCount).toBe(initialCount + 1);
  });

  test('counter decrement works', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    const iframe = page.frameLocator('iframe#preview');
    await expect(iframe.locator('h1')).toHaveText('Counter', { timeout: 30000 });
    
    // Increment once to ensure we're not at 0
    await iframe.locator('button').filter({ hasText: '+' }).click();
    await page.waitForTimeout(500);
    
    // Get count after increment
    const counterDisplay = iframe.locator('div').filter({ hasText: /^[0-9]+$/ }).first();
    const beforeDecrement = parseInt(await counterDisplay.textContent() || '0');
    
    // Click decrement button (−)
    await iframe.locator('button').filter({ hasText: '−' }).click();
    await page.waitForTimeout(1000);
    
    // Verify count decreased
    const afterDecrement = parseInt(await counterDisplay.textContent() || '0');
    expect(afterDecrement).toBe(beforeDecrement - 1);
  });
});
