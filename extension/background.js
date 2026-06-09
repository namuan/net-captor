const DEFAULT_SERVER = "ws://localhost:3000";
const DEFAULT_TOKEN = "";

let ws = null;
let serverUrl = DEFAULT_SERVER;
let apiToken = DEFAULT_TOKEN;
let reconnectTimer = null;
let pendingMessages = [];
let lastSessionId = null;

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["serverUrl", "apiToken"], (result) => {
      resolve({
        serverUrl: result.serverUrl || DEFAULT_SERVER,
        apiToken: result.apiToken || DEFAULT_TOKEN,
      });
    });
  });
}

function buildWsUrl(baseUrl, token) {
  if (!token) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return baseUrl + sep + "token=" + encodeURIComponent(token);
}

async function connect() {
  const config = await getConfig();
  serverUrl = config.serverUrl;
  apiToken = config.apiToken;

  const wsUrl = buildWsUrl(serverUrl, apiToken);
  console.log(`[NetCaptor] Connecting to ${serverUrl}...`);

  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("[NetCaptor] Already connected, skipping");
    return;
  }

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[NetCaptor] Connected to server");
      console.log(`[NetCaptor] Flushing ${pendingMessages.length} pending messages`);
      while (pendingMessages.length > 0) {
        const msg = pendingMessages.shift();
        ws.send(JSON.stringify(msg));
        console.log(`[NetCaptor] → ws: ${msg.eventType}`);
      }
    };

    ws.onclose = (event) => {
      console.log(`[NetCaptor] Disconnected (code=${event.code} reason=${event.reason || "none"})`);
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error("[NetCaptor] WebSocket error:", err.message || err);
    };

    ws.onmessage = (event) => {
      console.log("[NetCaptor] ← ws:", event.data);
    };
  } catch (e) {
    console.error("[NetCaptor] Connection failed:", e.message || e);
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
    console.log(`[NetCaptor] Queueing: ${eventType} (ws state=${ws?.readyState ?? "null"})`);
    pendingMessages.push(msg);
  }
}

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
    sendEvent(message.eventType, message.payload);
    sendResponse({ ok: true });
  }

  if (message.type === "get-status") {
    sendResponse({
      connected: ws?.readyState === WebSocket.OPEN,
      serverUrl,
    });
    return true;
  }

  if (message.type === "set-config") {
    console.log(`[NetCaptor] New config: ${message.serverUrl}`);
    chrome.storage.local.set({
      serverUrl: message.serverUrl || serverUrl,
      apiToken: message.apiToken || apiToken,
    }, () => {
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
    injectIntoTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log(`[NetCaptor] Tab ${tabId} removed`);
  sendEvent("tab-closed", { tabId });
});

console.log("[NetCaptor] Background script loaded");
connect();
