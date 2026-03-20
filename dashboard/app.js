const API = window.location.origin;
let currentProject = null;   // { slug, name, journeys }
let currentJourney = null;   // { slug, name, baseUrl }

// --- API helpers ---

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 120) };
    }
  }
  if (!res.ok) {
    return { error: data.error || `Request failed (${res.status})` };
  }
  return data;
}

async function getProjects() {
  return api('/api/projects');
}

async function addProject(name) {
  return api('/api/projects', { method: 'POST', body: { name } });
}

async function deleteJourney(projectSlug, journeySlug) {
  return api(`/api/journeys/${encodeURIComponent(projectSlug)}/${encodeURIComponent(journeySlug)}`, {
    method: 'DELETE'
  });
}

async function getConfig(projectSlug, journeySlug) {
  return api(`/api/config?project=${encodeURIComponent(projectSlug)}&journey=${encodeURIComponent(journeySlug)}`);
}

async function getManifest(projectSlug, journeySlug) {
  return api(`/api/screenshots?project=${encodeURIComponent(projectSlug)}&journey=${encodeURIComponent(journeySlug)}`);
}

async function getMapStatus(projectSlug, journeySlug) {
  return api(`/api/map?project=${encodeURIComponent(projectSlug)}&journey=${encodeURIComponent(journeySlug)}`);
}

async function generateMap(projectSlug, journeySlug) {
  return api('/api/map', {
    method: 'POST',
    body: { project: projectSlug, journey: journeySlug, format: 'html', embedScreenshots: true }
  });
}

function mapUrl(projectSlug, journeySlug, file = 'journey-map.html') {
  return `${API}/api/maps/${encodeURIComponent(projectSlug)}/${encodeURIComponent(journeySlug)}/${encodeURIComponent(file)}`;
}

// --- Render functions ---

async function renderSidebar() {
  const container = document.getElementById('projectList');
  const projects = await getProjects();

  if (!currentProject && projects.length > 0) {
    currentProject = projects[0];
  }

  container.innerHTML = '';
  for (const project of projects) {
    const group = document.createElement('div');
    group.className = 'project-group';

    const isActiveProject = currentProject?.slug === project.slug;

    // Project header (expandable)
    const header = document.createElement('div');
    header.className = `project-group-header${isActiveProject ? ' active expanded' : ''}`;
    header.innerHTML = `<span class="chevron">&#9654;</span> ${esc(project.name)}`;
    header.addEventListener('click', () => {
      // Toggle expand/collapse
      const wasExpanded = header.classList.contains('expanded');
      header.classList.toggle('expanded');
      journeyList.classList.toggle('expanded');

      // If expanding and no current project, select this one
      if (!wasExpanded) {
        selectProject(project);
      }
    });

    // Journey sub-items
    const journeyList = document.createElement('ul');
    journeyList.className = `journey-items${isActiveProject ? ' expanded' : ''}`;

    if (project.journeys.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No journeys yet';
      li.style.fontStyle = 'italic';
      li.style.color = 'var(--text-tertiary)';
      li.style.cursor = 'default';
      journeyList.appendChild(li);
    } else {
      for (const journey of project.journeys) {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="journey-item-label">${esc(journey.name)}</span>
          <button class="journey-item-delete" type="button" aria-label="Delete ${esc(journey.name)}">Delete</button>
        `;
        if (currentJourney?.slug === journey.slug && isActiveProject) {
          li.classList.add('active');
        }
        li.addEventListener('click', (e) => {
          if (e.target.closest('.journey-item-delete')) return;
          e.stopPropagation();
          currentProject = project;
          selectJourney(journey);
        });
        li.querySelector('.journey-item-delete').addEventListener('click', async (e) => {
          e.stopPropagation();
          currentProject = project;
          await confirmDeleteJourney(journey);
        });
        journeyList.appendChild(li);
      }
    }

    group.appendChild(header);
    group.appendChild(journeyList);
    container.appendChild(group);
  }
}

function selectProject(project) {
  currentProject = project;
  currentJourney = null;
  renderSidebar();
  renderProjectView();
}

function selectJourney(journey) {
  currentJourney = journey;
  renderSidebar();
  renderJourneyDetail();
}

function renderProjectView() {
  const main = document.getElementById('main');
  const tpl = document.getElementById('journeyListTpl');
  const clone = tpl.content.cloneNode(true);

  main.innerHTML = '';
  main.appendChild(clone);

  main.querySelector('.project-name').textContent = currentProject.name;
  main.querySelector('.project-meta').textContent = `${currentProject.journeys.length} journey(s)`;

  const journeyList = main.querySelector('#journeyList');
  if (currentProject.journeys.length > 0) {
    journeyList.innerHTML = '';
    for (const j of currentProject.journeys) {
      const card = document.createElement('div');
      card.className = 'journey-card';
      card.innerHTML = `
        <div class="journey-card-info">
          <span class="journey-card-label">${esc(j.name)}</span>
          <span class="journey-card-meta">${esc(j.baseUrl)}</span>
        </div>
        <div class="journey-card-actions">
          <button class="btn btn-small" data-action="view">View</button>
          <button class="btn btn-small btn-danger" data-action="delete">Delete</button>
        </div>
      `;
      card.querySelector('[data-action="view"]').addEventListener('click', (e) => {
        e.stopPropagation();
        selectJourney(j);
      });
      card.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        await confirmDeleteJourney(j);
      });
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => selectJourney(j));
      journeyList.appendChild(card);
    }
  }
}

async function renderJourneyDetail() {
  const main = document.getElementById('main');
  const tpl = document.getElementById('journeyDetailTpl');
  const clone = tpl.content.cloneNode(true);

  main.innerHTML = '';
  main.appendChild(clone);

  // Breadcrumb
  const breadcrumb = main.querySelector('#breadcrumb');
  const backLink = document.createElement('a');
  backLink.textContent = currentProject.name;
  backLink.addEventListener('click', () => selectProject(currentProject));
  breadcrumb.appendChild(backLink);
  breadcrumb.appendChild(document.createTextNode(' / '));

  main.querySelector('.project-name').textContent = currentJourney.name;
  main.querySelector('.project-meta').textContent = `${currentJourney.baseUrl} \u2022 projects/${currentProject.slug}/${currentJourney.slug}/`;

  await renderMapPanel();

  main.querySelector('#makeMapBtn').addEventListener('click', () => {
    runCapture();
  });

  // Wire up deploy button
  main.querySelector('#deployBtn').addEventListener('click', () => {
    runDeploy();
  });

  main.querySelector('#deleteJourneyBtn').addEventListener('click', async () => {
    await confirmDeleteJourney(currentJourney);
  });
}

async function renderMapPanel() {
  const panel = document.getElementById('mapPanel');
  const openMapBtn = document.getElementById('openMapBtn');
  if (!panel || !openMapBtn) return;

  openMapBtn.style.display = 'none';
  openMapBtn.href = '#';

  try {
    const status = await getMapStatus(currentProject.slug, currentJourney.slug);
    if (status.error || !status.exists) {
      panel.innerHTML = '<p class="muted">No map yet. Capture screenshots and generate the map.</p>';
      return;
    }

    const src = status.url.startsWith('http') ? status.url : `${API}${status.url}`;
    openMapBtn.style.display = 'inline-flex';
    openMapBtn.href = src;
    panel.innerHTML = `<iframe class="map-frame" src="${src}" title="Journey map for ${esc(currentJourney.name)}"></iframe>`;
  } catch {
    panel.innerHTML = '<p class="muted">Unable to load the map preview.</p>';
  }
}

// --- Capture via SSE ---

function runCapture() {
  const progress = document.getElementById('captureProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const makeMapBtn = document.getElementById('makeMapBtn');

  progress.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = 'Capturing screenshots...';
  makeMapBtn.disabled = true;

  const params = `project=${encodeURIComponent(currentProject.slug)}&journey=${encodeURIComponent(currentJourney.slug)}`;
  const source = new EventSource(`${API}/api/capture/events?${params}`);

  source.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    const pct = Math.round((data.step / data.total) * 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `Capturing ${data.step} of ${data.total}: ${data.filename}`;
  });

  source.addEventListener('complete', async () => {
    progressFill.style.width = '100%';
    progressText.textContent = 'Generating map...';
    await runMap({ silent: true });
    progressText.textContent = 'Map ready.';
    makeMapBtn.disabled = false;
    source.close();
  });

  source.addEventListener('error', (e) => {
    if (e.data) {
      const data = JSON.parse(e.data);
      progressText.textContent = `Error: ${data.message}`;
    } else {
      progressText.textContent = 'Capture connection lost.';
    }
    makeMapBtn.disabled = false;
    source.close();
  });
}

async function runMap(opts = {}) {
  const panel = document.getElementById('mapPanel');
  const makeMapBtn = document.getElementById('makeMapBtn');
  if (!panel || !makeMapBtn) return;

  makeMapBtn.disabled = true;
  if (!opts.silent) {
    panel.innerHTML = '<p class="muted">Generating map...</p>';
  }

  try {
    const res = await generateMap(currentProject.slug, currentJourney.slug);
    if (res.error) {
      if (!opts.silent) {
        panel.innerHTML = `<p class="muted">${esc(res.error)}</p>`;
      }
      return;
    }
    await renderMapPanel();
  } catch (err) {
    if (!opts.silent) {
      panel.innerHTML = `<p class="muted">Map generation failed: ${esc(err.message)}</p>`;
    }
  } finally {
    makeMapBtn.disabled = false;
  }
}

// --- Deploy ---

async function runDeploy() {
  const deployBtn = document.getElementById('deployBtn');
  deployBtn.disabled = true;
  try {
    const res = await api('/api/deploy', {
      method: 'POST',
      body: { project: currentProject.slug, journey: currentJourney.slug }
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

async function confirmDeleteJourney(journey) {
  if (!currentProject || !journey) return;

  const confirmed = window.confirm(
    `Delete journey "${journey.name}"?\n\nThis will remove its config, screenshots, and maps.`
  );
  if (!confirmed) return;

  try {
    const res = await deleteJourney(currentProject.slug, journey.slug);
    if (res.error) {
      alert(res.error);
      return;
    }

    const deletedSelectedJourney = currentJourney?.slug === journey.slug;
    const projects = await getProjects();
    const updatedProject = projects.find((p) => p.slug === currentProject.slug) || null;

    currentProject = updatedProject;
    currentJourney = deletedSelectedJourney ? null : updatedProject?.journeys.find((j) => j.slug === currentJourney?.slug) || null;

    await renderSidebar();

    if (!currentProject) {
      document.getElementById('main').innerHTML = `
        <div class="empty-state" id="emptyState">
          <div class="empty-state-icon">&#9878;</div>
          <h2>Select a project</h2>
          <p>Choose a project from the sidebar, or add a new one.</p>
        </div>
      `;
      return;
    }

    if (currentJourney) {
      await renderJourneyDetail();
    } else {
      renderProjectView();
    }
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
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
  if (!name) return;

  await addProject(name);
  document.getElementById('addProjectForm').style.display = 'none';
  document.getElementById('newName').value = '';
  await renderSidebar();
});

// --- Utils ---

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// --- Init ---

renderSidebar().then(() => {
  if (currentProject) {
    renderProjectView();
  }
});
