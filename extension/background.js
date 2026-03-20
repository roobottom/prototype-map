const STORAGE_KEY = 'prototypeMapState';
const ICON_SIZES = [16, 48, 128];
const DEFAULT_ICONS = Object.fromEntries(ICON_SIZES.map((size) => [size, `icon-${size}.png`]));
const ICON_REFRESH_ALARM = 'prototype-map-refresh-icon';
let redIconsPromise = null;
let greyIconsPromise = null;

// Default state
const defaultState = {
  isRecording: false,
  port: 4444,
  tabId: null,
  pendingClickText: null,
};

async function getState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { ...defaultState };
}

async function setState(updates) {
  const current = await getState();
  const next = { ...current, ...updates };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

function endpoint(port) {
  return `http://localhost:${port}`;
}

async function loadImageData(path, size) {
  const response = await fetch(chrome.runtime.getURL(path));
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

async function buildTintedIcons([rBase, gBase, bBase]) {
  const entries = await Promise.all(ICON_SIZES.map(async (size) => {
    const imageData = await loadImageData(`icon-${size}.png`, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;
      const intensity = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
      data[i] = Math.round(rBase * intensity);
      data[i + 1] = Math.round(gBase * intensity);
      data[i + 2] = Math.round(bBase * intensity);
    }
    return [size, imageData];
  }));
  return Object.fromEntries(entries);
}

async function isServerAvailable(port) {
  try {
    const response = await fetch(`${endpoint(port)}/api/recording`);
    return response.ok;
  } catch {
    return false;
  }
}

async function setIconState(mode) {
  if (mode === 'default') {
    await chrome.action.setIcon({ path: DEFAULT_ICONS });
    return;
  }

  if (mode === 'recording') {
    redIconsPromise ||= buildTintedIcons([215, 35, 35]);
    const imageData = await redIconsPromise;
    await chrome.action.setIcon({ imageData });
    return;
  }

  greyIconsPromise ||= buildTintedIcons([140, 140, 140]);
  const imageData = await greyIconsPromise;
  await chrome.action.setIcon({ imageData });
}

async function refreshIconForState() {
  const state = await getState();
  if (state.isRecording) {
    await setIconState('recording');
    return;
  }

  const serverAvailable = await isServerAvailable(state.port || defaultState.port);
  await setIconState(serverAvailable ? 'default' : 'offline');
}

async function getPageHeading(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'page/heading' });
    return response?.heading || '';
  } catch {
    return '';
  }
}

// Listen for navigation events on the recorded tab
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only main frame
  if (details.frameId !== 0) return;

  const state = await getState();
  if (!state.isRecording || details.tabId !== state.tabId) return;

  // Get the page title
  let title = '';
  try {
    const tab = await chrome.tabs.get(details.tabId);
    title = tab.title || '';
  } catch {
    // tab may have closed
  }

  const heading = await getPageHeading(details.tabId);

  // Send navigation event to server
  try {
    const clickText = state.pendingClickText || null;
    await fetch(`${endpoint(state.port)}/api/recording/navigation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: details.url,
        title: title || heading,
        clickText,
        timestamp: new Date().toISOString()
      })
    });
    if (clickText) {
      await setState({ pendingClickText: null });
    }
  } catch (err) {
    console.error('Failed to send navigation:', err);
  }
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  const state = await getState();

  switch (message.type) {
    case 'recording/start': {
      const { port, tabId, name, projectSlug } = message.payload;

      // Tell the server to start
      try {
        const tab = await chrome.tabs.get(tabId);
        const heading = await getPageHeading(tabId);
        await fetch(`${endpoint(port)}/api/recording/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: new URL(tab.url).origin,
            name: name || '',
            projectSlug: projectSlug || ''
          })
        });

        // Send initial navigation
        await fetch(`${endpoint(port)}/api/recording/navigation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: tab.url,
            title: tab.title || heading || '',
            timestamp: new Date().toISOString()
          })
        });
      } catch (err) {
        return { ok: false, error: `Cannot connect to server on port ${port}` };
      }

      await setState({ isRecording: true, port, tabId, pendingClickText: null });
      await setIconState('recording');
      return { ok: true };
    }

    case 'recording/stop': {
      // Tell the server to stop and write config
      try {
        const result = await fetch(`${endpoint(state.port)}/api/recording/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await result.json();
        await setState({ isRecording: false, tabId: null, pendingClickText: null });
        await refreshIconForState();
        return { ok: true, ...data };
      } catch (err) {
        await setState({ isRecording: false, tabId: null, pendingClickText: null });
        await refreshIconForState();
        return { ok: false, error: 'Failed to stop recording' };
      }
    }

    case 'recording/status': {
      // Get server status too
      let serverStatus = { pages: 0, edges: 0 };
      if (state.isRecording) {
        try {
          const result = await fetch(`${endpoint(state.port)}/api/recording`);
          serverStatus = await result.json();
        } catch {
          // server might be down
        }
      }
      return { ...state, ...serverStatus };
    }

    case 'form/submit': {
      // Forward form data from content script to server
      if (!state.isRecording) return { ok: false };
      try {
        await fetch(`${endpoint(state.port)}/api/recording/form`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message.payload)
        });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }

    case 'click/text': {
      // Store click text so it can label the next real navigation.
      if (!state.isRecording) return { ok: false };
      await setState({ pendingClickText: message.payload.clickText || null });
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ICON_REFRESH_ALARM, { periodInMinutes: 0.5 });
  await refreshIconForState();
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ICON_REFRESH_ALARM, { periodInMinutes: 0.5 });
  await refreshIconForState();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ICON_REFRESH_ALARM) return;
  await refreshIconForState();
});
