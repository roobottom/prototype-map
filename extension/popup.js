const nameInput = document.getElementById('name');
const descriptionInput = document.getElementById('description');
const portInput = document.getElementById('port');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const errorEl = document.getElementById('error');
const tabInfoEl = document.getElementById('tabInfo');

let currentTabId = null;

async function init() {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    tabInfoEl.textContent = tab.url || 'No URL';
  }

  // Load saved state
  const stored = await chrome.storage.local.get('prototypeMapState');
  const state = stored.prototypeMapState || {};
  if (state.port) portInput.value = state.port;
  if (state.name) nameInput.value = state.name;
  if (state.description) descriptionInput.value = state.description;

  // Check recording status
  await refreshStatus();
}

async function refreshStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'recording/status' });

    if (response.isRecording) {
      statusEl.className = 'status recording';
      statusEl.textContent = `Recording \u2022 ${response.pages || 0} page(s) \u2022 ${response.edges || 0} edge(s)`;
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      portInput.disabled = true;
      nameInput.disabled = true;
      descriptionInput.disabled = true;
    } else {
      statusEl.className = 'status idle';
      statusEl.textContent = 'Idle';
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      portInput.disabled = false;
      nameInput.disabled = false;
      descriptionInput.disabled = false;
    }
  } catch {
    statusEl.className = 'status idle';
    statusEl.textContent = 'Idle';
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  errorEl.classList.remove('visible');
  resultEl.classList.remove('visible');

  const port = parseInt(portInput.value, 10) || 4444;
  const name = nameInput.value.trim();
  const description = descriptionInput.value.trim();

  // Save state
  await chrome.storage.local.set({
    prototypeMapState: { port, name, description, isRecording: false, tabId: null }
  });

  const response = await chrome.runtime.sendMessage({
    type: 'recording/start',
    payload: { port, tabId: currentTabId, name, description }
  });

  if (response.ok) {
    await refreshStatus();
  } else {
    errorEl.textContent = response.error || 'Failed to start recording';
    errorEl.classList.add('visible');
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;

  const response = await chrome.runtime.sendMessage({ type: 'recording/stop' });

  if (response.ok) {
    resultEl.textContent = `Done! ${response.pages || 0} page(s) and ${response.edges || 0} edge(s) saved to config.`;
    resultEl.classList.add('visible');
  } else {
    errorEl.textContent = response.error || 'Failed to stop recording';
    errorEl.classList.add('visible');
  }

  stopBtn.disabled = false;
  await refreshStatus();
});

init();
