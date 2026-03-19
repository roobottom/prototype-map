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
      // Check the field exists and is visible before interacting.
      // Using 'visible' not 'attached' — fields hidden behind conditionals
      // (e.g. shown only when a radio is "Yes") are in the DOM but not visible,
      // and Playwright's fill/check would hang for 30s waiting for visibility.
      const locator = browserPage.locator(entry.field);
      await locator.waitFor({ state: 'visible', timeout: 1000 });

      if (entry.action === 'click') {
        await locator.click({ timeout: 2000 });
        // Wait for any JS-triggered DOM changes to settle
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
 * Runs as an init script so it executes before page JS.
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
 * Warns instead of crashing if the submit button isn't found.
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
 * Capture screenshots for all pages/states defined in config.
 *
 * Default mode: replays the journey in order, keeping session state between pages.
 * This ensures form submissions carry forward (e.g. answers stored in session).
 */
/**
 * @param {object} opts - Capture options
 * @param {function} [onProgress] - Optional callback for progress events.
 *   Called with { type: 'progress'|'complete', data: {...} }
 */
export async function capture(opts, onProgress) {
  const config = loadConfig(opts.config);
  const round = opts.round ? Number(opts.round) : config.round;
  const outDir = resolve(opts.out);
  const screenshotDir = join(outDir, 'screenshots', `round-${round}`);

  mkdirSync(screenshotDir, { recursive: true });

  const pageMap = new Map(config.pages.map(p => [p.id, p]));

  // Count total steps for progress reporting
  const totalSteps = countTotalSteps(config, opts.journey);

  const emit = onProgress || (() => {});

  if (opts.journey) {
    const journey = config.journeys.find(j => j.id === opts.journey);
    if (!journey) throw new Error(`Journey "${opts.journey}" not found in config`);
    const result = await captureJourney(config, journey, pageMap, screenshotDir, 1, totalSteps, emit);
    writeManifest(screenshotDir, result.manifest, result.capturedCount);
    emit({ type: 'complete', data: { totalCaptured: result.capturedCount } });
  } else if (config.journeys.length > 0) {
    const allManifest = [];
    let totalCaptured = 0;
    let stepNumber = 1;
    for (const journey of config.journeys) {
      const result = await captureJourney(config, journey, pageMap, screenshotDir, stepNumber, totalSteps, emit);
      allManifest.push(...result.manifest);
      totalCaptured += result.capturedCount;
      stepNumber = result.nextStep;
    }
    writeManifest(screenshotDir, allManifest, totalCaptured);
    emit({ type: 'complete', data: { totalCaptured } });
  } else {
    await captureIndependent(config, config.pages, screenshotDir, opts, totalSteps, emit);
  }
}

function countTotalSteps(config, journeyId) {
  if (journeyId) {
    const j = config.journeys.find(j => j.id === journeyId);
    return j ? j.steps.length + 1 : 0;
  }
  if (config.journeys.length > 0) {
    return config.journeys.reduce((sum, j) => sum + j.steps.length + 1, 0);
  }
  return config.pages.reduce((sum, p) => sum + Math.max((p.states?.length || 0), 1), 0);
}

function writeManifest(screenshotDir, manifest, capturedCount) {
  const manifestPath = join(screenshotDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nCaptured ${capturedCount} screenshot(s) to ${screenshotDir}`);
  console.log(`Manifest written to ${manifestPath}`);
}

/**
 * Replay a journey in order, keeping session state between pages.
 * Screenshots each page after filling forms but before submitting.
 * Returns { manifest, capturedCount, nextStep } for the caller to aggregate.
 */
async function captureJourney(config, journey, pageMap, screenshotDir, startStep, totalSteps, emit) {
  console.log(`Replaying journey "${journey.label || journey.id}"...`);

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
  let stepNumber = startStep;

  // Walk through journey steps in order
  for (const step of journey.steps) {
    const page = pageMap.get(step.from);
    if (!page) continue;

    // Build the list of states to capture for this step.
    // If fromState is specified, use just that one state.
    // If the page has multiple states, capture ALL of them in sequence.
    // Otherwise, capture the page with no state.
    let statesToCapture;
    if (step.fromState) {
      const s = page.states?.find(s => s.id === step.fromState) || null;
      statesToCapture = [s];
    } else if (page.states && page.states.length > 0) {
      // Check which states haven't been captured yet
      const uncaptured = page.states.filter(s => !captured.has(`${page.id}--${s.id}`));
      statesToCapture = uncaptured.length > 0 ? uncaptured : [page.states[page.states.length - 1]];
    } else {
      statesToCapture = [null];
    }

    for (let si = 0; si < statesToCapture.length; si++) {
      const state = statesToCapture[si];
      const captureKey = `${page.id}--${state?.id || 'default'}`;

      // Navigate to the page (if not already there, or if we need to reset for a new state)
      const url = buildUrl(config.baseUrl, page.path, state);
      try {
        const currentUrl = browserPage.url();
        const currentPath = currentUrl.startsWith('http') ? new URL(currentUrl).pathname : '';
        if (currentPath !== page.path || si > 0) {
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

        // Screenshot before submit (captures filled form).
        // Then submit — if we stay on the same page (validation error),
        // re-screenshot to capture the error state instead.
        if (!captured.has(captureKey)) {
          const filename = screenshotName(stepNumber, page.id, state?.id);
          const filepath = join(screenshotDir, filename);
          await browserPage.screenshot({ path: filepath, fullPage: true });

          if (state?.submit) {
            const pathBefore = new URL(browserPage.url()).pathname;
            await submitForm(browserPage, state.submit);
            const pathAfter = new URL(browserPage.url()).pathname;
            // If we stayed on the same page (error), re-screenshot to show errors
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
          // Already captured but still need to submit to advance the journey
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

  return { manifest, capturedCount, nextStep: stepNumber };
}

/**
 * Capture pages independently (no session sharing).
 * Used when no journey is defined.
 */
async function captureIndependent(config, pages, screenshotDir, opts, totalSteps, emit) {
  let pagesToCapture = pages;

  if (opts.page) {
    pagesToCapture = pagesToCapture.filter(p => p.id === opts.page);
    if (pagesToCapture.length === 0) {
      throw new Error(`Page "${opts.page}" not found in config`);
    }
  }

  console.log(`Capturing ${pagesToCapture.length} page(s)...`);

  const browser = await chromium.launch();
  const manifest = [];
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
        const label = state?.label || page.label || page.id;
        console.error(`  ERROR capturing ${page.id}${state ? `--${state.id}` : ''}: ${err.message}`);
      }

      stepNumber++;
      await context.close();
    }
  }

  await browser.close();

  // Write manifest
  const manifestPath = join(screenshotDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nCaptured ${capturedCount} screenshot(s) to ${screenshotDir}`);
  console.log(`Manifest written to ${manifestPath}`);
}
