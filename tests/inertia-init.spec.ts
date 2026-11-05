import { test, expect } from '@playwright/test';

test('check Inertia initialization', async ({ page }) => {
  const logs: string[] = [];
  const errors: string[] = [];
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });
  
  page.on('pageerror', err => {
    errors.push(err.message);
    console.error('[ERROR]', err.message);
    console.error(err.stack);
  });
  
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  await page.waitForTimeout(2000);
  
  // Check if Counter component exists in iframe
  const hasCounter = await page.evaluate(() => {
    const iframe = document.querySelector('iframe#preview') as HTMLIFrameElement;
    const win = iframe?.contentWindow as any;
    
    return {
      hasWindow: !!win,
      hasH: !!win?.h,
      hasRouter: !!win?.router,
      hasCreateRoot: !!win?.createRoot,
      hasCreateInertiaApp: !!win?.createInertiaApp,
    };
  });
  
  console.log('=== Iframe globals ===');
  console.log(JSON.stringify(hasCounter, null, 2));
  
  console.log('=== Errors ===');
  errors.forEach(e => console.error(e));
  
  expect(true).toBe(true);
});
