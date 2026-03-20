import express from 'express';
import cors from 'cors';
import { resolve, join, dirname } from 'path';
import { existsSync, readFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { loadConfig, writeConfig } from './config.js';
import { loadRegistry, getConfigPath, getScreenshotDir, getJourneyDir, getProjectDir, getMapDir, createProject, slugify } from './registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Start the recording server that receives events from the browser extension
 * and serves the dashboard UI.
 */
export async function startServer(opts) {
  const port = opts.port || 4444;

  // In-memory recording state
  const state = {
    isRecording: false,
    baseUrl: null,
    name: '',
    projectSlug: '',
    pages: new Map(),
    edges: [],
    lastPageId: null,
  };

  let captureInProgress = false;

  function pathToId(urlPath) {
    const cleaned = urlPath.replace(/^\/|\/$/g, '').replace(/\//g, '-');
    return cleaned || 'start';
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Serve dashboard static files
  app.use('/dashboard', express.static(join(__dirname, '..', 'dashboard')));
  app.get('/', (req, res) => res.redirect('/dashboard/'));

  // --- Project endpoints ---

  app.get('/api/projects', (req, res) => {
    try {
      res.json(loadRegistry());
    } catch {
      res.status(500).json({ error: 'Failed to load project registry' });
    }
  });

  app.post('/api/projects', (req, res) => {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    try {
      const slug = slugify(name);
      createProject(slug);
      res.json({ slug, name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/journeys/:project/:journey', (req, res) => {
    const { project, journey } = req.params;
    if (!project || !journey) {
      return res.status(400).json({ error: 'project and journey are required' });
    }

    const projectDir = resolve(getProjectDir(project));
    const journeyDir = resolve(getJourneyDir(project, journey));

    if (!journeyDir.startsWith(projectDir)) {
      return res.status(403).json({ error: 'Invalid journey path' });
    }
    if (!existsSync(journeyDir)) {
      return res.status(404).json({ error: 'Journey not found' });
    }

    try {
      rmSync(journeyDir, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Config endpoint ---

  app.get('/api/config', (req, res) => {
    const { project, journey } = req.query;
    if (!project || !journey) {
      return res.status(400).json({ error: 'project and journey query params required' });
    }

    const cfgPath = getConfigPath(project, journey);
    if (!existsSync(cfgPath)) {
      return res.json({ error: 'No config found', pages: [], steps: [] });
    }
    try {
      const config = loadConfig(cfgPath);
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Screenshot endpoints ---

  app.get('/api/screenshots', (req, res) => {
    const { project, journey, file } = req.query;
    if (!project || !journey) {
      return res.status(400).json({ error: 'project and journey query params required' });
    }

    const screenshotDir = getScreenshotDir(project, journey);

    if (file) {
      const filePath = resolve(screenshotDir, file);
      if (!filePath.startsWith(getJourneyDir(project, journey))) {
        return res.status(403).json({ error: 'Invalid path' });
      }
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.sendFile(filePath);
    }

    const manifestPath = join(screenshotDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      return res.json([]);
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      res.json(manifest);
    } catch {
      res.json([]);
    }
  });

  app.get('/api/screenshots/:project/:journey/:file', (req, res) => {
    const { project, journey, file } = req.params;
    if (!project || !journey || !file) {
      return res.status(400).json({ error: 'project, journey, and file are required' });
    }

    const screenshotDir = getScreenshotDir(project, journey);
    const filePath = resolve(screenshotDir, file);
    if (!filePath.startsWith(screenshotDir)) {
      return res.status(403).json({ error: 'Invalid path' });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    return res.sendFile(filePath);
  });

  // --- Map endpoints ---

  app.get('/api/map', (req, res) => {
    const { project, journey } = req.query;
    if (!project || !journey) {
      return res.status(400).json({ error: 'project and journey query params required' });
    }

    const mapDir = getMapDir(project, journey);
    const mapPath = join(mapDir, 'journey-map.html');
    res.json({
      exists: existsSync(mapPath),
      url: `/api/maps/${encodeURIComponent(project)}/${encodeURIComponent(journey)}/journey-map.html`
    });
  });

  app.post('/api/map', async (req, res) => {
    const { project, journey, embedScreenshots = true, format = 'html' } = req.body;
    if (!project || !journey) {
      return res.status(400).json({ error: 'project and journey are required' });
    }

    const cfgPath = getConfigPath(project, journey);
    if (!existsSync(cfgPath)) {
      return res.status(404).json({ error: 'No config found for this journey' });
    }

    try {
      const { map } = await import('./map.js');
      await map({
        config: cfgPath,
        mapDir: getJourneyDir(project, journey),
        screenshotDir: getScreenshotDir(project, journey),
        format,
        embedScreenshots,
        fullScreenshotUrlForFile: (file) =>
          `/api/screenshots/${encodeURIComponent(project)}/${encodeURIComponent(journey)}/${encodeURIComponent(file)}`
      });
      res.json({
        ok: true,
        url: `/api/maps/${encodeURIComponent(project)}/${encodeURIComponent(journey)}/journey-map.html`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/maps/:project/:journey/:file', (req, res) => {
    const { project, journey, file } = req.params;
    if (!project || !journey || !file) {
      return res.status(400).json({ error: 'project, journey, and file are required' });
    }

    const mapDir = resolve(getMapDir(project, journey));
    const filePath = resolve(mapDir, file);
    if (!filePath.startsWith(mapDir)) {
      return res.status(403).json({ error: 'Invalid path' });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    return res.sendFile(filePath);
  });

  app.get('/api/maps/:project/:journey/:folder/:file', (req, res) => {
    const { project, journey, folder, file } = req.params;
    if (!project || !journey || !folder || !file) {
      return res.status(400).json({ error: 'project, journey, folder, and file are required' });
    }

    if (folder !== 'thumbs') {
      return res.status(404).json({ error: 'Unknown map asset folder' });
    }

    const mapDir = resolve(getMapDir(project, journey));
    const filePath = resolve(join(mapDir, folder, file));
    if (!filePath.startsWith(mapDir)) {
      return res.status(403).json({ error: 'Invalid path' });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    return res.sendFile(filePath);
  });

  // --- Capture SSE endpoint ---

  app.get('/api/capture/events', async (req, res) => {
    const { project, journey } = req.query;
    if (!project || !journey) {
      return res.status(400).json({ error: 'project and journey query params required' });
    }
    if (captureInProgress) {
      return res.status(409).json({ error: 'Capture already in progress' });
    }

    const cfgPath = getConfigPath(project, journey);
    if (!existsSync(cfgPath)) {
      return res.status(404).json({ error: 'No config found for this journey' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    captureInProgress = true;

    try {
      const { capture } = await import('./capture.js');
      await capture({
        config: cfgPath,
        screenshotDir: getScreenshotDir(project, journey)
      }, (event) => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      });

      res.write(`event: complete\ndata: ${JSON.stringify({ totalCaptured: 'done' })}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    }

    captureInProgress = false;
    res.end();
  });

  // --- Deploy endpoint ---

  app.post('/api/deploy', async (req, res) => {
    const { project, journey } = req.body;
    if (!project || !journey) {
      return res.status(400).json({ error: 'project and journey are required' });
    }

    const cfgPath = getConfigPath(project, journey);
    try {
      const { deploy } = await import('./deploy.js');
      await deploy({
        config: cfgPath,
        screenshotDir: getScreenshotDir(project, journey)
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Recording endpoints (used by browser extension) ---

  app.get('/api/recording', (req, res) => {
    res.json({
      isRecording: state.isRecording,
      pages: state.pages.size,
      edges: state.edges.length
    });
  });

  app.post('/api/recording/start', (req, res) => {
    state.isRecording = true;
    state.baseUrl = req.body.baseUrl || null;
    state.name = req.body.name || '';
    state.projectSlug = req.body.projectSlug || '';
    state.pages.clear();
    state.edges = [];
    state.lastPageId = null;

    const journeySlug = slugify(state.name);
    console.log(`Recording started${state.baseUrl ? ` for ${state.baseUrl}` : ''}${state.projectSlug ? ` → projects/${state.projectSlug}/${journeySlug}` : ''}`);
    res.json({ ok: true });
  });

  app.post('/api/recording/stop', (req, res) => {
    state.isRecording = false;
    console.log('Recording stopped');

    if (!state.projectSlug) {
      return res.status(400).json({ error: 'No project selected' });
    }
    if (!state.name) {
      return res.status(400).json({ error: 'No journey name set' });
    }

    const journeySlug = slugify(state.name);
    const targetConfig = getConfigPath(state.projectSlug, journeySlug);

    const config = buildConfig(state);
    const writtenPath = writeConfig(targetConfig, config);

    console.log(`\nRecorded ${state.pages.size} page(s) and ${state.edges.length} connection(s)`);
    console.log(`Config written to: ${writtenPath}`);

    res.json({ ok: true, configPath: writtenPath, pages: state.pages.size, edges: state.edges.length });
  });

  app.post('/api/recording/navigation', (req, res) => {
    if (!state.isRecording) return res.json({ ok: false, reason: 'not recording' });

    const { url, title, clickText } = req.body;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (!state.baseUrl) {
      state.baseUrl = parsed.origin;
    }

    const path = parsed.pathname;
    const pageId = pathToId(path);

    if (!state.pages.has(path)) {
      state.pages.set(path, {
        id: pageId,
        path,
        label: title || pageId,
        formSubmissions: [],
        params: new Set()
      });
    } else if (title) {
      state.pages.get(path).label = title;
    }

    for (const key of parsed.searchParams.keys()) {
      state.pages.get(path).params.add(key);
    }

    if (state.lastPageId && state.lastPageId !== pageId) {
      const edgeLabel = clickText || '';
      state.edges.push({
        from: state.lastPageId,
        to: pageId,
        label: edgeLabel
      });
    }

    state.lastPageId = pageId;

    console.log(`  nav: ${path}${title ? ` — ${title}` : ''}`);
    res.json({ ok: true });
  });

  app.post('/api/recording/form', (req, res) => {
    if (!state.isRecording) return res.json({ ok: false, reason: 'not recording' });

    const { url, fields, submitSelector } = req.body;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const path = parsed.pathname;

    if (!state.pages.has(path)) {
      state.pages.set(path, {
        id: pathToId(path),
        path,
        label: '',
        formSubmissions: [],
        params: new Set()
      });
    }

    state.pages.get(path).formSubmissions.push({
      fields: fields || [],
      submitSelector: submitSelector || null
    });

    const fieldCount = fields ? fields.length : 0;
    console.log(`  form: ${path} — ${fieldCount} field(s)`);
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  app.listen(port, () => {
    console.log(`\nPrototype Map`);
    console.log(`Dashboard:  http://localhost:${port}/dashboard/`);
    console.log(`Server:     http://localhost:${port}`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  });
}

// --- Config building helpers ---

function buildConfig(state) {
  const pages = buildPagesList(state);
  const steps = buildSteps(state);

  return {
    name: state.name || 'Recorded journey',
    baseUrl: state.baseUrl || 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    pages,
    steps
  };
}

function buildPagesList(state) {
  return Array.from(state.pages.values()).map(p => {
    const entry = { id: p.id, path: p.path };
    if (p.label) entry.label = p.label;

    const states = [];

    if (p.formSubmissions && p.formSubmissions.length > 0) {
      for (let i = 0; i < p.formSubmissions.length; i++) {
        const submission = p.formSubmissions[i];
        const baseLabel = p.label || p.id;
        const stateEntry = {
          id: i === 0 ? 'submitted' : `submitted-${i + 1}`,
          label: i === 0 ? baseLabel : `${baseLabel} (${i + 1})`
        };

        if (submission.fields.length > 0) {
          stateEntry.formData = submission.fields.map(f => {
            const fd = { field: f.selector };
            if (f.type === 'click') {
              fd.action = 'click';
            } else if (f.type === 'checkbox' || f.type === 'radio') {
              fd.action = f.checked ? 'check' : 'uncheck';
            } else if (f.type === 'select-one' || f.type === 'select-multiple') {
              fd.value = f.value;
              fd.action = 'select';
            } else {
              fd.value = f.value || '';
            }
            return fd;
          });
        }

        if (submission.submitSelector) {
          stateEntry.submit = submission.submitSelector;
        } else {
          stateEntry.submit = true;
        }

        states.push(stateEntry);
      }
    }

    if (p.params && p.params.size > 0) {
      for (const param of p.params) {
        states.push({
          id: param,
          label: `With ${param}`,
          params: { [param]: 'true' }
        });
      }
    }

    if (states.length > 0) {
      entry.states = states;
    }

    return entry;
  });
}

function buildSteps(state) {
  const seenEdges = new Set();
  const uniqueEdges = state.edges.filter(e => {
    const key = `${e.from}->${e.to}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });

  return uniqueEdges.map(e => {
    const step = { from: e.from, to: e.to };
    if (e.label) step.label = e.label;
    return step;
  });
}
