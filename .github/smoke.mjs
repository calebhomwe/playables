// Headless load check: opens each page, pokes it (click + a few keys) and fails on uncaught
// page errors or same-origin requests that return 4xx/5xx.
//   node .github/smoke.mjs <baseUrl> <page> [page...]
// IGNORE_ERRORS: optional regex of page-error messages to tolerate (engine quirks of headless Chromium).
import { chromium } from 'playwright';

const [base, ...pages] = process.argv.slice(2);
if (!base || !pages.length) { console.error('usage: node .github/smoke.mjs <baseUrl> <page>...'); process.exit(2); }
const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
const settle = +(process.env.SETTLE_MS || 2500);
const origin = new URL(base).origin;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
for (const p of pages) {
  const url = new URL(p, base).href;
  const problems = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!ignore || !ignore.test(e.message)) problems.push('page error: ' + e.message.split('\n')[0]); });
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(origin) && !/favicon\.ico$/.test(r.url())) problems.push(r.status() + ' ' + r.url().slice(origin.length)); });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(settle);
    await page.mouse.click(640, 400).catch(() => {});
    for (const k of ['Enter', 'Space', 'ArrowRight', 'ArrowUp']) { await page.keyboard.press(k).catch(() => {}); await page.waitForTimeout(100); }
    await page.waitForTimeout(800);
  } catch (e) { problems.push('load: ' + e.message.split('\n')[0]); }
  await ctx.close();
  if (problems.length) failed++;
  console.log((problems.length ? 'FAIL ' : 'ok   ') + p + (problems.length ? '\n     ' + [...new Set(problems)].join('\n     ') : ''));
}
await browser.close();
console.log(`${pages.length - failed}/${pages.length} pages loaded clean`);
process.exit(failed ? 1 : 0);
