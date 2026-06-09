const DEFAULT_SERVER = "ws://localhost:3000";
const API_KEY = "local-monitor-secret";

let ws = null;
let serverUrl = DEFAULT_SERVER;
let reconnectTimer = null;
let pendingMessages = [];
let lastSessionId = null;

function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["serverUrl"], (result) => {
      resolve(result.serverUrl || DEFAULT_SERVER);
    });
  });
}

async function connect() {
  serverUrl = await getServerUrl();
  console.log(`[NetCaptor] Connecting to ${serverUrl}...`);

  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("[NetCaptor] Already connected, skipping");
    return;
  }

  try {
    ws = new WebSocket(serverUrl);

    ws.onopen = () => {
      console.log("[NetCaptor] ✓ Connected to server");
      console.log(`[NetCaptor] Flushing ${pendingMessages.length} pending messages`);
      while (pendingMessages.length > 0) {
        const msg = pendingMessages.shift();
        ws.send(JSON.stringify(msg));
        console.log(`[NetCaptor] → ws: ${msg.eventType}`);
      }
    };

    ws.onclose = (event) => {
      console.log(`[NetCaptor] ✗ Disconnected (code=${event.code} reason=${event.reason || "none"})`);
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error("[NetCaptor] ✗ WebSocket error:", err.message || err);
    };

    ws.onmessage = (event) => {
      console.log("[NetCaptor] ← ws:", event.data);
    };
  } catch (e) {
    console.error("[NetCaptor] ✗ Connection failed:", e.message || e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  console.log("[NetCaptor] Reconnecting in 3s...");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function sendEvent(eventType, payload) {
  const msg = {
    type: "event",
    sessionId: payload?.tabId ? `tab-${payload.tabId}` : lastSessionId || "default",
    eventType,
    payload,
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log(`[NetCaptor] → ws: ${eventType}`);
    ws.send(JSON.stringify(msg));
  } else {
    console.log(`[NetCaptor] ⏳ Queueing: ${eventType} (ws state=${ws?.readyState ?? "null"})`);
    pendingMessages.push(msg);
  }
}

// Inject network interceptors into the page's MAIN world
function injectIntoTab(tabId) {
  chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: "MAIN",
    files: ["inject.js"],
  }).catch((e) => {
    console.log(`[NetCaptor] inject failed tab=${tabId}: ${e.message}`);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`[NetCaptor] ← content: ${message.eventType} from tab=${sender.tab?.id}`);

  if (message.type === "event") {
    const tabId = sender.tab?.id;
    const sessionId = tabId ? `tab-${tabId}` : "unknown";
    lastSessionId = sessionId;
    const enriched = {
      ...message,
      sessionId,
    };
    console.log(`[NetCaptor] Forwarding: ${enriched.eventType} session=${enriched.sessionId}`);
    sendEvent(enriched.eventType, enriched.payload);
    sendResponse({ ok: true });
  }

  if (message.type === "get-status") {
    const status = {
      connected: ws?.readyState === WebSocket.OPEN,
      serverUrl,
    };
    console.log("[NetCaptor] Status requested:", status);
    sendResponse(status);
    return true;
  }

  if (message.type === "set-server") {
    console.log(`[NetCaptor] Setting server: ${message.serverUrl}`);
    chrome.storage.local.set({ serverUrl: message.serverUrl }, () => {
      if (ws) ws.close();
      connect();
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log(`[NetCaptor] Tab ${tabId} updated: status=${changeInfo.status} url=${tab.url}`);
  if (changeInfo.status === "loading") {
    sendEvent("navigation", {
      tabId,
      url: tab.url,
      title: tab.title,
      changeInfo,
    });
    // Inject network interceptors when page starts loading
    injectIntoTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log(`[NetCaptor] Tab ${tabId} removed`);
  sendEvent("tab-closed", { tabId });
});

console.log("[NetCaptor] Background script loaded");
connect();
