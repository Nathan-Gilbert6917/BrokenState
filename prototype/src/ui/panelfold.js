// Folds in the side panels: a short line you can open for the long breakdown under it (styles.css .pf). The panels
// are redrawn as a whole (main.js setHTML), so each fold remembers whether it is open by its key, for the session.
//   key      unique and stable for what it shows ("upkeep:3")
//   summary  the line you click (HTML)
//   body     what it opens (HTML)
//   tipText  hover text on the line
const opened = new Set();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const foldIsOpen = (key) => opened.has(String(key));
export function setFoldOpen(key, open) {
  if (open) opened.add(String(key));
  else opened.delete(String(key));
}
export function fold(key, summary, body, { cls = "", tipText = "" } = {}) {
  if (!body) return "";
  return `<details class="pf${cls ? ` ${cls}` : ""}" data-fold="${esc(key)}"${foldIsOpen(key) ? " open" : ""}><summary${tipText ? ` data-tip="${esc(tipText)}"` : ""}>${summary}</summary><div class="pf-body">${body}</div></details>`;
}

// A <details> opened or closed by the player: remember it (toggle does not bubble, so listen while it captures).
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d && d.dataset && d.dataset.fold != null) setFoldOpen(d.dataset.fold, d.open);
  }, true);
}
