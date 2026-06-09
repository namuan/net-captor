(() => {
  if (window.__netCaptorLoaded) return;
  window.__netCaptorLoaded = true;

  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);

  _log("[NetCaptor] Content script loaded on", location.href);

  function sendToBackground(eventType, payload) {
    try {
      chrome.runtime.sendMessage({ type: "event", eventType, payload }, () => {
        if (chrome.runtime.lastError) {
          _warn("[NetCaptor] send failed:", chrome.runtime.lastError.message);
        }
      });
    } catch (e) {
      _warn("[NetCaptor] send exception:", e.message);
    }
  }

  function getSelector(el) {
    if (!el) return "";
    if (el.id) return "#" + el.id;
    const path = [];
    while (el && el.nodeType === 1) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        path.unshift("#" + el.id);
        break;
      }
      if (el.className && typeof el.className === "string") {
        selector += "." + el.className.trim().split(/\s+/).join(".");
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(" > ");
  }

  // --- Listen for network events from MAIN world injected script ---
  window.addEventListener("__netCaptorNetwork", (event) => {
    const data = event.detail;
    if (data && data.type === "network") {
      sendToBackground("network", {
        method: data.method,
        url: data.url,
        status: data.status,
        statusText: data.statusText,
        duration: data.duration,
        size: data.size,
        error: data.error,
      });
    }
  });

  // --- JS Error Capture ---
  window.addEventListener("error", (event) => {
    sendToBackground("js-error", {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
      url: location.href,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    sendToBackground("promise-rejection", {
      reason: event.reason?.message || String(event.reason),
      stack: event.reason?.stack,
      url: location.href,
    });
  });

  // --- Navigation Capture ---
  try {
    const _pushState = history.pushState;
    history.pushState = function (...args) {
      const from = location.pathname + location.hash;
      _pushState.apply(this, args);
      const to = location.pathname + location.hash;
      sendToBackground("navigation", { from, to, method: "pushState", url: location.href });
    };
  } catch (e) {
    _warn("[NetCaptor] pushState override failed:", e.message);
  }

  try {
    const _replaceState = history.replaceState;
    history.replaceState = function (...args) {
      const from = location.pathname + location.hash;
      _replaceState.apply(this, args);
      const to = location.pathname + location.hash;
      sendToBackground("navigation", { from, to, method: "replaceState", url: location.href });
    };
  } catch (e) {
    _warn("[NetCaptor] replaceState override failed:", e.message);
  }

  window.addEventListener("popstate", () => {
    sendToBackground("navigation", {
      from: "",
      to: location.pathname + location.hash,
      method: "popstate",
      url: location.href,
    });
  });

  window.addEventListener("hashchange", () => {
    sendToBackground("navigation", {
      from: "",
      to: location.hash,
      method: "hashchange",
      url: location.href,
    });
  });

  // --- Performance Metrics ---
  function capturePerformance() {
    try {
      var entries = performance.getEntriesByType("navigation");
      if (entries.length > 0) {
        var nav = entries[0];
        sendToBackground("performance", {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          loadTime: Math.round(nav.loadEventEnd - nav.startTime),
          ttfb: Math.round(nav.responseStart - nav.startTime),
          domInteractive: Math.round(nav.domInteractive - nav.startTime),
          url: location.href,
        });
      }
    } catch (e) {}
  }

  if (document.readyState === "complete") {
    capturePerformance();
  } else {
    window.addEventListener("load", capturePerformance);
  }

  // --- Page Info on Load ---
  function sendPageInfo() {
    sendToBackground("page-info", {
      url: location.href,
      title: document.title,
      domain: location.hostname,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sendPageInfo);
  } else {
    sendPageInfo();
  }

  // --- User Interaction Tracking ---
  document.addEventListener("click", (event) => {
    const target = event.target;
    sendToBackground("click", {
      element: target.tagName?.toLowerCase(),
      id: target.id || undefined,
      className: target.className || undefined,
      text: target.textContent?.substring(0, 100) || undefined,
      selector: getSelector(target),
      url: location.href,
    });
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target;
    const fields = [];
    const formData = new FormData(form);
    for (const [key] of formData) {
      fields.push(key);
    }
    sendToBackground("form-submit", {
      action: form.action,
      method: form.method,
      fields,
      selector: getSelector(form),
      url: location.href,
    });
  }, true);

  document.addEventListener("visibilitychange", () => {
    sendToBackground("visibility-change", {
      state: document.visibilityState,
      url: location.href,
    });
  });
})();
