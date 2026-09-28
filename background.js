/**
 * background.js – DynamicSearchLiteSafe v2.0
 *
 * Acts as the single message broker between popup.js and content.js.
 * popup.js does NOT have "tabs" permission so it cannot call
 * chrome.tabs.sendMessage directly — everything is routed here.
 *
 * New message actions added in v2.0
 * ──────────────────────────────────
 *  getStatusFromTab   – popup asks for live stats from content script
 *  getLogFromTab      – popup asks for debug log from content script
 *  clearLogFromTab    – popup asks content script to clear its log
 *
 * All existing v1.x actions (getState, toggleFromPopup) are preserved.
 */

"use strict";

// ── Per-tab enabled state (in-memory, resets on SW restart — acceptable) ──────
const enabledTabs = new Set();

// ── Helper: forward a message to a content script tab ────────────────────────
// Returns the response or null on failure (tab closed, script not ready, etc.)
function relayToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      // Always consume lastError so Chrome doesn't log unchecked errors
      void chrome.runtime.lastError;
      resolve(resp ?? null);
    });
  });
}

// ── Helper: ensure content script is alive in a tab ──────────────────────────
async function ensureContentScript(tabId) {
  // Probe: does the content script flag exist?
  let probeResult = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        typeof window.__dynSearchReady !== "undefined"
          ? { pong: true }
          : { pong: false },
    });
    probeResult = results?.[0]?.result ?? null;
  } catch (_) {
    return false; // extension/devtools page — injection not allowed
  }

  if (probeResult?.pong) return true; // already alive

  // Not alive — inject CSS then JS
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch (err) {
    console.warn("[DynSearch BG] inject failed for tab", tabId, err.message);
    return false;
  }
}

// ── Toggle search overlay in a tab ───────────────────────────────────────────
async function toggleSearch(tabId) {
  const alive = await ensureContentScript(tabId);
  if (!alive) return false;

  const resp = await relayToTab(tabId, { action: "togglePopup" });

  // Sync our enabledTabs set with the actual popup state reported by content
  if (resp?.popupOpen === true)  enabledTabs.add(tabId);
  if (resp?.popupOpen === false) enabledTabs.delete(tabId);

  return resp?.popupOpen ?? enabledTabs.has(tabId);
}

// ── Listeners ─────────────────────────────────────────────────────────────────

// Toolbar icon click (no popup when action.default_popup is set — but kept
// as a fallback in case the popup fails to open on some Edge builds)
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) toggleSearch(tab.id);
});

// Inject into all existing tabs on install / update
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install" && reason !== "update") return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) continue;
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (_) {
      // Some tabs reject injection (pinned NTP, edge:// pages) — safe to skip
    }
  }
});

// Central message router
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── getState: popup boot — which tab is active and is it enabled? ──────────
  if (msg.action === "getState") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void chrome.runtime.lastError;
      const tabId = tabs?.[0]?.id ?? null;
      sendResponse({ enabled: tabId ? enabledTabs.has(tabId) : false, tabId });
    });
    return true; // async
  }

  // ── toggleFromPopup: popup toggle switch flipped ───────────────────────────
  if (msg.action === "toggleFromPopup" && msg.tabId != null) {
    toggleSearch(msg.tabId).then((nowOpen) => {
      sendResponse({ enabled: nowOpen });
    });
    return true; // async
  }

  // ── getStatusFromTab: popup wants live stats ───────────────────────────────
  if (msg.action === "getStatusFromTab" && msg.tabId != null) {
    relayToTab(msg.tabId, { action: "getStatus" }).then((resp) => {
      sendResponse(resp ?? {});
    });
    return true; // async
  }

  // ── getLogFromTab: popup wants the debug log ───────────────────────────────
  if (msg.action === "getLogFromTab" && msg.tabId != null) {
    relayToTab(msg.tabId, { action: "getDebugLog" }).then((resp) => {
      sendResponse(resp ?? { log: [] });
    });
    return true; // async
  }

  // ── clearLogFromTab: popup cleared the log ─────────────────────────────────
  if (msg.action === "clearLogFromTab" && msg.tabId != null) {
    relayToTab(msg.tabId, { action: "clearLog" }).then(() => {
      sendResponse({ ok: true });
    });
    return true; // async
  }

  // Unknown message — respond so the channel closes cleanly
  sendResponse({ ok: false, reason: "unknown action" });
  return false;
});

// Clean up state when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  enabledTabs.delete(tabId);
});
