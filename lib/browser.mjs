// @ts-check
// Opens a visible browser window on Blackboard and waits for the friend to sign in.
// Nothing is saved between runs: a fresh browser profile each time, no stored cookies.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BB_UI, isLoggedIn } from './blackboard.mjs';

const SIGN_IN_MINUTES = 10;

async function launchBrowser(log) {
  const channel = process.platform === 'win32' ? 'msedge' : 'chrome';
  try {
    return await chromium.launch({ channel, headless: false });
  } catch (e) {
    log(`Could not open ${channel === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'} (${e.message.split('\n')[0]}); downloading a private copy of Chromium instead.`);
  }
  const pkg = createRequire(import.meta.url).resolve('playwright-core/package.json');
  execFileSync(process.execPath, [join(dirname(pkg), 'cli.js'), 'install', '--no-shell', 'chromium'], { stdio: 'inherit' });
  return chromium.launch({ headless: false });
}

/**
 * Returns { browser, context } once Blackboard shows a signed-in page.
 * onWaiting(true) when the friend has to sign in, onWaiting(false) once signed in.
 */
export async function openBlackboard({ log = console.log, onWaiting = () => {} } = {}) {
  const browser = await launchBrowser(log);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(BB_UI, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    if (!isLoggedIn(page.url())) {
      onWaiting(true);
      log(`A browser window is open: sign in to Blackboard there (waiting up to ${SIGN_IN_MINUTES} min).`);
      await page.waitForURL(u => isLoggedIn(u.toString()), { timeout: SIGN_IN_MINUTES * 60 * 1000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      onWaiting(false);
    }
    log('Signed in to Blackboard.');
    return { browser, context };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
