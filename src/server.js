import express from 'express';
import cors from 'cors';
import { resolve, join, dirname } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { loadConfig, writeConfig } from './config.js';
import { loadRegistry, registerProject, removeProject } from './registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Start the recording server that receives events from the browser extension
 * and serves the dashboard UI.
 */
export async function startServer(opts) {
  const configPath = resolve(opts.config);
  const port = opts.port || 4444;

  // In-memory recording state
  const state = {
    isRecording: false,
    round: 1,
    baseUrl: null,
    name: '',
    projectPath: '',
    pages: new Map(),
    edges: [],
    lastPageId: null,
    lastClickText: null,
  };

  // Track in-progress capture
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

  // --- Project registry endpoints ---

  app.get('/api/projects', (req, res) => {
    try {
      res.json(loadRegistry());
    } catch {
      res.status(500).json({ error: 'Failed to load project registry' });
    }
  });

  app.post('/api/projects', (req, res) => {
    const { name, path, baseUrl } = req.body;
    if (!name || !path) {
      return res.status(400).json({ error: 'Name and path are required' });
    }
    try {
      const expanded = path.replace(/^~(?=$|\/)/, homedir());
      const entry = registerProject({ name, path: resolve(expanded), baseUrl });
      res.json(entry);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/projects', (req, res) => {
    const projectPath = req.query.project;
    if (!projectPath) return res.status(400).json({ error: 'project query param required' });
    try {
      removeProject(projectPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Config endpoint ---

  app.get('/api/config', (req, res) => {
    const projectPath = req.query.project;
    if (!projectPath) return res.status(400).json({ error: 'project query param required' });

    const cfgPath = resolve(projectPath, '.prototype-map', 'config.yaml');
    if (!existsSync(cfgPath)) {
      return res.json({ error: 'No config found', pages: [], journeys: [] });
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
    const { project, round, file } = req.query;
    if (!project) return res.status(400).json({ error: 'project query param required' });

    const projects = loadRegistry();
    if (!projects.find(p => p.path === project)) {
      return res.status(403).json({ error: 'Unknown project' });
    }

    const screenshotDir = resolve(project, '.prototype-map', 'output', 'screenshots', `round-${round || 1}`);

    // If a file is requested, serve it directly
    if (file) {
      const filePath = resolve(screenshotDir, file);
      // Security: ensure path is within the project
      if (!filePath.startsWith(resolve(project))) {
        return res.status(403).json({ error: 'Invalid path' });
      }
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.sendFile(filePath);
    }

    // Otherwise return the manifest
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

  // --- Capture SSE endpoint ---

  app.get('/api/capture/events', async (req, res) => {
    const { project, round, journey } = req.query;
    if (!project) return res.status(400).json({ error: 'project query param required' });
    if (captureInProgress) return res.status(409).json({ error: 'Capture already in progress' });

    const cfgPath = resolve(project, '.prototype-map', 'config.yaml');
    if (!existsSync(cfgPath)) {
      return res.status(404).json({ error: 'No config found for this project' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    captureInProgress = true;

    try {
      const { capture } = await import('./capture.js');
      await capture({
        config: cfgPath,
        out: resolve(project, '.prototype-map', 'output'),
        round: round || undefined,
        journey: journey || undefined
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
    const { project, round } = req.body;
    if (!project) return res.status(400).json({ error: 'project is required' });

    const cfgPath = resolve(project, '.prototype-map', 'config.yaml');
    try {
      const { deploy } = await import('./deploy.js');
      await deploy({
        config: cfgPath,
        out: resolve(project, '.prototype-map', 'output'),
        round: round || undefined
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
    state.round = req.body.round || 1;
    state.baseUrl = req.body.baseUrl || null;
    state.name = req.body.name || '';
    state.projectPath = req.body.projectPath || '';
    state.pages.clear();
    state.edges = [];
    state.lastPageId = null;
    state.lastClickText = null;
    console.log(`Recording started (round ${state.round})${state.baseUrl ? ` for ${state.baseUrl}` : ''}${state.projectPath ? ` → ${state.projectPath}` : ''}`);
    res.json({ ok: true });
  });

  app.post('/api/recording/stop', (req, res) => {
    state.isRecording = false;
    console.log('Recording stopped');

    const targetConfig = state.projectPath
      ? resolve(state.projectPath, '.prototype-map', 'config.yaml')
      : configPath;

    const config = buildConfig(state, targetConfig);
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
      const edgeLabel = clickText || state.lastClickText || '';
      state.edges.push({
        from: state.lastPageId,
        to: pageId,
        label: edgeLabel
      });
    }

    state.lastPageId = pageId;
    state.lastClickText = clickText || null;

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

  app.listen(port, () => {
    console.log(`\nPrototype Map`);
    console.log(`Dashboard:  http://localhost:${port}/dashboard/`);
    console.log(`Server:     http://localhost:${port}`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  });
}

// --- Config building helpers ---

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'journey';
}

function buildPagesList(state) {
  return Array.from(state.pages.values()).map(p => {
    const entry = { id: p.id, path: p.path };
    if (p.label) entry.label = p.label;

    const states = [];

    if (p.formSubmissions && p.formSubmissions.length > 0) {
      for (let i = 0; i < p.formSubmissions.length; i++) {
        const submission = p.formSubmissions[i];
        const stateEntry = {
          id: i === 0 ? 'submitted' : `submitted-${i + 1}`,
          label: i === 0 ? 'Form submitted' : `Form submitted (${i + 1})`
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

function buildJourney(state) {
  const seenEdges = new Set();
  const uniqueEdges = state.edges.filter(e => {
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

  if (journeySteps.length === 0) return null;

  const label = state.name || 'Recorded journey';
  return {
    id: slugify(label),
    label,
    round: state.round,
    steps: journeySteps
  };
}

function buildConfig(state, configPath) {
  const pagesList = buildPagesList(state);
  const newJourney = buildJourney(state);

  let existingConfig = null;
  if (existsSync(configPath)) {
    try {
      existingConfig = loadConfig(configPath);
    } catch {
      // ignore invalid existing config
    }
  }

  if (existingConfig) {
    existingConfig.round = state.round;

    const existingPageMap = new Map(existingConfig.pages.map(p => [p.id, p]));
    for (const page of pagesList) {
      if (existingPageMap.has(page.id)) {
        const existing = existingPageMap.get(page.id);
        if (page.states) {
          existing.states = page.states;
        }
        if (page.label) {
          existing.label = page.label;
        }
      } else {
        existingConfig.pages.push(page);
      }
    }

    if (newJourney) {
      existingConfig.journeys = existingConfig.journeys || [];
      const existingIdx = existingConfig.journeys.findIndex(
        j => j.label === newJourney.label
      );
      if (existingIdx >= 0) {
        existingConfig.journeys[existingIdx] = newJourney;
      } else {
        existingConfig.journeys.push(newJourney);
      }
    }

    return existingConfig;
  }

  const config = {
    name: state.name || pagesList[0]?.label || 'Recorded prototype',
    baseUrl: state.baseUrl || 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    round: state.round,
    pages: pagesList,
    journeys: newJourney ? [newJourney] : []
  };

  return config;
}
