(() => {
  const OVERLAY_ID = "dyn-search-overlay";

  const state = {
    query: "",
    marks: [],
    index: 0,
    observer: null,
    overlay: null,
    input: null,
    countEl: null
  };

  function ensureOverlay() {
    let existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      state.overlay = existing;
      state.input = existing.querySelector("#dyn-search-input");
      state.countEl = existing.querySelector("#dyn-count");
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.display = "none";

    overlay.innerHTML = `
      <div class="dyn-box" role="group" aria-label="Dynamic search">
        <input id="dyn-search-input" type="text" placeholder="Dynamic search…" aria-label="Search" />
        <span id="dyn-count">0/0</span>
        <button id="dyn-btn-prev" title="Previous (Shift+Enter)" aria-label="Previous">▲</button>
        <button id="dyn-btn-next" title="Next (Enter)" aria-label="Next">▼</button>
        <button id="dyn-btn-close" title="Close (Esc)" aria-label="Close">✕</button>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    state.overlay = overlay;
    state.input = overlay.querySelector("#dyn-search-input");
    state.countEl = overlay.querySelector("#dyn-count");

    overlay.querySelector("#dyn-btn-prev").addEventListener("click", () => goTo(-1));
    overlay.querySelector("#dyn-btn-next").addEventListener("click", () => goTo(1));
    overlay.querySelector("#dyn-btn-close").addEventListener("click", closePopup);

    state.input.addEventListener("input", onQueryChange);
    state.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); goTo(-1); }
      else if (e.key === "Enter")           { e.preventDefault(); goTo(1); }
      else if (e.key === "Escape")          { e.preventDefault(); closePopup(); }
    });

    document.addEventListener("keydown", (e) => {
      // Local shortcut: Ctrl+Shift+F toggles popup without needing extension 'commands'
      const isLocalToggle = e.ctrlKey && e.shiftKey && e.key?.toLowerCase() === "f";
      if (isLocalToggle) {
        e.preventDefault();
        togglePopup();
      } else if (e.key === "Escape" && isPopupVisible()) {
        e.preventDefault();
        closePopup();
      }
    });
  }

  function isPopupVisible() {
    return !!state.overlay && state.overlay.style.display !== "none";
  }

  function togglePopup() {
    if (isPopupVisible()) closePopup();
    else openPopup();
  }

  function openPopup() {
    ensureOverlay();
    state.overlay.style.display = "block";
    setTimeout(() => state.input?.focus(), 0);
    startObserver();
  }

  function closePopup() {
    stopObserver();
    clearHighlights();
    if (state.overlay) state.overlay.style.display = "none";
    state.query = "";
    state.index = 0;
    updateCount();
  }

  function onQueryChange() {
    state.query = (state.input.value || "").trim();
    rehighlightAll();
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  const rehighlightAll = debounce(() => {
    clearHighlights();
    if (!state.query) {
      state.marks = [];
      state.index = 0;
      updateCount();
      return;
    }
    highlightAll(state.query);
    state.index = 0;
    updateCurrent();
  }, 150);

  function startObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver(() => { if (state.query) rehighlightAll(); });
    state.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.addEventListener("popstate", rehighlightAll, { passive: true });
    window.addEventListener("hashchange", rehighlightAll, { passive: true });
  }

  function stopObserver() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    window.removeEventListener("popstate", rehighlightAll);
    window.removeEventListener("hashchange", rehighlightAll);
  }

  function clearHighlights() {
    document.querySelectorAll("mark.dyn-mark").forEach((m) => {
      // unwrap mark but keep text
      const text = document.createTextNode(m.textContent || "");
      m.replaceWith(text);
    });
    state.marks = [];
  }

  function isExcluded(node) {
    let el = node.parentElement;
    while (el) {
      if (el.id === OVERLAY_ID) return true;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return true;
      el = el.parentElement;
    }
    return false;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightAll(query) {
    const regex = new RegExp(escapeRegExp(query), "gi");
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (n) => {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return isExcluded(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue;
      let match, lastIndex = 0, found = false;
      regex.lastIndex = 0;

      const frag = document.createDocumentFragment();

      while ((match = regex.exec(text)) !== null) {
        found = true;
        const before = text.slice(lastIndex, match.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const mark = document.createElement("mark");
        mark.className = "dyn-mark";
        mark.textContent = match[0];
        frag.appendChild(mark);

        lastIndex = regex.lastIndex;
      }
      if (found) {
        const after = text.slice(lastIndex);
        if (after) frag.appendChild(document.createTextNode(after));
        node.parentNode.replaceChild(frag, node);
      }
    }

    state.marks = Array.from(document.querySelectorAll("mark.dyn-mark")).filter((m) => {
      let el = m.parentElement;
      while (el) {
        if (el.id === OVERLAY_ID) return false;
        el = el.parentElement;
      }
      return true;
    });
    updateCount();
  }

  function updateCount() {
    if (!state.countEl) return;
    const total = state.marks.length;
    const current = total ? state.index + 1 : 0;
    state.countEl.textContent = `${current}/${total}`;
  }

  function updateCurrent() {
    state.marks.forEach((m) => m.classList.remove("dyn-current"));
    if (!state.marks.length) { updateCount(); return; }
    const m = state.marks[state.index];
    if (m) {
      m.classList.add("dyn-current");
      try { m.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }); }
      catch { m.scrollIntoView(); }
    }
    updateCount();
  }

  function goTo(delta) {
    if (!state.marks.length) return;
    state.index = (state.index + delta + state.marks.length) % state.marks.length;
    updateCurrent();
  }

  // Receive broadcast from background (toolbar icon click)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "TOGGLE_POPUP") {
      // Act only if this document is the visible, top page (prevents toggling in background tabs/frames)
      const isTop = window.top === window;
      const isVisible = document.visibilityState === "visible";
      if (isTop && isVisible) togglePopup();
    }
  });

  // Initialize hidden overlay
  ensureOverlay();
})();