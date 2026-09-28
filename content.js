/**
 * content.js – DynamicSearchLiteSafe v3.1
 *
 * Bug fixes from v3.0
 * ════════════════════════════════════════════════════════════════
 *
 * BUG 1 — Navigation always resets to match 1
 * ────────────────────────────────────────────
 * Root cause: the v3.0 fingerprint used `document.body.innerText`,
 * which is LAYOUT-DEPENDENT. When `scrollTo()` calls
 * `classList.add("dyn-mark-current")`, browsers often re-layout,
 * which changes what `innerText` returns (collapsed sections expand,
 * whitespace normalisation shifts, etc.). The fingerprint therefore
 * changed even though no real content changed, the observer fired,
 * `scheduleRescan()` ran, `highlightQuery()` was called, and
 * `currentIdx` was reset to 0 every time.
 *
 * Fix: replace the innerText fingerprint with a flag+rAF guard that
 * is actually race-free.  The flag (`_ownWrite`) is set to `true`
 * before we touch the DOM and cleared inside a `requestAnimationFrame`
 * callback — AFTER the browser has flushed paint and delivered all
 * mutation records that our write caused.  v2.x tried a plain boolean
 * cleared in `finally{}`, which cleared BEFORE the async MutationObserver
 * callback ran.  The rAF guarantee fixes that.
 *
 * BUG 2 — Clicking a real <a href> link destroys state
 * ─────────────────────────────────────────────────────
 * Root cause: `popstate`/`hashchange` only fire for History-API (SPA)
 * navigation. A normal link load destroys the entire JS context —
 * all variables, the popup, the observer — and the content script
 * re-runs from scratch on the new page with no memory of the previous
 * query.
 *
 * Fix: persist `lastQuery` and `popupWasOpen` to
 * `chrome.storage.session` (tab-scoped, cleared when the tab closes,
 * never written to disk).  On script init, read them back.  If a query
 * was active, auto-reopen the popup and re-run the search on the new
 * page.  This gives seamless cross-page search with zero extra
 * permissions (storage is already declared).
 */

if (typeof window.__dynSearchReady === "undefined") {
  window.__dynSearchReady = true;

  // ── Debug log (ring buffer 200) ──────────────────────────────────────────────
  window.__dynSearchLog = [];
  function log(level, ...args) {
    const entry = { ts: new Date().toISOString(), level, msg: args.map(String).join(" ") };
    window.__dynSearchLog.push(entry);
    if (window.__dynSearchLog.length > 200) window.__dynSearchLog.shift();
    if (level === "error") console.error("[DynSearch]", ...args);
    else if (level === "warn")  console.warn("[DynSearch]",  ...args);
  }

  // ── State ────────────────────────────────────────────────────────────────────
  let popup      = null;
  let inputEl    = null;
  let countEl    = null;
  let marks      = [];
  let currentIdx = -1;
  let lastQuery  = "";
  let debounceTimer = null;
  let rescanTimer   = null;
  let _observer     = null;

  // FIX 1: replaces the innerText fingerprint.
  // Set to true before any DOM write; cleared inside a rAF so it stays
  // true until AFTER the browser has delivered all resulting mutation records.
  let _ownWrite = false;

  // ── Session-storage helpers (FIX 2) ─────────────────────────────────────────
  // chrome.storage.session is tab-isolated and clears when the tab closes.
  // We use it to carry the active query across real page navigations.
  const SESSION_KEY = "__dynSearch_session";

  function saveSession() {
    try {
      chrome.storage.session.set({
        [SESSION_KEY]: { query: lastQuery, open: !!popup }
      });
    } catch (_) { /* storage unavailable on some pages — safe to ignore */ }
  }

  async function loadSession() {
    try {
      const result = await chrome.storage.session.get(SESSION_KEY);
      return result?.[SESSION_KEY] ?? null;
    } catch (_) {
      return null;
    }
  }

  function clearSession() {
    try { chrome.storage.session.remove(SESSION_KEY); } catch (_) {}
  }

  // ── Own-write guard (FIX 1) ──────────────────────────────────────────────────
  // Call this before touching the DOM. The guard stays active until after the
  // next paint (rAF), which is after the browser delivers mutation records.
  function markOwnWrite() {
    _ownWrite = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {          // double-rAF: guarantees post-paint
        _ownWrite = false;
      });
    });
  }

  // ── Observer ─────────────────────────────────────────────────────────────────
  function startObserver() {
    if (_observer) return;
    _observer = new MutationObserver(() => {
      if (!lastQuery) return;
      if (_ownWrite) return;               // mutation came from us — skip
      scheduleRescan();
    });
    _observer.observe(document.documentElement, {
      childList:     true,
      subtree:       true,
      characterData: true,
    });
    log("info", "observer started");
  }

  function stopObserver() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
      log("info", "observer stopped");
    }
  }

  // ── Highlight engine ─────────────────────────────────────────────────────────
  function clearHighlights() {
    markOwnWrite();                         // unwrapping marks = our own write
    marks.forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
    marks      = [];
    currentIdx = -1;
    if (countEl) countEl.textContent = "0 / 0";
  }

  function highlightQuery(query) {
    clearHighlights();
    lastQuery = query;
    saveSession();                          // FIX 2: persist immediately

    if (!query) return;

    let re;
    try {
      re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    } catch (e) {
      log("warn", "bad pattern", e.message);
      return;
    }

    // Collect matching text nodes
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const el  = node.parentElement;
          if (!el) return NodeFilter.FILTER_REJECT;
          const tag = el.tagName.toUpperCase();
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT")
            return NodeFilter.FILTER_REJECT;
          if (el.closest("#dyn-search-popup"))
            return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue.trim())
            return NodeFilter.FILTER_SKIP;
          re.lastIndex = 0;
          return re.test(node.nodeValue)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      }
    );

    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    // Insert marks — guard the entire batch as a single own-write
    markOwnWrite();
    textNodes.forEach((textNode) => {
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      const text = textNode.nodeValue;
      let last = 0, m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last)
          frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement("mark");
        mark.className = "dyn-mark";
        mark.textContent = m[0];
        frag.appendChild(mark);
        marks.push(mark);
        last = re.lastIndex;
      }
      if (last < text.length)
        frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    });

    log("info", `highlighted ${marks.length} matches for "${query}"`);
    updateCount();

    if (marks.length > 0) {
      currentIdx = 0;
      scrollTo(0);
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  // classList changes are also DOM mutations — guard them too.
  function scrollTo(idx) {
    if (!marks.length || idx < 0 || idx >= marks.length) return;
    markOwnWrite();                         // FIX 1: class changes are mutations
    marks.forEach((m) => m.classList.remove("dyn-mark-current"));
    marks[idx].classList.add("dyn-mark-current");
    marks[idx].scrollIntoView({ behavior: "smooth", block: "center" });
    updateCount();
    log("info", `at match ${idx + 1} / ${marks.length}`);
  }

  function navigateNext() {
    if (!marks.length) return;
    currentIdx = (currentIdx + 1) % marks.length;
    scrollTo(currentIdx);
  }

  function navigatePrev() {
    if (!marks.length) return;
    currentIdx = (currentIdx - 1 + marks.length) % marks.length;
    scrollTo(currentIdx);
  }

  function updateCount() {
    if (!countEl) return;
    countEl.textContent = marks.length === 0
      ? "0 / 0"
      : `${currentIdx + 1} / ${marks.length}`;
  }

  // ── Debounced rescan (dynamic content changes) ───────────────────────────────
  function scheduleRescan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      if (lastQuery) {
        log("info", "rescan triggered by page change");
        highlightQuery(lastQuery);
      }
    }, 500);
  }

  // ── In-page popup UI ─────────────────────────────────────────────────────────
  function createPopup() {
    if (popup) { inputEl?.focus(); return; }
    log("info", "createPopup");

    popup = document.createElement("div");
    popup.id = "dyn-search-popup";
    popup.setAttribute("role", "search");
    popup.setAttribute("aria-label", "Dynamic search");
    popup.innerHTML = `
      <input id="dyn-search-input" type="text" placeholder="Search page…"
             autocomplete="off" spellcheck="false" aria-label="Search term"/>
      <span  id="dyn-search-count" aria-live="polite">0 / 0</span>
      <button id="dyn-prev"  title="Previous (Shift+Enter)" aria-label="Previous">&#8593;</button>
      <button id="dyn-next"  title="Next (Enter)"           aria-label="Next">&#8595;</button>
      <button id="dyn-close" title="Close (Esc)"            aria-label="Close">&#10005;</button>
    `;
    document.body.appendChild(popup);

    inputEl = popup.querySelector("#dyn-search-input");
    countEl = popup.querySelector("#dyn-search-count");

    inputEl.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => highlightQuery(inputEl.value.trim()), 300);
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter")  { e.preventDefault(); e.shiftKey ? navigatePrev() : navigateNext(); }
      if (e.key === "Escape") { e.preventDefault(); closePopup(); }
    });

    popup.querySelector("#dyn-prev").addEventListener("click",  navigatePrev);
    popup.querySelector("#dyn-next").addEventListener("click",  navigateNext);
    popup.querySelector("#dyn-close").addEventListener("click", closePopup);

    // Restore previous query (works for both SPA and real-page-load resumption)
    if (lastQuery) {
      inputEl.value = lastQuery;
      highlightQuery(lastQuery);
    }

    requestAnimationFrame(() => inputEl?.focus());
    startObserver();
    saveSession();                          // FIX 2: record that popup is open
    log("info", "popup created");
  }

  function closePopup() {
    log("info", "closePopup");
    clearHighlights();
    stopObserver();
    clearTimeout(debounceTimer);
    clearTimeout(rescanTimer);
    popup?.remove();
    popup = inputEl = countEl = null;
    marks      = [];
    currentIdx = -1;
    lastQuery  = "";
    _ownWrite  = false;
    clearSession();                         // FIX 2: user explicitly closed — don't reopen
    log("info", "popup closed and session cleared");
  }

  function togglePopup() {
    popup ? closePopup() : createPopup();
  }

  // ── SPA navigation (History API) ─────────────────────────────────────────────
  ["popstate", "hashchange"].forEach((evt) =>
    window.addEventListener(evt, () => {
      if (lastQuery) {
        // Page content will change — let the observer catch it via scheduleRescan.
        // But also schedule a fallback rescan ourselves in case the SPA swaps
        // content before the observer fires.
        setTimeout(() => {
          if (lastQuery) {
            log("info", "SPA nav detected — re-highlighting");
            highlightQuery(lastQuery);
          }
        }, 400);
      }
    })
  );

  // ── Keyboard shortcut (Ctrl+Shift+F) ─────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "F") {
      e.preventDefault();
      togglePopup();
    }
  });

  // ── Message listener ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "togglePopup") {
      togglePopup();
      sendResponse({ ok: true, popupOpen: !!popup });
      return false;
    }
    if (msg.action === "getStatus") {
      sendResponse({ popupOpen: !!popup, matchCount: marks.length, currentIdx, lastQuery, logEntries: window.__dynSearchLog.length });
      return false;
    }
    if (msg.action === "getDebugLog") {
      sendResponse({ log: window.__dynSearchLog.slice() });
      return false;
    }
    if (msg.action === "clearLog") {
      window.__dynSearchLog = [];
      sendResponse({ ok: true });
      return false;
    }
    sendResponse({ ok: false, reason: "unknown action" });
    return false;
  });

  // ── Init: restore session across real page loads (FIX 2) ─────────────────────
  // If the user had a search open and then clicked a real <a href> link,
  // the page reloaded and this script ran fresh. We read back the session
  // and reopen the popup with the previous query on the new page.
  (async () => {
    const session = await loadSession();
    if (session?.open && session?.query) {
      log("info", `restoring session query "${session.query}" after page load`);
      lastQuery = session.query;            // set before createPopup so it picks it up
      // Small delay: let the page finish rendering before we walk its text nodes
      setTimeout(() => createPopup(), 350);
    }
  })();

  log("info", "content script ready (v3.1)");
}
