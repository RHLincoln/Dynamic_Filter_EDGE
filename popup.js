/**
 * popup.js – DynamicSearchLiteSafe v2.0
 *
 * Key fix: popup.js does NOT have the "tabs" permission, so it cannot call
 * chrome.tabs.sendMessage directly — those calls fail silently and return {}.
 * ALL tab communication is now routed through background.js via
 * chrome.runtime.sendMessage, which does have the permission.
 *
 * Also added a live-poll interval so the stats update automatically while
 * the popup is open (every 800ms), without the user having to reopen it.
 */

"use strict";

// ── Communicate with background.js ────────────────────────────────────────────
// background.js then forwards to the content script as needed.
function ask(data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(data, (resp) => {
      // Swallow chrome.runtime.lastError so unchecked-error warnings don't
      // clutter the service-worker console.
      void chrome.runtime.lastError;
      resolve(resp || {});
    });
  });
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const toggleEl    = document.getElementById("enabled-toggle");
const toggleText  = document.getElementById("toggle-text");
const toggleSub   = document.getElementById("toggle-sub");
const statMatches = document.getElementById("stat-matches");
const statCurrent = document.getElementById("stat-current");
const statQuery   = document.getElementById("stat-query");
const logOutput   = document.getElementById("log-output");
const debugSection = document.getElementById("debug-section");

let activeTabId  = null;
let pollInterval = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  const state   = await ask({ action: "getState" });
  activeTabId   = state.tabId ?? null;
  toggleEl.checked = !!state.enabled;
  updateToggleLabel(!!state.enabled);
  await refreshStatus();

  // Live-poll stats every 800ms while the popup is open
  pollInterval = setInterval(refreshStatus, 800);
})();

// Stop polling when the popup closes (prevents ghost intervals)
window.addEventListener("unload", () => clearInterval(pollInterval));

// ── Toggle ────────────────────────────────────────────────────────────────────
toggleEl.addEventListener("change", async () => {
  if (!activeTabId) return;
  const resp = await ask({ action: "toggleFromPopup", tabId: activeTabId });
  toggleEl.checked = !!resp.enabled;
  updateToggleLabel(!!resp.enabled);
});

function updateToggleLabel(enabled) {
  if (enabled) {
    toggleText.textContent = "Search overlay is ON";
    toggleSub.textContent  = "Click to hide the in-page search box";
  } else {
    toggleText.textContent = "Enable on this page";
    toggleSub.textContent  = "Click to open the in-page search overlay";
  }
}

// ── Status refresh (routed through background) ────────────────────────────────
async function refreshStatus() {
  if (!activeTabId) return;

  const status = await ask({ action: "getStatusFromTab", tabId: activeTabId });

  if (status && typeof status.matchCount === "number") {
    setStatValue(statMatches, status.matchCount,
      status.matchCount > 0 ? "ok" : "off");
    setStatValue(statCurrent,
      status.matchCount > 0 ? status.currentIdx + 1 : "—",
      status.matchCount > 0 ? "ok" : "off");
    setStatValue(statQuery,
      status.lastQuery ? `"${status.lastQuery}"` : "—",
      status.lastQuery ? "warn" : "off");

    // Keep the toggle in sync with reality (popup may have been closed via Esc)
    if (typeof status.popupOpen === "boolean") {
      toggleEl.checked = status.popupOpen;
      updateToggleLabel(status.popupOpen);
    }
  } else {
    setStatValue(statMatches, "—", "off");
    setStatValue(statCurrent, "—", "off");
    setStatValue(statQuery,   "—", "off");
  }
}

function setStatValue(el, value, cls) {
  el.textContent = value;
  el.className   = "stat-value " + cls;
}

// ── Debug log ─────────────────────────────────────────────────────────────────
debugSection.addEventListener("toggle", () => {
  if (debugSection.open) loadLog();
});

document.getElementById("btn-refresh-log").addEventListener("click", loadLog);

document.getElementById("btn-copy-log").addEventListener("click", async () => {
  const btn  = document.getElementById("btn-copy-log");
  const text = logOutput.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  btn.textContent = "✓ Copied!";
  setTimeout(() => { btn.textContent = "⎘ Copy log"; }, 1500);
});

document.getElementById("btn-clear-log").addEventListener("click", async () => {
  if (!activeTabId) return;
  await ask({ action: "clearLogFromTab", tabId: activeTabId });
  logOutput.textContent = "(log cleared)";
});

async function loadLog() {
  logOutput.textContent = "Fetching…";
  if (!activeTabId) { logOutput.textContent = "(no active tab)"; return; }

  const resp    = await ask({ action: "getLogFromTab", tabId: activeTabId });
  const entries = resp?.log;

  if (!Array.isArray(entries) || entries.length === 0) {
    logOutput.textContent =
      "(no log entries yet)\n\nTip: open a regular https:// page, " +
      "use the toggle to open the search overlay, then reopen this panel.";
    return;
  }

  logOutput.innerHTML = entries.map((e) => {
    const cls = `log-${e.level || "info"}`;
    const ts  = e.ts ? e.ts.slice(11, 23) : "";
    const lvl = (e.level || "info").toUpperCase().padEnd(5);
    return `<span class="${cls}">[${ts}] [${lvl}] ${esc(e.msg)}</span>`;
  }).join("\n");

  logOutput.scrollTop = logOutput.scrollHeight;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
