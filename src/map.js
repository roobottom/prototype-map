import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
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

/**
 * Build HTML content for nodes from ELK layout result.
 */
function renderNodes(layout, screenshotDir, embedScreenshots) {
  const lines = [];

  for (const node of (layout.children || [])) {
    const label = node.labels?.[0]?.text || node.id;
    const pageId = node.pageId || node.id;
    const stateId = node.stateId;
    // Find screenshot file — may have a step-number prefix like "01-pageId.png"
    const basePattern = stateId ? `${pageId}--${stateId}.png` : `${pageId}.png`;
    const screenshotPath = screenshotDir ? findScreenshot(screenshotDir, basePattern) : null;

    let thumbHtml = '<div class="node-no-thumb">No screenshot</div>';
    let screenshotAttr = '';

    if (embedScreenshots && screenshotPath && existsSync(screenshotPath)) {
      const imgData = readFileSync(screenshotPath);
      const base64 = imgData.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      thumbHtml = `<img class="node-thumb" src="${dataUrl}" alt="${escapeHtml(label)}">`;
      screenshotAttr = ` data-screenshot="${dataUrl}"`;
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
  const outDir = resolve(opts.out);
  const mapDir = join(outDir, 'maps');
  mkdirSync(mapDir, { recursive: true });

  const round = opts.round ? Number(opts.round) : config.round;
  const screenshotDir = opts.embedScreenshots
    ? join(outDir, 'screenshots', `round-${round}`)
    : null;

  const journeyId = opts.journey || null;
  const format = opts.format || 'html';

  console.log(`Generating journey map...`);

  const layout = await computeLayout(config, journeyId);

  // Compute canvas size
  const canvasWidth = Math.max(...(layout.children || []).map(n => n.x + n.width)) + 100;
  const canvasHeight = Math.max(...(layout.children || []).map(n => n.y + n.height)) + 100;

  // Build HTML content
  const nodesHtml = renderNodes(layout, screenshotDir, opts.embedScreenshots);
  const edgesSvg = renderEdgesSvg(layout);
  const svgTag = `<svg class="edges" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">\n${edgesSvg}\n</svg>`;
  const contentHtml = svgTag + '\n' + nodesHtml;

  // Load template and substitute
  const template = readFileSync(templatePath, 'utf8');
  const title = config.name;
  const subtitle = journeyId
    ? config.journeys.find(j => j.id === journeyId)?.label || journeyId
    : `${config.journeys.length} journey(s)`;

  const html = template
    .replace(/\{\{TITLE\}\}/g, escapeHtml(title))
    .replace(/\{\{SUBTITLE\}\}/g, escapeHtml(subtitle))
    .replace('{{CONTENT}}', contentHtml);

  const baseName = journeyId || 'all-journeys';

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
