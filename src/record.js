import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, writeConfig } from './config.js';

/**
 * Derive a page ID from a URL path.
 * e.g. "/check-answers" → "check-answers", "/" → "start"
 */
function pathToId(urlPath) {
  const cleaned = urlPath.replace(/^\/|\/$/g, '').replace(/\//g, '-');
  return cleaned || 'start';
}

/**
 * Record a journey by opening a visible browser and tracking navigation.
 */
export async function record(url, opts) {
  const configPath = resolve(opts.config);

  // Load existing config if appending
  let existingConfig = null;
  if (opts.append && existsSync(configPath)) {
    existingConfig = loadConfig(configPath);
  }

  const baseUrl = new URL(url);
  const baseOrigin = baseUrl.origin;

  console.log(`Recording journey at ${url}`);
  console.log('Navigate through your prototype. Close the browser when done.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  // Track visited pages and navigation edges
  const pages = new Map();     // path → { id, path, label, params: Set }
  const edges = [];            // [{ from, to, label }]
  let lastPageId = null;
  let lastClickText = null;

  // Inject click tracker before each navigation
  await context.addInitScript(() => {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('a, button, [role="button"], input[type="submit"]');
      if (target) {
        const text = target.textContent?.trim().slice(0, 50) ||
                     target.getAttribute('aria-label') ||
                     target.getAttribute('value') ||
                     '';
        window.__lastClickText = text;
      }
    }, true);
  });

  // Expose function for the page to send click data back
  await context.exposeFunction('__reportClick', (text) => {
    lastClickText = text;
  });

  // Also inject a reporter that sends click text before unload
  await context.addInitScript(() => {
    window.addEventListener('beforeunload', () => {
      if (window.__lastClickText && window.__reportClick) {
        window.__reportClick(window.__lastClickText);
      }
    });
  });

  // Track navigations
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;

    const currentUrl = frame.url();
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return;
    }

    // Only track pages on the same origin
    if (parsed.origin !== baseOrigin) return;

    const path = parsed.pathname;
    const pageId = pathToId(path);

    // Track query params as potential states
    if (!pages.has(path)) {
      pages.set(path, {
        id: pageId,
        path,
        label: '', // will be filled from page title
        params: new Set()
      });
    }

    // Record any query params
    for (const key of parsed.searchParams.keys()) {
      pages.get(path).params.add(key);
    }

    // Record edge from previous page
    if (lastPageId && lastPageId !== pageId) {
      edges.push({
        from: lastPageId,
        to: pageId,
        label: lastClickText || ''
      });
    }

    lastPageId = pageId;
    lastClickText = null;
  });

  // Capture page titles
  page.on('load', async () => {
    try {
      const title = await page.title();
      const path = new URL(page.url()).pathname;
      if (pages.has(path) && title) {
        pages.get(path).label = title;
      }
    } catch {
      // page may have navigated away
    }
  });

  // Navigate to start URL
  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for browser to close
  await new Promise((resolve) => {
    context.on('close', resolve);
    browser.on('disconnected', resolve);
  });

  // Build config
  const pagesList = Array.from(pages.values()).map(p => {
    const entry = { id: p.id, path: p.path };
    if (p.label) entry.label = p.label;

    // Convert detected params into states
    if (p.params.size > 0) {
      entry.states = [
        { id: 'default', label: 'Default' },
        ...Array.from(p.params).map(param => ({
          id: param,
          label: `With ${param}`,
          params: { [param]: 'true' }
        }))
      ];
    }

    return entry;
  });

  // Deduplicate edges
  const seenEdges = new Set();
  const uniqueEdges = edges.filter(e => {
    const key = `${e.from}->${e.to}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });

  const journeySteps = uniqueEdges.map(e => {
    const step = { from: e.from, to: e.to };
    if (e.label) step.label = e.label;
    return step;
  });

  let config;
  if (existingConfig && opts.append) {
    // Merge into existing config
    const existingPageIds = new Set(existingConfig.pages.map(p => p.id));
    for (const page of pagesList) {
      if (!existingPageIds.has(page.id)) {
        existingConfig.pages.push(page);
      }
    }

    // Add as a new journey
    const journeyId = `recorded-${Date.now()}`;
    existingConfig.journeys.push({
      id: journeyId,
      label: 'Recorded journey',
      steps: journeySteps
    });
    config = existingConfig;
  } else {
    config = {
      name: opts.name || pagesList[0]?.label || 'Recorded prototype',
      baseUrl: baseOrigin,
      viewport: { width: 1280, height: 900 },
      round: 1,
      pages: pagesList,
      journeys: journeySteps.length > 0 ? [{
        id: 'recorded',
        label: 'Recorded journey',
        steps: journeySteps
      }] : []
    };

    if (opts.description) {
      config.description = opts.description;
    }
  }

  const writtenPath = writeConfig(configPath, config);
  console.log(`\nRecorded ${pages.size} page(s) and ${uniqueEdges.length} connection(s)`);
  console.log(`Config written to: ${writtenPath}`);
  console.log('\nEdit the config to refine labels, add states, and define journeys.');
  console.log('Then run: prototype-map capture');
}
