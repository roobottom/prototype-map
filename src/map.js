import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { loadConfig } from './config.js';
import { computeLayout } from './layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = join(__dirname, 'templates', 'map.html');

/**
 * Build SVG markup for edges from ELK layout result.
 */
function renderEdgesSvg(layout) {
  const lines = [];

  // Arrow marker definition
  lines.push('<defs>');
  lines.push('  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">');
  lines.push('    <polygon class="edge-arrow" points="0 0, 10 3.5, 0 7" />');
  lines.push('  </marker>');
  lines.push('</defs>');

  for (const edge of (layout.edges || [])) {
    const sections = edge.sections || [];
    for (const section of sections) {
      const points = [];
      points.push(section.startPoint);
      if (section.bendPoints) points.push(...section.bendPoints);
      points.push(section.endPoint);

      const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
      lines.push(`<path class="edge-path" d="${pathData}" marker-end="url(#arrowhead)" />`);

      // Edge label
      if (edge.labels && edge.labels.length > 0) {
        const label = edge.labels[0];
        if (label.text) {
          // Position label at true midpoint along the path
          const start = section.startPoint;
          const end = section.endPoint;
          const midX = (start.x + end.x) / 2;
          const midY = (start.y + end.y) / 2;
          const textWidth = label.text.length * 7;
          lines.push(`<rect class="edge-label-bg" x="${midX - textWidth / 2 - 4}" y="${midY - 9}" width="${textWidth + 8}" height="18" rx="3" />`);
          lines.push(`<text class="edge-label" x="${midX}" y="${midY + 4}">${escapeHtml(label.text)}</text>`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Find a screenshot file in the directory, matching with or without step-number prefix.
 * e.g. "start.png" matches "01-start.png" or "start.png"
 */
function findScreenshot(dir, basePattern) {
  if (!existsSync(dir)) return null;
  // Direct match first (legacy filenames without prefix)
  const direct = join(dir, basePattern);
  if (existsSync(direct)) return direct;
  // Look for step-prefixed files like "01-start.png"
  try {
    const files = readdirSync(dir);
    const match = files.find(f => f.endsWith(`-${basePattern}`));
    if (match) return join(dir, match);
  } catch {
    // ignore
  }
  return null;
}

function loadManifest(dir) {
  if (!dir) return [];
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
}

function assetUrl(folder, file) {
  return `${folder}/${encodeURIComponent(file)}`;
}

async function ensureMapAssets(screenshotDir, mapDir, manifest, fullUrlForFile) {
  const assets = new Map();
  if (!screenshotDir || !Array.isArray(manifest) || manifest.length === 0) {
    return assets;
  }

  const thumbsDir = join(mapDir, 'thumbs');
  mkdirSync(thumbsDir, { recursive: true });

  for (const entry of manifest) {
    const sourcePath = join(screenshotDir, entry.file);
    if (!existsSync(sourcePath)) continue;

    const thumbPath = join(thumbsDir, entry.file);

    try {
      execFileSync('sips', ['-Z', '400', sourcePath, '--out', thumbPath], { stdio: 'ignore' });
    } catch {
      writeFileSync(thumbPath, readFileSync(sourcePath));
    }

    assets.set(entry.file, {
      thumbUrl: assetUrl('thumbs', entry.file),
      fullUrl: fullUrlForFile(entry.file)
    });
  }

  return assets;
}

/**
 * Build HTML content for nodes from ELK layout result.
 */
function renderNodes(layout, screenshotDir, embedScreenshots, manifest, assetMap) {
  const lines = [];
  const manifestEntries = Array.isArray(manifest) ? manifest : [];

  for (const node of (layout.children || [])) {
    const label = node.labels?.[0]?.text || node.id;
    const pageId = node.pageId || node.id;
    const stateId = node.stateId;
    // Find screenshot file — may have a step-number prefix like "01-pageId.png"
    const basePattern = stateId ? `${pageId}--${stateId}.png` : `${pageId}.png`;
    let screenshotPath = null;
    if (screenshotDir && typeof node.manifestIndex === 'number') {
      const manifestEntry = manifestEntries[node.manifestIndex];
      if (manifestEntry?.file) {
        const manifestPath = join(screenshotDir, manifestEntry.file);
        if (existsSync(manifestPath)) {
          screenshotPath = manifestPath;
        }
      }
    }
    if (!screenshotPath) {
      screenshotPath = screenshotDir ? findScreenshot(screenshotDir, basePattern) : null;
    }
    if (!screenshotPath && screenshotDir && typeof node.visitIndex === 'number') {
      const fallbackEntry = manifestEntries[node.visitIndex];
      if (fallbackEntry?.file) {
        const fallbackPath = join(screenshotDir, fallbackEntry.file);
        if (existsSync(fallbackPath)) {
          screenshotPath = fallbackPath;
        }
      }
    }

    let screenshotFile = screenshotPath ? basename(screenshotPath) : null;
    if (!screenshotFile && typeof node.manifestIndex === 'number') {
      screenshotFile = manifestEntries[node.manifestIndex]?.file || null;
    }

    let thumbHtml = '<div class="node-no-thumb">No screenshot</div>';
    let screenshotAttr = '';
    const asset = screenshotFile ? assetMap.get(screenshotFile) : null;

    if (embedScreenshots && asset) {
      thumbHtml = `<img class="node-thumb" src="${asset.thumbUrl}" alt="${escapeHtml(label)}">`;
      screenshotAttr = ` data-screenshot="${asset.fullUrl}"`;
    }

    lines.push(
      `<div class="node" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px" data-label="${escapeHtml(label)}"${screenshotAttr}>` +
      `<div class="node-label">${escapeHtml(label)}</div>` +
      thumbHtml +
      `</div>`
    );
  }

  return lines.join('\n');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Generate journey map visualization.
 */
export async function map(opts) {
  const config = loadConfig(opts.config);
  const mapDir = join(resolve(opts.mapDir || dirname(resolve(opts.config))), 'maps');
  mkdirSync(mapDir, { recursive: true });

  const screenshotDir = opts.embedScreenshots
    ? opts.screenshotDir || null
    : null;
  const manifest = opts.embedScreenshots ? loadManifest(screenshotDir) : [];

  const format = opts.format || 'html';

  console.log(`Generating journey map...`);

  const layout = await computeLayout(config, null);
  const assetMap = opts.embedScreenshots
    ? await ensureMapAssets(screenshotDir, mapDir, manifest, opts.fullScreenshotUrlForFile || ((file) => file))
    : new Map();

  // Compute canvas size
  const canvasWidth = Math.max(...(layout.children || []).map(n => n.x + n.width)) + 100;
  const canvasHeight = Math.max(...(layout.children || []).map(n => n.y + n.height)) + 100;

  // Build HTML content
  const nodesHtml = renderNodes(layout, screenshotDir, opts.embedScreenshots, manifest, assetMap);
  const edgesSvg = renderEdgesSvg(layout);
  const svgTag = `<svg class="edges" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">\n${edgesSvg}\n</svg>`;
  const contentHtml = svgTag + '\n' + nodesHtml;

  // Load template and substitute
  const template = readFileSync(templatePath, 'utf8');
  const title = config.name;
  const subtitle = `${config.steps?.length || 0} step(s)`;

  const html = template
    .replace(/\{\{TITLE\}\}/g, escapeHtml(title))
    .replace(/\{\{SUBTITLE\}\}/g, escapeHtml(subtitle))
    .replace('{{CONTENT}}', contentHtml);

  const baseName = 'journey-map';

  // Write HTML
  if (format === 'html' || format === 'all') {
    const htmlPath = join(mapDir, `${baseName}.html`);
    writeFileSync(htmlPath, html, 'utf8');
    console.log(`  HTML: ${htmlPath}`);
  }

  // Write PNG/SVG using Playwright to screenshot the HTML
  if (format === 'png' || format === 'svg' || format === 'all') {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Load the HTML content
    await page.setContent(html, { waitUntil: 'networkidle' });

    // Set viewport to fit the graph
    await page.setViewportSize({
      width: Math.ceil(canvasWidth + 80),
      height: Math.ceil(canvasHeight + 128)
    });

    if (format === 'png' || format === 'all') {
      const pngPath = join(mapDir, `${baseName}.png`);
      await page.screenshot({ path: pngPath, fullPage: true });
      console.log(`  PNG: ${pngPath}`);
    }

    if (format === 'svg' || format === 'all') {
      // Extract the SVG element content
      const svgContent = await page.evaluate(() => {
        const svg = document.querySelector('svg.edges');
        if (!svg) return null;
        // Clone and add xmlns
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return clone.outerHTML;
      });

      if (svgContent) {
        const svgPath = join(mapDir, `${baseName}.svg`);
        writeFileSync(svgPath, svgContent, 'utf8');
        console.log(`  SVG: ${svgPath}`);
      }
    }

    await browser.close();
  }

  console.log('Done.');
}
