import { test, expect } from '@playwright/test';

test('check Inertia API', async ({ page }) => {
  await page.goto('/');
  
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.includes('Ready'),
    { timeout: 60000 }
  );
  
  const iframe = page.frameLocator('iframe#preview');
  await expect(iframe.locator('h1')).toHaveText('Counter', { timeout: 30000 });
  
  const api = await page.evaluate(() => {
    const iframe = document.querySelector('iframe#preview') as HTMLIFrameElement;
    const win = iframe?.contentWindow as any;
    
    return {
      hasInertia: !!win.Inertia,
      hasInertiaReact: !!win.InertiaReact,
      inertiaKeys: win.Inertia ? Object.keys(win.Inertia) : [],
      inertiaReactKeys: win.InertiaReact ? Object.keys(win.InertiaReact) : [],
      inertiaType: typeof win.Inertia,
    };
  });
  
  console.log('=== Inertia API ===');
  console.log(JSON.stringify(api, null, 2));
  
  expect(true).toBe(true);
});
