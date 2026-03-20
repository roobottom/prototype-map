import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { loadConfig } from './config.js';

/**
 * Build a full URL for a page + optional state params.
 */
function buildUrl(baseUrl, pagePath, state) {
  const url = new URL(pagePath, baseUrl);
  if (state?.params) {
    for (const [key, value] of Object.entries(state.params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Convert state cookies object to Playwright cookie format.
 */
function toCookies(baseUrl, cookiesObj) {
  const url = new URL(baseUrl);
  return Object.entries(cookiesObj).map(([name, value]) => ({
    name,
    value: String(value),
    domain: url.hostname,
    path: '/'
  }));
}

/**
 * Apply state cookies to the shared browser context before visiting a page.
 * In journey mode we keep a single context, so explicit cookie-driven states
 * need to refresh the context cookies before navigation.
 */
async function applyStateCookies(context, baseUrl, state) {
  if (!state?.cookies) return;
  await context.clearCookies();
  await context.addCookies(toCookies(baseUrl, state.cookies));
}

/**
 * Generate screenshot filename for a page + optional state.
 */
function screenshotName(stepNumber, pageId, stateId) {
  const prefix = String(stepNumber).padStart(2, '0');
  if (stateId) {
    return `${prefix}-${pageId}--${stateId}.png`;
  }
  return `${prefix}-${pageId}.png`;
}

/**
 * Fill form fields on a page.
 */
async function fillForm(browserPage, formData) {
  for (const entry of formData) {
    try {
      const locator = browserPage.locator(entry.field);
      await locator.waitFor({ state: 'visible', timeout: 1000 });

      if (entry.action === 'click') {
        await locator.click({ timeout: 2000 });
        await browserPage.waitForTimeout(300);
      } else if (entry.action === 'check') {
        await locator.check({ timeout: 2000 });
      } else if (entry.action === 'uncheck') {
        await locator.uncheck({ timeout: 2000 });
      } else if (entry.action === 'select') {
        await locator.selectOption(entry.value, { timeout: 2000 });
      } else {
        await locator.fill(entry.value ?? '', { timeout: 2000 });
      }
    } catch {
      console.warn(`    SKIP: field "${entry.field}" not found on page`);
    }
  }
}

/**
 * Script injected into every page to hide BrowserSync's notification.
 */
const HIDE_BROWSERSYNC = `
  (function() {
    const style = document.createElement('style');
    style.textContent = '#__bs_notify__ { display: none !important; }';
    if (document.head) {
      document.head.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    }
  })();
`;

/**
 * Submit a form on the page.
 */
async function submitForm(browserPage, submit) {
  const submitSelector = typeof submit === 'string'
    ? submit
    : 'button[type="submit"], input[type="submit"]';
  try {
    const locator = browserPage.locator(submitSelector);
    await locator.waitFor({ state: 'attached', timeout: 1000 });
    await locator.click();
    await browserPage.waitForLoadState('load');
  } catch {
    console.warn(`    SKIP: submit button "${submitSelector}" not found`);
  }
}

/**
 * Capture screenshots for a single journey defined in config.
 *
 * @param {object} opts - { config: path, screenshotDir: path }
 * @param {function} [onProgress] - Optional callback for progress events
 */
export async function capture(opts, onProgress) {
  const config = loadConfig(opts.config);
  const screenshotDir = resolve(opts.screenshotDir);

  mkdirSync(screenshotDir, { recursive: true });

  const pageMap = new Map(config.pages.map(p => [p.id, p]));
  const emit = onProgress || (() => {});

  if (config.steps && config.steps.length > 0) {
    const result = await captureJourney(config, pageMap, screenshotDir, emit);
    writeManifest(screenshotDir, result.manifest, result.capturedCount);
    emit({ type: 'complete', data: { totalCaptured: result.capturedCount } });
  } else {
    await captureIndependent(config, config.pages, screenshotDir, emit);
  }
}

function writeManifest(screenshotDir, manifest, capturedCount) {
  const manifestPath = join(screenshotDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nCaptured ${capturedCount} screenshot(s) to ${screenshotDir}`);
  console.log(`Manifest written to ${manifestPath}`);
}

/**
 * Replay a journey in order, keeping session state between pages.
 */
async function captureJourney(config, pageMap, screenshotDir, emit) {
  console.log(`Replaying journey "${config.name}"...`);

  const totalSteps = config.steps.length + 1; // +1 for the final "to" page

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: {
      width: config.viewport.width,
      height: config.viewport.height
    }
  });
  await context.addInitScript(HIDE_BROWSERSYNC);
  const browserPage = await context.newPage();

  const captured = new Set();
  const manifest = [];
  let capturedCount = 0;
  let stepNumber = 1;

  for (const step of config.steps) {
    const page = pageMap.get(step.from);
    if (!page) continue;

    let statesToCapture;
    if (step.fromState) {
      const s = page.states?.find(s => s.id === step.fromState) || null;
      statesToCapture = [s];
    } else if (page.states && page.states.length > 0) {
      const uncaptured = page.states.filter(s => !captured.has(`${page.id}--${s.id}`));
      statesToCapture = uncaptured.length > 0 ? uncaptured : [page.states[page.states.length - 1]];
    } else {
      statesToCapture = [null];
    }

    for (let si = 0; si < statesToCapture.length; si++) {
      const state = statesToCapture[si];
      const captureKey = `${page.id}--${state?.id || 'default'}`;

      const url = buildUrl(config.baseUrl, page.path, state);
      try {
        const currentUrl = browserPage.url();
        const currentPath = currentUrl.startsWith('http') ? new URL(currentUrl).pathname : '';
        await applyStateCookies(context, config.baseUrl, state);
        if (currentPath !== page.path || si > 0) {
          await browserPage.goto(url, { waitUntil: 'load', timeout: 15000 });
        }

        if (state?.formData) {
          await fillForm(browserPage, state.formData);
        }

        if (state?.setup) {
          const setupFn = new Function('page', 'baseUrl', `return (async () => { ${state.setup} })()`);
          await setupFn(browserPage, config.baseUrl);
          await browserPage.waitForLoadState('load');
          await browserPage.waitForTimeout(500);
        }

        if (!captured.has(captureKey)) {
          const filename = screenshotName(stepNumber, page.id, state?.id);
          const filepath = join(screenshotDir, filename);
          await browserPage.screenshot({ path: filepath, fullPage: true });

          if (state?.submit) {
            const pathBefore = new URL(browserPage.url()).pathname;
            await submitForm(browserPage, state.submit);
            const pathAfter = new URL(browserPage.url()).pathname;
            if (pathBefore === pathAfter) {
              await browserPage.screenshot({ path: filepath, fullPage: true });
            }
          }

          const title = state?.label || page.label || page.id;
          console.log(`  ${filename} - ${title}`);
          manifest.push({
            step: filename.replace(/\.png$/, ''),
            file: filename,
            title,
            url,
            capturedAt: new Date().toISOString(),
            note: ''
          });
          capturedCount++;
          captured.add(captureKey);
          emit({ type: 'progress', data: { step: stepNumber, total: totalSteps, filename, title } });
          stepNumber++;
        } else if (state?.submit) {
          await submitForm(browserPage, state.submit);
        }
      } catch (err) {
        const filename = screenshotName(stepNumber, page.id, state?.id);
        console.error(`  ERROR: ${filename} - ${err.message}`);
        stepNumber++;
      }
    }
  }

  // Capture the final "to" page of the last step
  const lastStep = config.steps[config.steps.length - 1];
  if (lastStep) {
    const lastPage = pageMap.get(lastStep.to);
    if (lastPage) {
      const lastState = lastPage.states?.[0] || null;
      const lastKey = `${lastPage.id}--${lastState?.id || 'default'}`;
      if (!captured.has(lastKey)) {
        try {
          const filename = screenshotName(stepNumber, lastPage.id, lastState?.id);
          const filepath = join(screenshotDir, filename);
          await browserPage.screenshot({ path: filepath, fullPage: true });
          const lastTitle = lastState?.label || lastPage.label || lastPage.id;
          const lastUrl = buildUrl(config.baseUrl, lastPage.path, lastState);
          console.log(`  ${filename} - ${lastTitle}`);
          manifest.push({
            step: filename.replace(/\.png$/, ''),
            file: filename,
            title: lastTitle,
            url: lastUrl,
            capturedAt: new Date().toISOString(),
            note: ''
          });
          capturedCount++;
        } catch (err) {
          const filename = screenshotName(stepNumber, lastPage.id, lastState?.id);
          console.error(`  ERROR: ${filename} - ${err.message}`);
        }
      }
    }
  }

  await context.close();
  await browser.close();

  return { manifest, capturedCount };
}

/**
 * Capture pages independently (no session sharing).
 * Used when no steps are defined.
 */
async function captureIndependent(config, pages, screenshotDir, emit) {
  console.log(`Capturing ${pages.length} page(s)...`);

  const totalSteps = pages.reduce((sum, p) => sum + Math.max((p.states?.length || 0), 1), 0);
  const browser = await chromium.launch();
  const manifest = [];
  let capturedCount = 0;
  let stepNumber = 1;

  for (const page of pages) {
    const states = page.states && page.states.length > 0 ? page.states : [null];

    for (const state of states) {
      const context = await browser.newContext({
        viewport: {
          width: config.viewport.width,
          height: config.viewport.height
        }
      });
      await context.addInitScript(HIDE_BROWSERSYNC);

      if (state?.cookies) {
        await context.addCookies(toCookies(config.baseUrl, state.cookies));
      }

      const browserPage = await context.newPage();
      const url = buildUrl(config.baseUrl, page.path, state);

      try {
        await browserPage.goto(url, { waitUntil: 'load', timeout: 15000 });

        if (state?.formData) {
          await fillForm(browserPage, state.formData);
        }

        if (state?.setup) {
          const setupFn = new Function('page', 'baseUrl', `return (async () => { ${state.setup} })()`);
          await setupFn(browserPage, config.baseUrl);
          await browserPage.waitForLoadState('load');
        }

        const filename = screenshotName(stepNumber, page.id, state?.id);
        const filepath = join(screenshotDir, filename);
        await browserPage.screenshot({ path: filepath, fullPage: true });

        if (state?.formData && state.submit) {
          await submitForm(browserPage, state.submit);
        }

        const label = state?.label || page.label || page.id;
        console.log(`  ${filename} - ${label}`);
        manifest.push({
          step: filename.replace(/\.png$/, ''),
          file: filename,
          title: label,
          url,
          capturedAt: new Date().toISOString(),
          note: ''
        });
        capturedCount++;
        emit({ type: 'progress', data: { step: stepNumber, total: totalSteps, filename, title: label } });
      } catch (err) {
        console.error(`  ERROR capturing ${page.id}${state ? `--${state.id}` : ''}: ${err.message}`);
      }

      stepNumber++;
      await context.close();
    }
  }

  await browser.close();
  writeManifest(screenshotDir, manifest, capturedCount);
}
