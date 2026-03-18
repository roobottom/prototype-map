import express from 'express';
import cors from 'cors';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadConfig, writeConfig } from './config.js';
import { loadRegistry } from './registry.js';

/**
 * Start the recording server that receives events from the browser extension.
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
    projectPath: '',      // project directory selected from extension
    pages: new Map(),     // path → { id, path, label, formSubmissions[], params: Set }
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

  // GET /api/projects — list registered projects
  app.get('/api/projects', (req, res) => {
    try {
      const projects = loadRegistry();
      res.json(projects);
    } catch {
      res.status(500).json({ error: 'Failed to load project registry' });
    }
  });

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

  // POST /api/recording/stop — stop recording and write config
  app.post('/api/recording/stop', (req, res) => {
    state.isRecording = false;
    console.log('Recording stopped');

    // Write to the selected project's config, or fall back to the server's default
    const targetConfig = state.projectPath
      ? resolve(state.projectPath, '.prototype-map', 'config.yaml')
      : configPath;

    const config = buildConfig(state, targetConfig);
    const writtenPath = writeConfig(targetConfig, config);

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
        formSubmissions: [],
        params: new Set()
      });
    } else if (title) {
      // Update label if we get a better title
      state.pages.get(path).label = title;
    }

    // Track query parameters as potential states
    for (const key of parsed.searchParams.keys()) {
      state.pages.get(path).params.add(key);
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
        formSubmissions: [],
        params: new Set()
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
 * Slugify a string into a URL/ID-safe form.
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'journey';
}

/**
 * Build page list from recorded state.
 */
function buildPagesList(state) {
  return Array.from(state.pages.values()).map(p => {
    const entry = { id: p.id, path: p.path };
    if (p.label) entry.label = p.label;

    const states = [];

    // Convert form submissions into states with formData
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

    // Convert detected query parameters into states
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

/**
 * Build a journey object from recorded edges.
 */
function buildJourney(state) {
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

  if (journeySteps.length === 0) return null;

  const label = state.name || 'Recorded journey';
  return {
    id: slugify(label),
    label,
    round: state.round,
    steps: journeySteps
  };
}

/**
 * Build a prototype-map config from recorded state.
 * Automatically merges with existing config if present —
 * matching journeys (by name) are replaced, new ones are added.
 */
function buildConfig(state, configPath) {
  const pagesList = buildPagesList(state);
  const newJourney = buildJourney(state);

  // Try to load existing config for merging
  let existingConfig = null;
  if (existsSync(configPath)) {
    try {
      existingConfig = loadConfig(configPath);
    } catch {
      // ignore invalid existing config
    }
  }

  if (existingConfig) {
    // Update round
    existingConfig.round = state.round;

    // Merge pages: add new ones, update existing ones with new states
    const existingPageMap = new Map(existingConfig.pages.map(p => [p.id, p]));
    for (const page of pagesList) {
      if (existingPageMap.has(page.id)) {
        // Update the existing page's states with the new recording's states
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

    // Match journey by label — replace if found, append if new
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

  // Fresh config
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
