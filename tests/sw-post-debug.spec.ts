import { test, expect } from '@playwright/test';

test('debug POST with SW logs', async ({ page, context }) => {
  // Capture SW logs
  context.on('serviceworker', sw => {
    sw.on('console', msg => {
      console.log(`[SW] ${msg.text()}`);
    });
  });
  
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  const iframe = page.frameLocator('iframe#preview');
  await expect(iframe.locator('h1')).toHaveText('Counter', { timeout: 30000 });
  
  console.log('=== Clicking increment ===');
  const incrementButton = iframe.locator('button').filter({ hasText: '+' });
  await incrementButton.click();
  
  await page.waitForTimeout(3000);
  
  console.log('=== Done ===');
  
  expect(true).toBe(true);
});
