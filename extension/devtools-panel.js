(() => {
  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);

  _log("[NetCaptor Panel] Loaded");

  const eventsEl = document.getElementById("events");
  const statusDot = document.getElementById("statusDot");
  const serverUrlInput = document.getElementById("serverUrl");
  const connectBtn = document.getElementById("connectBtn");
  const clearBtn = document.getElementById("clearBtn");
  const eventCountEl = document.getElementById("eventCount");
  const filtersEl = document.getElementById("filters");

  const tabId = chrome.devtools.inspectedWindow.tabId;
  const sessionId = "tab-" + tabId;

  let ws = null;
  let allEvents = [];
  let activeFilters = new Set();

  const EVENT_TYPES = [
    "network", "page-info", "navigation",
    "console", "js-error", "promise-rejection", "performance",
    "click", "form-submit", "visibility-change"
  ];

  function initFilters() {
    EVENT_TYPES.forEach(function (type) {
      var btn = document.createElement("button");
      btn.className = "filter-btn active";
      btn.textContent = type;
      btn.dataset.type = type;
      btn.addEventListener("click", function () {
        if (activeFilters.has(type)) {
          activeFilters.delete(type);
          btn.classList.remove("active");
        } else {
          activeFilters.add(type);
          btn.classList.add("active");
        }
        renderEvents();
      });
      filtersEl.appendChild(btn);
      activeFilters.add(type);
    });
  }

  function formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false });
  }

  function escapeHtml(str) {
    if (str == null) return "";
    var div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function truncate(s, n) {
    return s && s.length > n ? s.substring(0, n) + "..." : s;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function renderEvent(ev) {
    var el = document.createElement("div");
    el.className = "event";
    var detail = formatDetail(ev.payload || {});
    el.innerHTML =
      '<span class="time">' + formatTime(ev.timestamp) + "</span>" +
      '<span class="type ' + ev.eventType + '">' + ev.eventType + "</span>" +
      '<span class="detail">' + detail + "</span>";
    return el;
  }

  function formatDetail(p) {
    var parts = [];
    if (p.method && p.url) {
      parts.push('<span class="key">' + escapeHtml(p.method) + "</span> " + escapeHtml(truncate(p.url, 120)));
    }
    if (p.status) parts.push('<span class="key">' + p.status + "</span>");
    if (p.duration) parts.push('<span class="key">' + Math.round(p.duration) + "ms</span>");
    if (p.size) parts.push('<span class="key">' + formatSize(p.size) + "</span>");
    if (p.from && p.to) parts.push(escapeHtml(p.from) + " &rarr; " + escapeHtml(p.to));
    if (p.message) parts.push('<span class="key">msg:</span> ' + escapeHtml(p.message));
    if (p.level) parts.push('<span class="key">' + escapeHtml(p.level) + "</span>");
    if (p.element) parts.push("&lt;" + escapeHtml(p.element) + "&gt;");
    if (p.error) parts.push('<span class="key">error:</span> ' + escapeHtml(p.error));
    if (p.args && Array.isArray(p.args)) parts.push(escapeHtml(p.args.join(" ")));
    if (p.url && !p.method) parts.push('<span class="key">url:</span> ' + escapeHtml(truncate(p.url, 120)));
    if (parts.length === 0) parts.push(escapeHtml(JSON.stringify(p).substring(0, 200)));
    return parts.join(" ");
  }

  function renderEvents() {
    eventsEl.innerHTML = "";
    var filtered = activeFilters.size === EVENT_TYPES.length
      ? allEvents
      : allEvents.filter(function (e) { return activeFilters.has(e.eventType); });
    filtered.forEach(function (ev) { eventsEl.appendChild(renderEvent(ev)); });
    eventCountEl.textContent = filtered.length + " events";
    eventsEl.scrollTop = eventsEl.scrollHeight;
  }

  function setStatus(connected) {
    statusDot.className = "status " + (connected ? "connected" : "disconnected");
  }

  function sendToServer(eventType, payload) {
    var event = {
      sessionId: sessionId,
      timestamp: new Date().toISOString(),
      eventType: eventType,
      payload: payload,
    };
    allEvents.push(event);
    if (activeFilters.has(eventType)) {
      eventsEl.appendChild(renderEvent(event));
      eventCountEl.textContent = allEvents.length + " events";
      eventsEl.scrollTop = eventsEl.scrollHeight;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  // --- Network capture via DevTools API (supplements content script) ---
  function setupNetworkCapture() {
    try {
      chrome.devtools.network.onRequestFinished.addListener(function (entry) {
        try {
          var req = entry.request;
          var res = entry.response;
          sendToServer("network", {
            method: req.method,
            url: req.url,
            status: res.status,
            statusText: res.statusText,
            duration: entry.time || 0,
            size: res.content ? res.content.size || 0 : 0,
            mimeType: res.content ? res.content.mimeType || "" : "",
            postData: req.postData || null,
          });
        } catch (e) {
          _warn("[NetCaptor Panel] onRequestFinished error:", e.message);
        }
      });
      _log("[NetCaptor Panel] Network capture active");
    } catch (e) {
      _warn("[NetCaptor Panel] devtools.network unavailable:", e.message);
    }

    try {
      chrome.devtools.network.onNavigated.addListener(function (url) {
        sendToServer("navigation", {
          to: url,
          method: "devtools-navigate",
        });
      });
    } catch (e) {}
  }

  // --- Connect to server ---
  function connect() {
    var baseUrl = serverUrlInput.value || "ws://localhost:3000";
    chrome.storage.local.get(["apiToken"], function (result) {
      var token = result.apiToken || "";
      var url = baseUrl;
      if (token) {
        url += (baseUrl.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
      }
      _log("[NetCaptor Panel] Connecting to " + baseUrl + "...");
      doConnect(url);
    });
  }

  function doConnect(url) {
    if (ws) ws.close();

    try {
      ws = new WebSocket(url);

      ws.onopen = function () {
        _log("[NetCaptor Panel] Connected");
        setStatus(true);
        connectBtn.textContent = "Disconnect";
        setupNetworkCapture();
      };

      ws.onclose = function (event) {
        _log("[NetCaptor Panel] Disconnected (code=" + event.code + ")");
        setStatus(false);
        connectBtn.textContent = "Connect";
      };

      ws.onerror = function (err) {
        _warn("[NetCaptor Panel] WS error:", err.message || err);
        setStatus(false);
      };
    } catch (e) {
      _warn("[NetCaptor Panel] Connect failed:", e.message || e);
      setStatus(false);
    }
  }

  connectBtn.addEventListener("click", function () {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    } else {
      connect();
    }
  });

  clearBtn.addEventListener("click", function () {
    allEvents = [];
    renderEvents();
  });

  // --- Init ---
  chrome.storage.local.get(["serverUrl"], function (result) {
    _log("[NetCaptor Panel] Server URL:", result.serverUrl || "ws://localhost:3000");
    if (result.serverUrl) {
      serverUrlInput.value = result.serverUrl;
    }
    initFilters();
    connect();
  });
})();
