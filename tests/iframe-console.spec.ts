import { test, expect } from '@playwright/test';

test('debug iframe console errors', async ({ page, context }) => {
  const iframeErrors: string[] = [];
  const iframeLogs: string[] = [];
  
  // Listen for new frames
  context.on('page', async (newPage) => {
    newPage.on('console', msg => {
      const text = `[IFRAME ${msg.type()}] ${msg.text()}`;
      iframeLogs.push(text);
      console.log(text);
    });
    
    newPage.on('pageerror', error => {
      const text = `[IFRAME ERROR] ${error.message}`;
      iframeErrors.push(text);
      console.error(text);
    });
  });
  
  // Also listen on main page
  page.on('console', msg => {
    console.log(`[MAIN ${msg.type()}] ${msg.text()}`);
  });
  
  page.on('pageerror', error => {
    console.error(`[MAIN ERROR] ${error.message}`);
  });
  
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  console.log('=== Main page ready, waiting for iframe to settle ===');
  
  // Wait longer for iframe content to load
  await page.waitForTimeout(5000);
  
  // Try to interact with iframe
  const iframeDetails = await page.evaluate(() => {
    const iframe = document.querySelector('iframe#preview') as HTMLIFrameElement;
    if (!iframe?.contentWindow) return { error: 'No iframe or contentWindow' };
    
    const doc = iframe.contentDocument;
    if (!doc) return { error: 'No contentDocument' };
    
    return {
      hasScripts: doc.querySelectorAll('script').length,
      hasDataPage: !!doc.querySelector('[data-page]'),
      dataPageContent: doc.querySelector('[data-page]')?.getAttribute('data-page')?.substring(0, 100),
      bodyHTML: doc.body?.innerHTML.substring(0, 500),
      h1: doc.querySelector('h1')?.textContent,
    };
  });
  
  console.log('=== Iframe details ===');
  console.log(JSON.stringify(iframeDetails, null, 2));
  
  console.log('=== All iframe errors ===');
  iframeErrors.forEach(e => console.error(e));
  
  expect(true).toBe(true);
});
