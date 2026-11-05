import { test, expect } from '@playwright/test';

test('debug /preview/ fetch directly', async ({ page }) => {
  const logs: string[] = [];
  
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    console.log(`[${msg.type()}] ${msg.text()}`);
  });
  
  await page.goto('/');
  console.log('=== Page loaded, waiting for Python init ===');
  
  // Wait for Python initialization
  await page.waitForFunction(
    () => {
      const status = document.getElementById('status');
      return status?.textContent?.includes('Ready');
    },
    { timeout: 60000 }
  );
  
  console.log('=== Status shows Ready, now testing fetch ===');
  
  // Test fetch from the page context
  const fetchResult = await page.evaluate(async () => {
    try {
      const response = await fetch('/preview/counter');
      const text = await response.text();
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        bodyPreview: text.substring(0, 500),
        bodyLength: text.length,
      };
    } catch (error:any) {
      return {
        error: error.message,
      };
    }
  });
  
  console.log('=== Fetch result ===');
  console.log(JSON.stringify(fetchResult, null, 2));
  
  expect(true).toBe(true);
});
