import { test, expect } from '@playwright/test';

test('debug increment POST', async ({ page }) => {
  const requests: any[] = [];
  const responses: any[] = [];
  
  page.on('request', req => {
    requests.push({
      url: req.url(),
      method: req.method(),
      postData: req.postData(),
      headers: req.headers(),
    });
  });
  
  page.on('response', async resp => {
    const body = resp.url().includes('/preview/counter') && resp.request().method() === 'POST' 
      ? await resp.text().catch(() => 'error reading body')
      : null;
    
    responses.push({
      url: resp.url(),
      status: resp.status(),
      method: resp.request().method(),
      headers: Object.fromEntries(Object.entries(await resp.allHeaders())),
      body: body ? body.substring(0, 200) : null,
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
  
  console.log('=== POST requests ===');
  const postReqs = requests.filter(r => r.method === 'POST');
  console.log(`Found ${postReqs.length} POST requests`);
  postReqs.forEach(r => {
    console.log(r.url, r.postData);
    console.log('  X-Inertia:', r.headers['x-inertia'] || 'missing');
    console.log('  X-Inertia-Version:', r.headers['x-inertia-version'] || 'missing');
  });
  
  console.log('=== All responses (after button click) ===');
  const recentResps = responses.slice(-10);
  recentResps.forEach(r => {
    console.log(`${r.method} ${r.url.replace('http://localhost:3000', '')} -> ${r.status} ${r.headers['location'] ? 'Location: ' + r.headers['location'] : ''}`);
    if (r.body) console.log(`  Body: ${r.body}`);
  });
  
  const newCount = parseInt(await counterDisplay.textContent() || '0');
  console.log(`New count: ${newCount} (expected ${initialCount + 1})`);
  
  expect(true).toBe(true);
});
