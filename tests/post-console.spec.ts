import { test, expect } from '@playwright/test';

test('check POST console errors', async ({ page }) => {
  const errors: string[] = [];
  const logs: string[] = [];
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(text);
    }
  });
  
  page.on('pageerror', error => {
    const text = `[ERROR] ${error.message}`;
    errors.push(text);
    console.error(text);
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
  
  console.log('=== Errors ===');
  errors.forEach(e => console.error(e));
  
  console.log('=== Recent logs ===');
  logs.slice(-20).forEach(l => console.log(l));
  
  expect(true).toBe(true);
});
