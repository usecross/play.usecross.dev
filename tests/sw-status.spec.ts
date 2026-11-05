import { test, expect } from '@playwright/test';

test('check SW status and logs', async ({ page, context }) => {
  // Capture all service worker logs
  context.on('serviceworker', sw => {
    console.log('[Test] Service Worker created:', sw.url());
    sw.on('console', msg => {
      console.log(`[SW Console ${msg.type()}]`, msg.text());
    });
  });
  
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  const swStatus = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      hasRegistration: !!reg,
      active: !!reg?.active,
      waiting: !!reg?.waiting,
      installing: !!reg?.installing,
      scope: reg?.scope,
      activeState: reg?.active?.state,
    };
  });
  
  console.log('=== SW Status ===');
  console.log(JSON.stringify(swStatus, null, 2));
  
  // Try to trigger a fetch
  console.log('=== Triggering fetch ===');
  await page.evaluate(async () => {
    const resp = await fetch('/preview/counter');
    console.log('[Main] Fetch completed:', resp.status);
  });
  
  await page.waitForTimeout(1000);
  
  expect(swStatus.hasRegistration).toBe(true);
});
