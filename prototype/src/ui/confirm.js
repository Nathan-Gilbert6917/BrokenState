// One confirmation style for orders that cannot be taken back (executing or releasing a prisoner, pulling a building
// down, breaking gear down for firewood, robbing a caravan or merchants, joining a war, expelling a coalition member,
// giving up a job, ending a trade route, deleting a supply run or a work role, digging a growing crop under): a small
// box over everything that spells out what happens, Yes / Cancel, Enter / Esc, and "Don't ask again" for that kind of
// order (remembered in the options: options.noAsk; Menu → Options → Confirmations asks again). The menu's own
// questions (load, exit without saving, delete a save…) use the same box (ui/settings.js confirmBox). Battles keep
// their own: "Space again" to end a turn with actions left, and the retreat and fall-back panels.
//
// In an action handler:  if (ask(ui, d, "pr-execute", { kind: "execute", title, text, yes })) return;
// The box remembers the action and its data; Yes runs the action again with d.ok = "1" (main.js ASK_ACTIONS).
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The kinds, as the box and the menu name them ("Don't ask again before …").
export const ASK_KINDS = {
  execute: "executing a prisoner", release: "releasing a prisoner", demolish: "pulling a building down",
  breakdown: "breaking gear down for firewood", rob: "robbing a caravan or merchants", war: "joining or leaving a war",
  expel: "expelling a coalition member", giveup: "giving up a job", endroute: "ending a trade route",
  delrun: "deleting a supply run", delrole: "deleting a work role", clearcrop: "digging a growing crop under",
  stripv: "stripping a vehicle for parts", salvage: "taking gear apart for parts",
};

let OPT = null, SAVE = null; // the options and their save (main.js initConfirm); without them (headless tools) every kind asks
export const initConfirm = (options, save) => { OPT = options; SAVE = save || null; };
export const skipped = (kind) => !!(OPT && OPT.noAsk && OPT.noAsk[kind]);

// Puts the question up unless it was answered (d.ok) or this kind is not asked any more. Returns true when it did.
// q: { kind, title, text (the consequence), yes (the button) }.
export function ask(ui, d, action, q) {
  if ((d && d.ok === "1") || skipped(q.kind)) return false;
  const data = {};
  for (const k of Object.keys(d || {})) if (k !== "ok") data[k] = d[k];
  ui.ask = { action, data, kind: q.kind, title: q.title || "Are you sure?", text: q.text || "", yes: q.yes || "Yes", skip: false };
  return true;
}

// The box. opts: { title, text, yes, yesAction, noAction, skipAction, skip, skipLabel, data } (the menu passes its own
// actions; the map screen's box is askHtml below).
export function askBoxHtml(o) {
  const data = o.data ? Object.entries(o.data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("") : "";
  return `<div class="askwrap"><div class="askbox" role="alertdialog">
    <div class="asktitle">${esc(o.title)}</div>${o.text ? `<div class="asktext">${esc(o.text)}</div>` : ""}
    ${o.skipAction ? `<label class="askskip"><input type="checkbox" data-action="${o.skipAction}"${o.skip ? " checked" : ""}> ${esc(o.skipLabel)}</label>` : ""}
    <div class="askbtns"><button class="danger primary" data-action="${o.yesAction}"${data} data-tip="Enter">${esc(o.yes)}</button><button data-action="${o.noAction}" data-tip="Esc">Cancel</button></div>
  </div></div>`;
}
export function askHtml(ui) {
  const a = ui && ui.ask;
  if (!a) return "";
  return askBoxHtml({ ...a, yesAction: "ask-yes", noAction: "ask-no", skipAction: ASK_KINDS[a.kind] ? "ask-skip" : "", skipLabel: `Don't ask again before ${ASK_KINDS[a.kind]}` });
}

// Enter: yes, Esc: cancel; every other key waits while the box is up. Returns true when the key was taken.
export function askKey(ui, e, actions) {
  if (!ui.ask) return false;
  if (e.code === "Enter" || e.code === "NumpadEnter") ASK_ACTIONS["ask-yes"](ui, {}, actions);
  else if (e.code === "Escape") ui.ask = null;
  return true;
}

// The handlers (main.js: fn(ui, d, actions)). The dim backdrop takes the clicks meant for what is under it: Yes,
// Cancel, Enter or Esc.
export const ASK_ACTIONS = {
  "ask-yes": (ui, d, actions) => {
    const a = ui.ask;
    ui.ask = null;
    if (!a) return;
    if (a.skip && ASK_KINDS[a.kind] && OPT) { OPT.noAsk = { ...(OPT.noAsk || {}), [a.kind]: true }; if (SAVE) SAVE(); }
    const fn = actions && actions[a.action];
    if (fn) fn({ ...a.data, ok: "1" });
  },
  "ask-no": (ui) => { ui.ask = null; },
  "ask-skip": (ui) => { if (ui.ask) ui.ask.skip = !ui.ask.skip; },
  "ask-reset": (ui, d) => resetAsk((d && d.k) || ""), // Menu → Options → Confirmations: ask again (one kind, or all)
};

// Menu → Options → Confirmations: the kinds not asked any more, each with Ask again.
export function confirmRows() {
  const off = Object.keys((OPT && OPT.noAsk) || {}).filter((k) => ASK_KINDS[k]);
  if (!off.length) return `<span class="small muted">Every order that cannot be undone asks first. Tick "Don't ask again" in a question to stop it for that kind of order.</span>`;
  return `<span class="small">Not asked any more:</span> ${off.map((k) => `<button class="mini" data-action="ask-reset" data-k="${k}" data-tip="Ask again before ${esc(ASK_KINDS[k])}">${esc(ASK_KINDS[k])} ✕</button>`).join("")}
    <button class="mini" data-action="ask-reset" data-tip="Ask again before every kind of order">Ask again for all</button>`;
}
export function resetAsk(k) {
  if (!OPT) return;
  if (k) { const n = { ...(OPT.noAsk || {}) }; delete n[k]; OPT.noAsk = n; } else OPT.noAsk = {};
  if (SAVE) SAVE();
}
