import express from 'express';
import cors from 'cors';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig, writeConfig } from './config.js';

/**
 * Start the recording server that receives events from the browser extension.
 */
export async function startServer(opts) {
  const configPath = resolve(opts.config);
  const port = opts.port || 4444;

  // In-memory recording state
  const state = {
    isRecording: false,
    baseUrl: null,
    name: '',
    description: '',
    pages: new Map(),     // path → { id, path, label, formData[] }
    edges: [],            // { from, to, label }
    lastPageId: null,
    lastClickText: null,
  };

  function pathToId(urlPath) {
    const cleaned = urlPath.replace(/^\/|\/$/g, '').replace(/\//g, '-');
    return cleaned || 'start';
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // GET /api/recording — status
  app.get('/api/recording', (req, res) => {
    res.json({
      isRecording: state.isRecording,
      pages: state.pages.size,
      edges: state.edges.length
    });
  });

  // POST /api/recording/start — begin recording
  app.post('/api/recording/start', (req, res) => {
    state.isRecording = true;
    state.baseUrl = req.body.baseUrl || null;
    state.name = req.body.name || '';
    state.description = req.body.description || '';
    state.pages.clear();
    state.edges = [];
    state.lastPageId = null;
    state.lastClickText = null;
    console.log(`Recording started${state.baseUrl ? ` for ${state.baseUrl}` : ''}`);
    res.json({ ok: true });
  });

  // POST /api/recording/stop — stop recording and write config
  app.post('/api/recording/stop', (req, res) => {
    state.isRecording = false;
    console.log('Recording stopped');

    const config = buildConfig(state, configPath);
    const writtenPath = writeConfig(configPath, config);

    console.log(`\nRecorded ${state.pages.size} page(s) and ${state.edges.length} connection(s)`);
    console.log(`Config written to: ${writtenPath}`);

    res.json({ ok: true, configPath: writtenPath, pages: state.pages.size, edges: state.edges.length });
  });

  // POST /api/recording/navigation — page navigation event
  app.post('/api/recording/navigation', (req, res) => {
    if (!state.isRecording) return res.json({ ok: false, reason: 'not recording' });

    const { url, title, clickText } = req.body;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Set baseUrl from first navigation
    if (!state.baseUrl) {
      state.baseUrl = parsed.origin;
    }

    const path = parsed.pathname;
    const pageId = pathToId(path);

    // Register page if new
    if (!state.pages.has(path)) {
      state.pages.set(path, {
        id: pageId,
        path,
        label: title || pageId,
        formSubmissions: []
      });
    } else if (title) {
      // Update label if we get a better title
      state.pages.get(path).label = title;
    }

    // Record edge from previous page
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

  // POST /api/recording/form — form submission with field values
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

    // Ensure page exists
    if (!state.pages.has(path)) {
      state.pages.set(path, {
        id: pathToId(path),
        path,
        label: '',
        formSubmissions: []
      });
    }

    // Store this form submission
    state.pages.get(path).formSubmissions.push({
      fields: fields || [],
      submitSelector: submitSelector || null
    });

    const fieldCount = fields ? fields.length : 0;
    console.log(`  form: ${path} — ${fieldCount} field(s)`);
    res.json({ ok: true });
  });

  app.listen(port, () => {
    console.log(`\nPrototype Map recording server`);
    console.log(`Listening on http://localhost:${port}`);
    console.log(`Config will be written to: ${configPath}\n`);
    console.log('Install the extension, set the port, and start recording.');
    console.log('Press Ctrl+C to stop the server.\n');
  });
}

/**
 * Build a prototype-map config from recorded state.
 */
function buildConfig(state, configPath) {
  // Try to load existing config for merging
  let existingConfig = null;
  if (existsSync(configPath)) {
    try {
      existingConfig = loadConfig(configPath);
    } catch {
      // ignore invalid existing config
    }
  }

  const pagesList = Array.from(state.pages.values()).map(p => {
    const entry = { id: p.id, path: p.path };
    if (p.label) entry.label = p.label;

    // Convert form submissions into states with formData
    if (p.formSubmissions && p.formSubmissions.length > 0) {
      entry.states = p.formSubmissions.map((submission, i) => {
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

        return stateEntry;
      });
    }

    return entry;
  });

  // Deduplicate edges
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

  const config = {
    name: state.name || pagesList[0]?.label || 'Recorded prototype',
    baseUrl: state.baseUrl || 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    round: 1,
    pages: pagesList,
    journeys: journeySteps.length > 0 ? [{
      id: 'recorded',
      label: 'Recorded journey',
      steps: journeySteps
    }] : []
  };

  if (state.description) {
    config.description = state.description;
  }

  return config;
}
