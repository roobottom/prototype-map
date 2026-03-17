import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
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
 * Generate screenshot filename for a page + optional state.
 * Includes a step number prefix for easy sorting in file managers.
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
 * Skips fields that don't exist with a warning instead of crashing.
 */
async function fillForm(browserPage, formData) {
  for (const entry of formData) {
    try {
      // Check the field exists before interacting (short timeout)
      const locator = browserPage.locator(entry.field);
      await locator.waitFor({ state: 'attached', timeout: 3000 });

      if (entry.action === 'click') {
        await locator.click();
        // Wait for any JS-triggered DOM changes to complete
        await browserPage.waitForTimeout(1000);
      } else if (entry.action === 'check') {
        await locator.check();
      } else if (entry.action === 'uncheck') {
        await locator.uncheck();
      } else if (entry.action === 'select') {
        await locator.selectOption(entry.value);
      } else {
        await locator.fill(entry.value ?? '');
      }
    } catch {
      console.warn(`    SKIP: field "${entry.field}" not found on page`);
    }
  }
}

/**
 * Submit a form on the page.
 * Warns instead of crashing if the submit button isn't found.
 */
async function submitForm(browserPage, submit) {
  const submitSelector = typeof submit === 'string'
    ? submit
    : 'button[type="submit"], input[type="submit"]';
  try {
    const locator = browserPage.locator(submitSelector);
    await locator.waitFor({ state: 'attached', timeout: 3000 });
    await locator.click();
    await browserPage.waitForLoadState('load');
    await browserPage.waitForTimeout(500);
  } catch {
    console.warn(`    SKIP: submit button "${submitSelector}" not found`);
  }
}

/**
 * Capture screenshots for all pages/states defined in config.
 *
 * Default mode: replays the journey in order, keeping session state between pages.
 * This ensures form submissions carry forward (e.g. answers stored in session).
 */
export async function capture(opts) {
  const config = loadConfig(opts.config);
  const round = opts.round ? Number(opts.round) : config.round;
  const outDir = resolve(opts.out);
  const screenshotDir = join(outDir, 'screenshots', `round-${round}`);

  mkdirSync(screenshotDir, { recursive: true });

  const pageMap = new Map(config.pages.map(p => [p.id, p]));

  // If there's a journey, replay it in order with a shared session
  const journeyId = opts.journey || (config.journeys.length > 0 ? config.journeys[0].id : null);
  const journey = journeyId ? config.journeys.find(j => j.id === journeyId) : null;

  if (journey) {
    await captureJourney(config, journey, pageMap, screenshotDir, opts);
  } else {
    // No journey — capture pages independently (original behaviour)
    await captureIndependent(config, config.pages, screenshotDir, opts);
  }
}

/**
 * Replay a journey in order, keeping session state between pages.
 * Screenshots each page after filling forms but before submitting.
 */
async function captureJourney(config, journey, pageMap, screenshotDir, opts) {
  console.log(`Replaying journey "${journey.label || journey.id}"...`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: {
      width: config.viewport.width,
      height: config.viewport.height
    }
  });
  const browserPage = await context.newPage();

  const captured = new Set();
  let capturedCount = 0;
  let stepNumber = 1;

  // Track how many times each page has been visited as a 'from',
  // so we use the right state when a page appears multiple times
  const visitCount = new Map();

  // Walk through journey steps in order
  for (const step of journey.steps) {
    const page = pageMap.get(step.from);
    if (!page) continue;

    // Pick the right state: use fromState if specified, otherwise
    // cycle through states in order for repeat visits
    const visits = visitCount.get(page.id) || 0;
    visitCount.set(page.id, visits + 1);

    let state;
    if (step.fromState) {
      state = page.states?.find(s => s.id === step.fromState) || null;
    } else if (page.states && page.states.length > 0) {
      state = page.states[Math.min(visits, page.states.length - 1)];
    } else {
      state = null;
    }

    const captureKey = `${page.id}--${state?.id || 'default'}`;

    // Navigate to the page (if not already there)
    const url = buildUrl(config.baseUrl, page.path, state);
    try {
      const currentUrl = browserPage.url();
      const currentPath = currentUrl.startsWith('http') ? new URL(currentUrl).pathname : '';
      if (currentPath !== page.path) {
        await browserPage.goto(url, { waitUntil: 'load', timeout: 15000 });
      }

      // Fill form if this state has formData
      if (state?.formData) {
        await fillForm(browserPage, state.formData);
      }

      // Run setup if defined
      if (state?.setup) {
        const setupFn = new Function('page', 'baseUrl', `return (async () => { ${state.setup} })()`);
        await setupFn(browserPage, config.baseUrl);
        await browserPage.waitForLoadState('load');
        await browserPage.waitForTimeout(500);
      }

      // Screenshot (only if we haven't captured this exact state yet)
      if (!captured.has(captureKey)) {
        const filename = screenshotName(stepNumber, page.id, state?.id);
        const filepath = join(screenshotDir, filename);
        await browserPage.screenshot({ path: filepath, fullPage: true });
        console.log(`  ${filename} - ${state?.label || page.label || page.id}`);
        capturedCount++;
        captured.add(captureKey);
      }
      stepNumber++;

      // Submit to advance the session for the next page
      if (state?.submit) {
        await submitForm(browserPage, state.submit);
      }
    } catch (err) {
      const filename = screenshotName(stepNumber, page.id, state?.id);
      console.error(`  ERROR: ${filename} - ${err.message}`);
      stepNumber++;
    }
  }

  // Capture the final "to" page of the last step
  const lastStep = journey.steps[journey.steps.length - 1];
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
          console.log(`  ${filename} - ${lastState?.label || lastPage.label || lastPage.id}`);
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
  console.log(`\nCaptured ${capturedCount} screenshot(s) to ${screenshotDir}`);
}

/**
 * Capture pages independently (no session sharing).
 * Used when no journey is defined.
 */
async function captureIndependent(config, pages, screenshotDir, opts) {
  let pagesToCapture = pages;

  if (opts.page) {
    pagesToCapture = pagesToCapture.filter(p => p.id === opts.page);
    if (pagesToCapture.length === 0) {
      throw new Error(`Page "${opts.page}" not found in config`);
    }
  }

  console.log(`Capturing ${pagesToCapture.length} page(s)...`);

  const browser = await chromium.launch();
  let capturedCount = 0;
  let stepNumber = 1;

  for (const page of pagesToCapture) {
    const states = page.states && page.states.length > 0 ? page.states : [null];

    for (const state of states) {
      const context = await browser.newContext({
        viewport: {
          width: config.viewport.width,
          height: config.viewport.height
        }
      });

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
        await browserPage.waitForTimeout(500);
        }

        // Screenshot with form filled in (before submit)
        const filename = screenshotName(stepNumber, page.id, state?.id);
        const filepath = join(screenshotDir, filename);
        await browserPage.screenshot({ path: filepath, fullPage: true });

        // Submit after screenshot
        if (state?.formData && state.submit) {
          await submitForm(browserPage, state.submit);
        }

        const label = state?.label || page.label || page.id;
        console.log(`  ${filename} - ${label}`);
        capturedCount++;
      } catch (err) {
        const label = state?.label || page.label || page.id;
        console.error(`  ERROR capturing ${page.id}${state ? `--${state.id}` : ''}: ${err.message}`);
      }

      stepNumber++;
      await context.close();
    }
  }

  await browser.close();
  console.log(`\nCaptured ${capturedCount} screenshot(s) to ${screenshotDir}`);
}
