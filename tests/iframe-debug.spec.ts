import { test, expect } from '@playwright/test';

test('debug iframe navigation', async ({ page }) => {
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  console.log('=== Main page ready, checking iframe ===');
  
  // Wait a bit for iframe to settle
  await page.waitForTimeout(3000);
  
  // Check iframe src
  const iframeSrc = await page.evaluate(() => {
    const iframe = document.querySelector('iframe#preview') as HTMLIFrameElement;
    return {
      src: iframe?.src,
      currentSrc: iframe?.contentWindow?.location.href,
    };
  });
  console.log('Iframe src:', iframeSrc);
  
  // Try to get iframe content
  const iframeContent = await page.evaluate(() => {
    const iframe = document.querySelector('iframe#preview') as HTMLIFrameElement;
    if (!iframe?.contentDocument) return 'No contentDocument';
    
    const h1 = iframe.contentDocument.querySelector('h1');
    const allText = iframe.contentDocument.body?.innerText.substring(0, 200);
    
    return {
      h1Text: h1?.textContent,
      bodyPreview: allText,
      hasDataPage: !!iframe.contentDocument.querySelector('[data-page]'),
    };
  });
  console.log('Iframe content:', iframeContent);
  
  // Try fetching /preview/counter directly from the main page
  console.log('=== Testing direct fetch from main page ===');
  const directFetch = await page.evaluate(async () => {
    const resp = await fetch('/preview/counter');
    const text = await resp.text();
    return {
      status: resp.status,
      hasCounter: text.includes('Counter'),
      hasInertia: text.includes('createInertiaApp'),
      preview: text.substring(0, 300),
    };
  });
  console.log('Direct fetch:', directFetch);
  
  expect(true).toBe(true);
});
