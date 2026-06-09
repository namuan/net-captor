const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const serverUrlInput = document.getElementById("serverUrl");
const saveBtn = document.getElementById("saveBtn");

console.log("[NetCaptor Popup] Loaded");

function updateStatus(connected) {
  dot.className = "dot " + (connected ? "on" : "off");
  statusText.textContent = connected ? "Connected" : "Disconnected";
}

chrome.storage.local.get(["serverUrl"], (result) => {
  if (result.serverUrl) {
    serverUrlInput.value = result.serverUrl;
  }
});

chrome.runtime.sendMessage({ type: "get-status" }, (response) => {
  console.log("[NetCaptor Popup] Status:", response);
  if (response) {
    updateStatus(response.connected);
    if (response.serverUrl) {
      serverUrlInput.value = response.serverUrl;
    }
  } else {
    console.warn("[NetCaptor Popup] No response from background");
  }
});

saveBtn.addEventListener("click", () => {
  const url = serverUrlInput.value.trim();
  if (!url) return;
  console.log(`[NetCaptor Popup] Setting server: ${url}`);
  chrome.runtime.sendMessage({ type: "set-server", serverUrl: url }, (response) => {
    console.log("[NetCaptor Popup] Server set:", response);
    updateStatus(true);
  });
});
