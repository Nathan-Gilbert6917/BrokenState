// The box window (2026-10-19, user request: "... it will open up a window of items within the box"): an opened lock
// box or case (sim/boxes.js) shows what it holds, each thing with its picture, weight and condition and a Take button,
// and Take all. A thing taken goes onto the one who holds the box when it fits, else into the storage where the box is
// (the armory, the team's cargo); rounds into the stores or the cargo. Opened from the item right-click menu (Open,
// Force it open, Pick the lock, Look inside: ui/itemmenu.js) and the inventory's selection bar (ui/inventory.js).
// ui.box = { loc, sid, item, msg }: the box's inventory location, who opened it, the box itself (the window closes when
// the box is no longer there), the last message. Drawn into #boxview (main.js), over the windows.
import { GEAR, SUPPLIES, supWeight } from "../sim/data.js";
import { itemAt, itemLoad } from "../sim/inventory.js";
import { isBox, isSealed, boxText, boxEmptyKg, openBoxAt, takeFromBox, takeAllFromBox } from "../sim/boxes.js";
import { itemArtHtml, supplyArtHtml } from "./itemart.js";
import { isGunKey, gunIconHtml } from "./gunart.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kg = (v) => `${Math.round(v * 100) / 100} kg`;

// Opens the box at loc (forcing or picking its lock with the right tool when it is locked) and shows its window.
// Returns the message.
export function openBoxWindow(state, ui, loc, sid = null) {
  const box = itemAt(state, loc);
  if (!isBox(box)) return "That is not a box or a case.";
  let msg = "";
  if (isSealed(box)) {
    const r = openBoxAt(state, loc, sid);
    if (!r.ok) { if (ui.inv) ui.invMsg = r.msg; return r.msg; }
    msg = r.msg;
  }
  ui.box = { loc, sid, item: box, msg };
  if (ui.inv) ui.invMsg = msg;
  return msg;
}
// The box the window is on, or null (it was moved, sold, broken down: the window closes).
function boxOf(state, ui) {
  if (!ui.box) return null;
  const it = itemAt(state, ui.box.loc);
  if (it !== ui.box.item || !isBox(it) || isSealed(it)) { ui.box = null; return null; }
  return it;
}

export function boxViewHtml(state, ui) {
  const box = boxOf(state, ui);
  if (!box) return "";
  const rows = [];
  (box.contents || []).forEach((it, i) => {
    if (!it || !GEAR[it.key]) return;
    const pic = (isGunKey(it.key) && gunIconHtml(it, 1.3)) || itemArtHtml(it.key, 1.5) || "";
    const q = it.quality != null && it.quality < 1 ? `${Math.round(it.quality * 100)}%` : "";
    rows.push(`<div class="bwrow"><span class="bwpic">${pic}</span><span class="bwname">${esc(it.name)}</span><span class="bwq">${q}</span><span class="bwkg">${kg(itemLoad(it))}</span><button class="mini" data-action="box-take" data-i="${i}">Take</button></div>`);
  });
  for (const [k, v] of Object.entries(box.sup || {})) {
    if (!(v > 0)) continue;
    const name = (SUPPLIES[k] && SUPPLIES[k].name) || k;
    rows.push(`<div class="bwrow"><span class="bwpic">${supplyArtHtml(k, 1.5)}</span><span class="bwname">${v} × ${esc(name)}</span><span class="bwq"></span><span class="bwkg">${kg(supWeight(k) * v)}</span><button class="mini" data-action="box-take" data-sup="${esc(k)}">Take</button></div>`);
  }
  const empty = !rows.length;
  return `<div class="boxwin" role="dialog" aria-label="${esc(box.name)}">
    <div class="bwhead"><span class="bwpic">${itemArtHtml(box.key, 1.6)}</span><div><b>${esc(box.name)}</b><div class="small muted">${kg(itemLoad(box))} (${kg(boxEmptyKg(box))} empty)${box.forced ? " · its lock broken" : ""}</div></div><button class="mini bwx" data-action="box-close" aria-label="Close">✕</button></div>
    <div class="bwlist">${empty ? `<div class="muted small bwempty">Empty.</div>` : rows.join("")}</div>
    ${ui.box.msg ? `<div class="small bwmsg">${esc(ui.box.msg)}</div>` : ""}
    <div class="bwfoot">${empty ? "" : `<button data-action="box-takeall">Take all</button>`}<button data-action="box-close">Close</button></div>
  </div>`;
}

export const BOX_ACTIONS = {
  "box-take": (state, ui, d) => {
    if (!boxOf(state, ui)) return;
    ui.box.msg = takeFromBox(state, ui.box.loc, d.sup ? { sup: d.sup } : { i: Number(d.i) }) || ui.box.msg;
    if (ui.inv) ui.invMsg = ui.box.msg;
  },
  "box-takeall": (state, ui) => {
    if (!boxOf(state, ui)) return;
    ui.box.msg = takeAllFromBox(state, ui.box.loc);
    if (ui.inv) ui.invMsg = ui.box.msg;
  },
  "box-close": (state, ui) => { ui.box = null; },
};
// (boxText for a caller that wants the words: re-exported so the window and the tooltips say the same.)
export { boxText };
