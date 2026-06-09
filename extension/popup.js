const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const serverUrlInput = document.getElementById("serverUrl");
const apiTokenInput = document.getElementById("apiToken");
const saveBtn = document.getElementById("saveBtn");

console.log("[NetCaptor Popup] Loaded");

function updateStatus(connected) {
  dot.className = "dot " + (connected ? "on" : "off");
  statusText.textContent = connected ? "Connected" : "Disconnected";
}

chrome.storage.local.get(["serverUrl", "apiToken"], (result) => {
  if (result.serverUrl) serverUrlInput.value = result.serverUrl;
  if (result.apiToken) apiTokenInput.value = result.apiToken;
});

chrome.runtime.sendMessage({ type: "get-status" }, (response) => {
  console.log("[NetCaptor Popup] Status:", response);
  if (response) {
    updateStatus(response.connected);
    if (response.serverUrl) serverUrlInput.value = response.serverUrl;
  } else {
    console.warn("[NetCaptor Popup] No response from background");
  }
});

saveBtn.addEventListener("click", () => {
  const serverUrl = serverUrlInput.value.trim();
  const apiToken = apiTokenInput.value.trim();
  if (!serverUrl) return;

  console.log(`[NetCaptor Popup] Saving config`);
  chrome.runtime.sendMessage({
    type: "set-config",
    serverUrl: serverUrl || undefined,
    apiToken: apiToken || undefined,
  }, (response) => {
    console.log("[NetCaptor Popup] Config saved:", response);
    updateStatus(true);
  });
});
