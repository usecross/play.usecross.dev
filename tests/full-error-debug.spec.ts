import { test, expect } from '@playwright/test';

test('get full error trace', async ({ page }) => {
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  const fetchResult = await page.evaluate(async () => {
    const response = await fetch('/preview/counter');
    const text = await response.text();
    return {
      status: response.status,
      body: text,  // Full body
    };
  });
  
  console.log('=== Full error ===');
  console.log(fetchResult.body);
  
  expect(true).toBe(true);
});
