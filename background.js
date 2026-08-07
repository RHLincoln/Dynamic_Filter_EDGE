// Broadcast a simple toggle message when the toolbar icon is clicked.
// We use chrome.runtime.sendMessage (no tabs permission).
chrome.action.onClicked.addListener(() => {
  chrome.runtime.sendMessage({ type: "TOGGLE_POPUP" });
});