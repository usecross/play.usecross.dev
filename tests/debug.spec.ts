import { test, expect } from '@playwright/test';

test('debug service worker and preview', async ({ page }) => {
  const logs: string[] = [];
  const errors: string[] = [];
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error('[PAGE ERROR]', error.message);
  });
  
  await page.goto('/');
  console.log('=== Page loaded ===');
  
  // Wait longer for SW to register AND Python to initialize
  console.log('=== Waiting 15 seconds for initialization ===');
  await page.waitForTimeout(15000);
  
  console.log('=== Checking SW registration ===');
  const swStatus = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      hasRegistration: !!reg,
      hasActive: !!reg?.active,
      hasInstalling: !!reg?.installing,
      hasWaiting: !!reg?.waiting,
      scope: reg?.scope,
    };
  });
  console.log('SW Status:', swStatus);
  
  console.log('=== Checking iframe ===');
  const iframe = page.frameLocator('iframe#preview');
  
  // Wait for iframe to load
  console.log('=== Waiting 10 more seconds for iframe ===');
  await page.waitForTimeout(10000);
  
  console.log('=== Trying to get iframe content ===');
  const iframeContent = await page.evaluate(() => {
    const iframe = document.querySelector('iframe#preview') as HTMLIFrameElement;
    if (!iframe || !iframe.contentDocument) {
      return 'No iframe or contentDocument';
    }
    return iframe.contentDocument.documentElement.outerHTML.substring(0, 500);
  });
  console.log('Iframe content (first 500 chars):', iframeContent);
  
  console.log('=== All logs ===');
  logs.forEach(log => console.log(log));
  
  console.log('=== All errors ===');
  errors.forEach(error => console.error(error));
  
  // This test is just for debugging, always pass
  expect(true).toBe(true);
});
