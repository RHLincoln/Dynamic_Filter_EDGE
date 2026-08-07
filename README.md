# DynamicSearchLiteSafe

A lightweight Microsoft Edge extension that adds a popup **dynamic search** box to every page. It highlights matches and **auto‑updates** as content changes (scrolling, dropdowns, SPA navigation, lazy loading). Designed specifically for **managed enterprise devices**, with **minimal permissions**, **zero network calls**, and **low resource usage**.

> **Build type:** Minimal permissions, popup-based dynamic search
> This version is optimized for performance and safety in organizational environments.

---

## Features

- **Popup search UI** injected directly into each page
- **Automatic dynamic highlighting** for new content:
  - Dropdown menus
  - Infinite-scroll tables
  - SPA route changes
  - AJAX/lazy-loaded elements
- **Navigation controls**
  - Next / Previous match
  - Smooth scrolling to each match
- **Match counter** (`current / total`)
- **Keyboard shortcuts**
  - `Ctrl + Shift + F` → Toggle popup
  - `Enter` → Next match
  - `Shift + Enter` → Previous match
  - `Esc` → Close and clear highlights
- **No advanced permissions** (no `"tabs"`, `"activeTab"`, `"commands"`, `"host_permissions"`)
- **Safe for org-managed devices**
- **Low CPU usage** (debounced scanning, minimal DOM overhead)

---

## Why DynamicSearchLiteSafe?

Edge’s default `Ctrl+F` search only looks at currently rendered text. Modern web apps dynamically update the DOM or hide content inside dropdowns, infinite scroll lists, shadow DOM, or SPA components.  
`DynamicSearchLiteSafe` solves this by:

- Watching dynamic DOM updates
- Re-running text matching automatically
- Avoiding heavy indexing that could cause CPU spikes

This makes it ideal for internal dashboards, transit management tools, large data tables, and enterprise applications.

---

## Installation (Load Unpacked)

1. Open **Microsoft Edge → Extensions**.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the directory containing:

manifest.json
background.js
content.js
styles.css


This extension does **not** require Edge Add-ons Store publishing and works fully offline.

---

## Usage

1. Open any webpage.
2. Press **Ctrl + Shift + F** or click the extension’s toolbar icon.
3. Type into the search box.
4. Navigate results:
- `Enter` → Next match  
- `Shift + Enter` → Previous match  
5. Scroll, open menus, interact with the page — **new matches will be highlighted automatically**.
6. Press **Esc** or click the **✕** icon to shut down the popup and clear highlights.

---

## How It Works (Developer Details)

### Highlighting
- Uses a `TreeWalker` with `NodeFilter.SHOW_TEXT` to identify text nodes.
- Wraps matches in `<mark class="dyn-mark">`.
- Unwraps previous `<mark>` nodes before each refresh to avoid nesting.

### Dynamic Updating
- A `MutationObserver` watches the DOM for:
- added/removed nodes
- updated text content
- Debounce logic (150ms default) prevents excessive rescans.

### SPA Support
- Listens for:
- `popstate`
- `hashchange`
- Re-highlights after internal page navigation.

### UI Injection
The search box is injected into the DOM as a fixed-position overlay:


### Permissions
This version intentionally avoids all privileged extension APIs:

- No `"permissions"`
- No `"host_permissions"`
- No `"commands"`

The local keyboard shortcut is implemented inside the content script.

---

## File Structure

DynamicSearchLiteSafe/
├─ manifest.json
├─ background.js
├─ content.js
└─ styles.css

### Component Roles

- `manifest.json` — MV3 definition for Edge extension
- `background.js` — lightweight relay for toolbar icon clicks (no tabs permission)
- `content.js` — popup UI, search logic, highlighting, observer
- `styles.css` — styling for popup and highlight markers

---

## Security & Privacy

- **No data collection**
- **No external requests**
- **No cookies or storage access**
- **Runs only within DOM of active webpages**
- **No privileged APIs**
- **Safe in enterprise-managed environments**

This extension operates purely via DOM manipulation and user-triggered events.

---

## Roadmap

Future enhancements (optional):

- Match Case / Whole Word toggles
- Regex search mode
- Scan only visible viewport for better performance
- Custom exclude selectors
- Dark theme for popup
- Export settings/prefs (still without special permissions)

---

## License

None

---

## Credits

Built by Rabiul Hasan Lincoln (Assistant Transit Management Analyst 1).  
Designed for safe, efficient, dynamic search usage in enterprise environments.
