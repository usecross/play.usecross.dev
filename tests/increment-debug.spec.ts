import { test, expect } from '@playwright/test';

test('debug increment POST', async ({ page }) => {
  const requests: any[] = [];
  const responses: any[] = [];
  
  page.on('request', req => {
    requests.push({
      url: req.url(),
      method: req.method(),
      postData: req.postData(),
    });
  });
  
  page.on('response', async resp => {
    responses.push({
      url: resp.url(),
      status: resp.status(),
      headers: Object.fromEntries(Object.entries(await resp.allHeaders())),
    });
  });
  
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  console.log('=== Main page ready ===');
  
  const iframe = page.frameLocator('iframe#preview');
  await expect(iframe.locator('h1')).toHaveText('Counter', { timeout: 30000 });
  
  console.log('=== Counter loaded, getting initial count ===');
  
  const counterDisplay = iframe.locator('div').filter({ hasText: /^[0-9]+$/ }).first();
  const initialCount = parseInt(await counterDisplay.textContent() || '0');
  console.log(`Initial count: ${initialCount}`);
  
  console.log('=== Clicking increment button ===');
  
  const incrementButton = iframe.locator('button').filter({ hasText: '+' });
  await incrementButton.click();
  
  // Wait a bit for the POST request
  await page.waitForTimeout(2000);
  
  console.log('=== POST requests made ===');
  requests.filter(r => r.method === 'POST').forEach(r => console.log(JSON.stringify(r, null, 2)));
  
  console.log('=== POST responses ===');
  responses.filter(r => r.url.includes('/counter') && r.status === 303).forEach(r => console.log(JSON.stringify(r, null, 2)));
  
  const newCount = parseInt(await counterDisplay.textContent() || '0');
  console.log(`New count: ${newCount} (expected ${initialCount + 1})`);
  
  expect(true).toBe(true);
});
