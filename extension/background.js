const STORAGE_KEY = 'prototypeMapState';

// Default state
const defaultState = {
  isRecording: false,
  port: 4444,
  tabId: null,
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

  // Send navigation event to server
  try {
    await fetch(`${endpoint(state.port)}/api/recording/navigation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: details.url,
        title,
        timestamp: new Date().toISOString()
      })
    });
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
      const { port, tabId, name, round } = message.payload;

      // Tell the server to start
      try {
        const tab = await chrome.tabs.get(tabId);
        await fetch(`${endpoint(port)}/api/recording/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: new URL(tab.url).origin,
            name: name || '',
            round: round || 1
          })
        });

        // Send initial navigation
        await fetch(`${endpoint(port)}/api/recording/navigation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: tab.url,
            title: tab.title || '',
            timestamp: new Date().toISOString()
          })
        });
      } catch (err) {
        return { ok: false, error: `Cannot connect to server on port ${port}` };
      }

      await setState({ isRecording: true, port, tabId });
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
        await setState({ isRecording: false, tabId: null });
        return { ok: true, ...data };
      } catch (err) {
        await setState({ isRecording: false, tabId: null });
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
      // Forward click text from content script to be used in next navigation
      if (!state.isRecording) return { ok: false };
      // We'll send this as part of the next navigation event
      // Store it temporarily - the content script sends it right before navigation
      try {
        await fetch(`${endpoint(state.port)}/api/recording/navigation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: message.payload.url,
            title: message.payload.title,
            clickText: message.payload.clickText,
            timestamp: new Date().toISOString()
          })
        });
      } catch {
        // ignore
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}
