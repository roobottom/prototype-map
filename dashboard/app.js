const API = window.location.origin;
let currentProject = null;

// --- API helpers ---

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

async function getProjects() {
  return api('/api/projects');
}

async function addProject({ name, baseUrl }) {
  return api('/api/projects', { method: 'POST', body: { name, baseUrl } });
}

async function getConfig(slug) {
  return api(`/api/config?project=${encodeURIComponent(slug)}`);
}

async function getManifest(slug, round) {
  return api(`/api/screenshots?project=${encodeURIComponent(slug)}&round=${round}`);
}

function screenshotUrl(slug, round, file) {
  return `${API}/api/screenshots?project=${encodeURIComponent(slug)}&round=${round}&file=${encodeURIComponent(file)}`;
}

// --- Render functions ---

async function renderProjectList() {
  const list = document.getElementById('projectList');
  const projects = await getProjects();

  list.innerHTML = '';
  for (const project of projects) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="project-item-name">${esc(project.name)}</span>
      <span class="project-url">${esc(project.baseUrl)}</span>
    `;
    if (currentProject?.slug === project.slug) {
      li.classList.add('active');
    }
    li.addEventListener('click', () => selectProject(project));
    list.appendChild(li);
  }
}

async function selectProject(project) {
  currentProject = project;
  await renderProjectList();
  await renderProjectDetail();
}

async function renderProjectDetail() {
  const main = document.getElementById('main');
  const tpl = document.getElementById('projectDetailTpl');
  const clone = tpl.content.cloneNode(true);

  main.innerHTML = '';
  main.appendChild(clone);

  const nameEl = main.querySelector('.project-name');
  const metaEl = main.querySelector('.project-meta');
  nameEl.textContent = currentProject.name;
  metaEl.textContent = `${currentProject.baseUrl} \u2022 projects/${currentProject.slug}/`;

  // Load config
  let config = null;
  try {
    const res = await getConfig(currentProject.slug);
    if (!res.error) config = res;
  } catch { /* no config yet */ }

  // Set round from config
  const roundInput = main.querySelector('#roundSelect');
  if (config?.round) roundInput.value = config.round;

  // Render journeys
  const journeyList = main.querySelector('#journeyList');
  if (config?.journeys?.length > 0) {
    journeyList.innerHTML = '';
    for (const j of config.journeys) {
      const card = document.createElement('div');
      card.className = 'journey-card';
      card.innerHTML = `
        <div class="journey-card-info">
          <span class="journey-card-label">${esc(j.label || j.id)}</span>
          <span class="journey-card-meta">${j.steps.length} step(s) \u2022 round ${j.round || '?'}</span>
        </div>
        <button class="btn btn-small" data-journey="${esc(j.id)}">Capture</button>
      `;
      card.querySelector('button').addEventListener('click', () => {
        runCapture(roundInput.value, j.id);
      });
      journeyList.appendChild(card);
    }
  }

  // Load screenshots
  const round = roundInput.value;
  await renderScreenshots(round);

  // Wire up capture all button
  main.querySelector('#captureBtn').addEventListener('click', () => {
    runCapture(roundInput.value);
  });

  // Wire up deploy button
  main.querySelector('#deployBtn').addEventListener('click', () => {
    runDeploy(roundInput.value);
  });

  // Re-render screenshots when round changes
  roundInput.addEventListener('change', () => {
    renderScreenshots(roundInput.value);
  });
}

async function renderScreenshots(round) {
  const grid = document.getElementById('screenshotGrid');
  if (!grid) return;

  let manifest;
  try {
    manifest = await getManifest(currentProject.slug, round);
    if (manifest.error || !Array.isArray(manifest)) {
      grid.innerHTML = '<p class="muted">No screenshots for this round. Run a capture first.</p>';
      return;
    }
  } catch {
    grid.innerHTML = '<p class="muted">No screenshots for this round. Run a capture first.</p>';
    return;
  }

  if (manifest.length === 0) {
    grid.innerHTML = '<p class="muted">No screenshots for this round. Run a capture first.</p>';
    return;
  }

  grid.innerHTML = '';
  for (const entry of manifest) {
    const card = document.createElement('div');
    card.className = 'screenshot-card';
    const imgSrc = screenshotUrl(currentProject.slug, round, entry.file);
    card.innerHTML = `
      <img src="${imgSrc}" alt="${esc(entry.title)}" loading="lazy">
      <div class="screenshot-card-info">
        <div class="screenshot-card-title">${esc(entry.title)}</div>
        <div class="screenshot-card-file">${esc(entry.file)}</div>
      </div>
    `;
    card.addEventListener('click', () => openLightbox(imgSrc, entry.title));
    grid.appendChild(card);
  }
}

// --- Capture via SSE ---

function runCapture(round, journeyId) {
  const progress = document.getElementById('captureProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const captureBtn = document.getElementById('captureBtn');

  progress.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = 'Starting capture...';
  captureBtn.disabled = true;

  let params = `project=${encodeURIComponent(currentProject.slug)}&round=${round}`;
  if (journeyId) params += `&journey=${encodeURIComponent(journeyId)}`;

  const source = new EventSource(`${API}/api/capture/events?${params}`);

  source.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    const pct = Math.round((data.step / data.total) * 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `Capturing ${data.step} of ${data.total}: ${data.filename}`;
  });

  source.addEventListener('complete', (e) => {
    const data = JSON.parse(e.data);
    progressFill.style.width = '100%';
    progressText.textContent = `Done! ${data.totalCaptured} screenshot(s) captured.`;
    captureBtn.disabled = false;
    source.close();
    // Refresh screenshots
    const roundInput = document.getElementById('roundSelect');
    if (roundInput) renderScreenshots(roundInput.value);
  });

  source.addEventListener('error', (e) => {
    if (e.data) {
      const data = JSON.parse(e.data);
      progressText.textContent = `Error: ${data.message}`;
    } else {
      progressText.textContent = 'Capture connection lost.';
    }
    captureBtn.disabled = false;
    source.close();
  });
}

// --- Deploy ---

async function runDeploy(round) {
  const deployBtn = document.getElementById('deployBtn');
  deployBtn.disabled = true;
  try {
    const res = await api('/api/deploy', {
      method: 'POST',
      body: { project: currentProject.slug, round }
    });
    if (res.error) {
      alert(res.error);
    } else {
      alert('Deploy complete.');
    }
  } catch (err) {
    alert(`Deploy failed: ${err.message}`);
  }
  deployBtn.disabled = false;
}

// --- Lightbox ---

function openLightbox(src, caption) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxCaption').textContent = caption;
  lb.style.display = 'flex';
}

document.getElementById('lightbox').addEventListener('click', (e) => {
  if (e.target.closest('.lightbox-img')) return;
  document.getElementById('lightbox').style.display = 'none';
});

document.getElementById('lightboxClose').addEventListener('click', () => {
  document.getElementById('lightbox').style.display = 'none';
});

// --- Add project form ---

document.getElementById('addProjectBtn').addEventListener('click', () => {
  document.getElementById('addProjectForm').style.display = 'block';
  document.getElementById('newName').focus();
});

document.getElementById('cancelProjectBtn').addEventListener('click', () => {
  document.getElementById('addProjectForm').style.display = 'none';
});

document.getElementById('saveProjectBtn').addEventListener('click', async () => {
  const name = document.getElementById('newName').value.trim();
  const baseUrl = document.getElementById('newBaseUrl').value.trim();
  if (!name) return;

  await addProject({ name, baseUrl });
  document.getElementById('addProjectForm').style.display = 'none';
  document.getElementById('newName').value = '';
  document.getElementById('newBaseUrl').value = 'http://localhost:3000';
  await renderProjectList();
});

// --- Utils ---

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// --- Init ---

renderProjectList();
