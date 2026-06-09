// Injected into page's MAIN world by background.js
// Communicates back to content script via CustomEvent
(() => {
  if (window.__netCaptorNetworkInjected) return;
  window.__netCaptorNetworkInjected = true;

  function notify(payload) {
    window.dispatchEvent(new CustomEvent("__netCaptorNetwork", { detail: payload }));
  }

  // --- Fetch ---
  const _fetch = window.fetch;
  window.fetch = function () {
    const startTime = performance.now();
    let url = "";
    let method = "GET";
    try {
      const first = arguments[0];
      url = typeof first === "string" ? first : (first && first.url) || String(first);
      method = (arguments[1] && arguments[1].method) || "GET";
    } catch (e) {}

    return _fetch.apply(this, arguments).then(
      function (response) {
        const duration = performance.now() - startTime;
        const clone = response.clone();
        clone.text().then(function (body) {
          notify({
            type: "network",
            method: method,
            url: url,
            status: response.status,
            statusText: response.statusText,
            duration: Math.round(duration),
            size: body.length,
          });
        }).catch(function () {});
        return response;
      },
      function (err) {
        const duration = performance.now() - startTime;
        notify({
          type: "network",
          method: method,
          url: url,
          status: 0,
          statusText: "Error",
          duration: Math.round(duration),
          error: err.message,
        });
        throw err;
      }
    );
  };

  // --- XHR ---
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._ncMethod = method;
    this._ncUrl = url;
    this._ncStart = performance.now();
    return _xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const self = this;
    this.addEventListener("load", function () {
      notify({
        type: "network",
        method: self._ncMethod,
        url: self._ncUrl,
        status: self.status,
        statusText: self.statusText,
        duration: Math.round(performance.now() - self._ncStart),
        size: (self.responseText || "").length,
      });
    });
    this.addEventListener("error", function () {
      notify({
        type: "network",
        method: self._ncMethod,
        url: self._ncUrl,
        status: 0,
        statusText: "Error",
        duration: Math.round(performance.now() - self._ncStart),
        error: "Network error",
      });
    });
    return _xhrSend.apply(this, arguments);
  };
})();
