// The battle's bottom bar, XCOM-style (the user's request 2026-10-12: "a lower bar hud like in Xcom like games with
// actions left"): the selected survivor's card and a tab for everyone of yours (left), an icon button for every order
// the selected unit has (middle), the turn controls, the weapon and the turn (right). ui/combat.js renderCombatBar
// gathers the data and main.js writes it into #cbbar (over the bottom of the battle map) on each refresh.
//   - Orders: ui/combat.js unitOrders, the same list of orders the side panel had, each with whether it can be given
//     now and why not (the sim's own refusals: fireRefusal, reloadRefusal, facesBox …). A button runs
//     combatAction("cb-act", { v }), the code its key runs (combatKey), so a click and a key press cannot differ.
//   - Keys: read from the key table (ui/keymap.js keyLabel), so a key changed in Menu → Controls shows here at once.
//   - Ready only (the user's request 2026-10-18: "clean it up for easier reading and usability … combine some into a
//     group that shows when you press a button or add a default button to only display options that you can take"):
//     by default the bar shows only the orders that can be given now. Its last button (All / Ready, remembered in the
//     browser) shows the rest too: the core ones greyed with the reason, and every other battle order of the key table
//     greyed with when it applies (tools/battlebartest.js checks the table against it).
//   - Inventory and Cones only look: they sit small in the corner of the selected one's card, not among the orders.
//   - Trays: the most used orders of each group stand on the bar (PRIMARY); the others of a group sit behind one button
//     (Moving, Fight, Wounded, Loot, Doors & lights, Vehicle, Other) that opens them in a tray over the bar. A group
//     with only one other order shows it on the bar instead, and so does a short list (TRAY_FROM): no tray for a few.
//   - Ready only reaches the panels over the bar too (a lock's, a car's): their greyed buttons hide (styles.css).
//   - Hovering an order lights the card's action diamonds it would spend (data-spend on the button, data-s on the
//     diamonds: 1 is the last; styles.css :has). Orders that need doing now (a jam, a gun or shotgun empty, someone to
//     revive) pulse (URGENT).
//   - Each order is a tile that reads without a hover (the user's request 2026-10-18): the icon over its name, its key as
//     a keycap at the top left, its cost as a pill at the top right (◆1, ◆2, free, ends turn; a tray button: +N orders
//     behind it). The turn controls on the right are labelled tiles too. styles.css #cbbar .bb-btn / .bb-ctl.
//   - Fits from 1280×720 up to a TV: the bar is a size container; narrow, the tiles shrink a little and wrap to a
//     second row, very wide it grows (styles.css #cbbar).
import { KEYMAP, KEY_BY_ID, keyLabel } from "./keymap.js";
import { unitChips, weaponPanelHtml } from "./battlehud.js";
import { statusIcons } from "./status.js";
import { unitCanvas, canvasURL, spriteImg } from "./sprites.js";
import { PAL } from "./palette.js";
import { activeLight, nvgOn, faceAng } from "../sim/vision.js";
import { LIGHTS } from "../sim/lights.js";
import { SEARCH } from "../sim/search.js";
import { INDOOR } from "../sim/indoorlight.js";
import { BMAP } from "../sim/buildingmaps.js";
import { WINDOW } from "../sim/windows.js"; // the window orders' costs
import { SHOVE, BOARD } from "../sim/barricade.js"; // Shove, Board up, Tear down (sim/barricade.js)
import { MEDIC } from "../sim/medics.js";
import { PLATE_AP } from "../sim/carrykit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const plain = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const first = (u) => String(u.name || "").split(" ")[0];
const shortKey = (k) => String(k || "").replace(/Shift\+/g, "⇧").replace(/Ctrl\+/g, "Ctrl ");

// ---------- the orders ----------
// The icon of each order (the game's emoji, as on the rest of its screens).
export const ICON = {
  move: "👣", face: "🧭", sneak: "🤫", goup: "⬆️", godown: "⬇️", evac: "🚨", evacStop: "✋", retreat: "🏃", extract: "🏁",
  shoot: "🎯", cab: "🚘", overwatch: "👁️", reload: "🔄", ammocycle: "🔃", getshells: "📥", firemode: "🔀", unjam: "🔧", suppress: "💢",
  launch: "🚀", glround: "🔃", glreload: "🔄", melee: "🗡️", pull: "👊", subdue: "🤜", taser: "⚡", reloadTaser: "🔋", pepper: "🌶️",
  throw: "🧨", throwspear: "🔱", pickspear: "✊", hunker: "🛡️",
  meds: "💊", heal: "🩹", revive: "💉", selfStab: "🩸", dragAlly: "🛷", dropVehicle: "🚑", drag: "🛷", tie: "🪢", finish: "💀", execute: "☠️", plate: "🦺",
  search: "🔍", searchBody: "🔍", quick: "🔎", ground: "🧺", dropCarried: "📤", dropAllCarried: "📤", pickCarried: "📦", crush: "🥾", doubletap: "💥", pickup: "🏋️", stowbody: "📦",
  peek: "🚪", close: "🚪", brace: "🧱", climb: "🧗", checkwindow: "🪟", openwindow: "🪟", closewindow: "🪟", breakwindow: "🪟", shove: "🪑", boardup: "🔨", teardown: "🪓", lights: "💡", light: "🔦", nvg: "🥽", visor: "⛑️",
  vehicle: "🧳", board: "🚙", disembark: "🚶", drive: "🏎️", turn: "↪️", gunner: "🪖", pullOut: "🆘",
  surrender: "🙌", takeAlive: "🤝", ladder: "🪜", push: "✋", ram: "🐏", dropRam: "⬇️", loadRam: "🐏", unloadRam: "🐏", takeRam: "🐏", drop: "🪨",
  inventory: "🎒", handover: "🤲", cones: "📐", more: "⋯",
};
const iconOf = (v) => ICON[v] || (String(v).startsWith("rescue:") ? "🔓" : "•");

// What an order costs (actions): a number, "end" (it ends the unit's turn), or words. unitOrders' ap wins (a reload
// from the pack is 2).
export const COST = {
  move: "1–2", face: 0, sneak: 0, light: 0, nvg: 0, visor: 0, firemode: 0, ammocycle: 0, glround: 0, quick: 0, vehicle: 0, ground: 0, peek: 0, pull: 0, takeAlive: 0,
  dropCarried: 0, dropAllCarried: 0, evac: "all", evacStop: 0, dragAlly: 0, dropVehicle: 0, inventory: 0, cones: 0, selfStab: 0, takeRam: 0, dropRam: 0,
  shoot: "end", cab: "end", overwatch: "end", melee: "end", hunker: "end", subdue: "end", taser: "end", launch: "end", brace: "end", ram: "end", drop: "end", surrender: "end",
  reload: 1, getshells: 1, suppress: 1, throwspear: 1, pickspear: 1, throw: 1, tie: 1, drag: 1, meds: 1, heal: 1, revive: 2, finish: 1, crush: 1, doubletap: 1, pickup: 1,
  stowbody: 1, pickCarried: 1, close: 1, climb: BMAP.CLIMB.ap, checkwindow: 0, openwindow: WINDOW.OPEN_AP, closewindow: WINDOW.OPEN_AP, breakwindow: WINDOW.BREAK.ap, shove: SHOVE.AP, boardup: BOARD.AP, teardown: BOARD.TEAR.ap, lights: INDOOR.AP, search: SEARCH.ap, searchBody: SEARCH.ap, extract: 1, retreat: 1, board: 1, disembark: 1,
  turn: 1, gunner: 1, drive: 2, pullOut: MEDIC.PULL.AP, goup: 1, godown: 1, unjam: 1, plate: PLATE_AP, reloadTaser: 1, pepper: 1, execute: 1, glreload: 1, ladder: 1,
  push: 1, loadRam: 1, unloadRam: 1, handover: 1, // handover: unitOrders' ap wins (a free Face toward the mate out of the cone)
};
const costOf = (o) => (o.ap != null ? o.ap : COST[o.v] != null ? COST[o.v] : String(o.v).startsWith("rescue:") ? 1 : null);
const costWord = (c) => (c === 0 ? "Free" : c === "end" ? "Ends the unit's turn" : c === "all" ? "Uses everyone's actions" : c == null ? "" : `${c} action${c === 1 ? "" : "s"}`);
// The diamonds an order spends: a number, "all" (it ends the turn, or uses everyone's), or none (free). Move: 1 (a dash 2).
const spendOf = (c) => (c === "end" || c === "all" ? "all" : typeof c === "number" ? (c > 0 ? String(c) : "") : c === "1–2" ? "1" : "");
// Orders that need doing now: they pulse while they can be given (an empty Reload and shells left in the pack say so
// in red in their label: ui/combat.js unitOrders).
const URGENT = new Set(["unjam", "revive"]);
const urgentOf = (o) => o.ok && (URGENT.has(o.v) || /class="danger"/.test(String(o.label)));
const costBadge = (c) => (c === 0 ? "free" : c === "end" ? "end" : c === "all" ? "all" : c == null ? "" : String(c));

// The bar's groups, left to right (a thin line between them): moving, fighting, the wounded, loot, doors and lights,
// the vehicle, the rest, then the look-only buttons (in the card's corner).
const GROUPS = [
  ["move", "face", "sneak", "goup", "godown", "evac", "evacStop", "retreat", "extract"],
  ["shoot", "cab", "overwatch", "reload", "ammocycle", "getshells", "firemode", "unjam", "suppress", "launch", "glround", "glreload", "melee", "pull", "subdue", "taser", "reloadTaser", "pepper", "throw", "throwspear", "pickspear", "hunker"],
  ["meds", "heal", "revive", "selfStab", "dragAlly", "dropVehicle", "drag", "tie", "finish", "execute", "plate"],
  ["search", "searchBody", "quick", "ground", "handover", "dropCarried", "dropAllCarried", "pickCarried", "crush", "doubletap", "pickup", "stowbody"],
  ["peek", "close", "brace", "climb", "checkwindow", "openwindow", "closewindow", "breakwindow", "shove", "boardup", "teardown", "lights", "light", "nvg", "visor"], // doors, windows (sim/windows.js), barricades (sim/barricade.js) and lights
  ["vehicle", "board", "disembark", "drive", "turn", "gunner", "pullOut"],
  [], // the rest: a rescue's ropes and locks, the siege kit, Surrender, Take them alive
  ["inventory", "cones"],
];
const MISC = 6, VIEW = 7;
// Each group's tray button (the view one has none: Inventory and Cones sit in the card's corner).
const TRAY = [["Moving", "🗺️"], ["Fight", "⚔️"], ["Wounded", "🩺"], ["Loot", "🗃️"], ["Doors & lights", "🏠"], ["Vehicle", "🚗"], ["Other", "🧰"]];
// The orders that stand on the bar, not in their group's tray: the everyday ones, and those that only show up when
// they matter (a jam, the way out, the shells in the pack, someone down, getting in or out of the car).
export const PRIMARY = new Set(["move", "sneak", "evacStop", "retreat", "extract", "shoot", "overwatch", "reload", "unjam", "getshells", "melee", "throw", "launch", "hunker",
  "meds", "heal", "revive", "selfStab", "search", "searchBody", "board", "disembark", "drive"]);
const TRAY_FROM = 9; // fewer orders than this (Inventory and Cones aside): all on the bar, no trays
const GROUP_OF = new Map(GROUPS.flatMap((g, i) => g.map((v, j) => [v, [i, j]])));
const rankOf = (v) => GROUP_OF.get(v) || [MISC, 99];

// Shown in every fight for a unit that can act, greyed with the reason when it cannot be given (the lights of a room:
// raids only, where the switches are).
export const CORE = ["move", "face", "sneak", "shoot", "overwatch", "reload", "melee", "hunker", "throw", "meds", "search", "vehicle", "light", "nvg"];
// When an order that is not offered now applies (the tip of its greyed button).
const WHEN = {
  shoot: "No usable gun.", overwatch: "Needs a loaded gun.", reload: "No gun with a magazine to reload.", melee: "No enemy right next to them.",
  light: "No light carried: a flashlight, a head torch or a light on the gun (found on raids, at the armory).",
  nvg: "No night vision goggles carried.", lights: "No light switch within reach: stand next to a room's switch (inside buildings on raids).",
  vehicle: (b) => (b.vehicle && b.vehicle.blownUp ? "The vehicle is a burnt-out wreck." : b.vehicle || (b.raid && (b.raid.hasVehicle ?? b.raid.vehicleZone >= 0)) ? "Get out of the vehicle first." : "You came on foot: there is no vehicle here."),
  search: "Nothing to search within reach: stand next to a container or a body, facing it.", quick: "Raids only: next to something nobody has opened yet.",
  ground: "Nothing on the ground within reach.", drag: "Stand next to a body, someone knocked out or a downed teammate.",
  heal: "Only a medic heals: someone carrying a med kit (bandage, trauma or surgical).", revive: "Only a medic, next to a downed teammate.",
  finish: "No downed enemy in sight.", gunner: "Only from inside a vehicle with a turret.", pullOut: "Nobody down inside a vehicle.",
  retreat: "No evac strip here.", extract: "Raids only: from a green extraction zone.", subdue: "Nobody right next to them to subdue.",
  tie: "Nobody knocked out or surrendered next to them.", throw: "Nothing to throw.", climb: "Inside a building on a raid: right next to a window.",
  peek: "Right next to a door or doorway (inside a building on a raid, or a house on the map).", close: "Next to an open door.",
  brace: "Next to a closed door.", crush: "No body right next to them that could get up.", doubletap: "No body in sight that could get up.",
  pickup: "No body right next to them to pick up.", stowbody: "Carry a body to the team's car first.", firemode: "This gun fires one way only.",
  unjam: "The gun is not jammed.", suppress: "Needs an automatic gun (or one made to suppress) with rounds.", throwspear: "Only with a spear in hand.",
  pickspear: "No thrown spear of theirs to pick up.", ammocycle: "Only one kind of round for this gun to hand.", visor: "No helmet with a visor.",
  launch: "No grenade launcher or rocket carried.", meds: "No meds left.", face: "Nobody to turn.", sneak: "Nobody to keep low.", hunker: "Nobody to hunker.",
  handover: "Nobody of yours right next to them in their view cone to trade with.",
};
const whenOf = (v, b, u) => { const w = WHEN[v]; return typeof w === "function" ? w(b, u) : w || "Not possible here now."; };
// Every battle order of the key table (Battle orders: the ones with a v), the inventory and the view cones: the
// actions that act on the selected unit, each of which the bar has a button for.
export const BAR_KEYS = KEYMAP.filter((k) => k.ctx === "battle" && (k.v || k.id === "battle.inventory" || k.id === "bview.cones"));
const vOfKey = (k) => (k.v ? k.v : k.id === "battle.inventory" ? "inventory" : "cones");
const keyOfV = (v) => (v === "inventory" ? "battle.inventory" : v === "cones" ? "bview.cones" : `battle.${v}`);
const KEYDEF = new Map(BAR_KEYS.map((k) => [vOfKey(k), k]));
const SHORT = { light: "Light", nvg: "NVG", lights: "Lights", vehicle: "Vehicle", search: "Search", quick: "Quick search", retreat: "Retreat", extract: "Extract", stowbody: "Stow body", pickup: "Pick up body", crush: "Crush skull", visor: "Visor", firemode: "Fire mode", unjam: "Unjam", suppress: "Suppress", throwspear: "Throw spear", pickspear: "Pick up spear", ammocycle: "Next round", launch: "Launch", gunner: "Turret", pullOut: "Pull out", close: "Close door", brace: "Brace door", climb: "Climb", checkwindow: "Check window", openwindow: "Open window", closewindow: "Close window", breakwindow: "Break window", shove: "Shove", boardup: "Board up", teardown: "Tear down", face: "Face", sneak: "Sneak", drag: "Drag", ground: "Ground" };
const nameOf = (v) => { if (SHORT[v]) return SHORT[v]; const k = KEYDEF.get(v); return k ? k.label.split(/ \(|:/)[0] : v; };

// The bar's orders for the selected unit: unitOrders' list, the core ones it lacks (greyed, with why), Inventory and
// Cones; each with its key as bound now. more: the key table's other orders, greyed with when they apply.
export function barOrders(b, u, list, { cones = false, canInv = false, acting = true } = {}) {
  const have = new Set(list.map((o) => o.v));
  const out = list.map((o) => ({ ...o }));
  if (acting) for (const v of CORE) if (!have.has(v)) out.push({ v, label: nameOf(v), tip: KEYDEF.get(v) ? KEYDEF.get(v).label : "", ok: false, why: whenOf(v, b, u), stub: true });
  if (acting && b.raid && !have.has("lights")) out.push({ v: "lights", label: "Lights", tip: KEYDEF.get("lights").label, ok: false, why: whenOf("lights", b, u), stub: true });
  out.push({ v: "inventory", act: "cb-inv", id: u ? u.id : null, label: "Inventory", tip: u ? `What ${first(u)} carries: worn, held, pockets, rig and pack. On their turn with an action left, moving a thing between pockets, the pack, a rig pouch and the hands costs 1 action a move (armour, helmet, rig and pack stay on); loose rounds dropped on a spare magazine load it (1 action from a pocket or the rig, both from the pack); otherwise look only.` : "", ok: canInv, why: "Select one of your people to see what they carry." });
  out.push({ v: "cones", act: "cb-view", dv: "cones", label: cones ? "Cones on" : "Cones", tip: "View cones: what each of your people watches and, for the enemies you see, how near an unaware one notices the selected unit in its cone (orange; the dashed ring: what it hears behind it) or where an aware one is looking (red). The selected unit's own cone is always shown.", ok: true, on: cones });
  for (const o of out) {
    const id = keyOfV(o.v);
    o.keyNow = o.k != null && !o.key ? "" : KEY_BY_ID.has(id) ? shortKey(keyLabel(id, 1)) : o.key || ""; // a second kind to throw: its key throws the first
  }
  out.sort((a, c) => { const [ga, ia] = rankOf(a.v), [gc, ic] = rankOf(c.v); return ga - gc || ia - ic; }); // stable: the misc keep their order
  const shown = new Set(out.map((o) => o.v));
  const more = BAR_KEYS.map(vOfKey).filter((v) => !shown.has(v)).map((v) => ({ v, label: nameOf(v), tip: KEYDEF.get(v).label, ok: false, why: whenOf(v, b, u), stub: true, keyNow: shortKey(keyLabel(keyOfV(v), 1)) }));
  return { list: out, more };
}

// One order button. The label comes first (the tools read "Melee <span class="key">V</span>"); the icon, the key and the
// cost are placed by styles.css (#cbbar .bb-btn).
function orderBtn(o, u, inTray = false) {
  const act = o.act || "cb-act";
  const c = costOf(o);
  const why = o.ok ? "" : o.why || (u && u.ap < 1 && c !== 0 ? "No actions left this turn." : "Not possible here now.");
  const title = `${plain(o.label)}${o.keyNow ? ` (${o.keyNow})` : ""}${costWord(c) ? ` · ${costWord(c)}` : ""}`;
  const tip = `${title}${why ? `\nNot now: ${why}` : ""}${o.tip && plain(o.tip) !== why ? `\n${plain(o.tip)}` : ""}`;
  const data = act === "cb-act" ? ` data-v="${esc(o.v)}"` : act === "cb-view" ? ` data-v="${esc(o.dv)}"` : "";
  const extra = `${o.k != null ? ` data-k="${esc(o.k)}"` : ""}${o.id != null ? ` data-id="${esc(o.id)}"` : ""}${inTray ? ` data-tray="1"` : ""}`; // given from a tray: it closes
  const cls = ["bb-btn", o.on ? "active" : "", o.ok ? "" : "off", o.stub ? "stub" : "", urgentOf(o) ? "urgent" : ""].filter(Boolean).join(" ");
  const spend = o.ok ? spendOf(c) : "";
  return `<button class="${cls}" data-action="${act}"${data}${extra} ${o.ok ? "" : "disabled"} data-tip="${esc(tip)}" data-tip-pre data-bv="${esc(o.v)}"${spend ? ` data-spend="${spend}"` : ""}>${o.label}${o.keyNow ? ` <span class="key">${esc(o.keyNow)}</span>` : ""}<i class="bb-ic">${iconOf(o.v)}</i>${costBadge(c) ? `<i class="bb-ap${c === "end" ? " end" : c === 0 ? " free" : ""}">${costBadge(c)}</i>` : ""}</button>`;
}
// What stands on the bar: shown (sorted by group) cut into the groups, each its PRIMARY orders (greyed: the core ones
// only) and either the rest too (one other, or a short list) or a tray button for them. flat: everything on the bar, no trays.
export function barLayout(shown, { flat = false } = {}) {
  const groups = [];
  for (const o of shown) { const gi = rankOf(o.v)[0]; if (!groups.length || groups[groups.length - 1].gi !== gi) groups.push({ gi, list: [] }); groups[groups.length - 1].list.push(o); }
  const trays = !flat && shown.filter((o) => rankOf(o.v)[0] !== VIEW).length >= TRAY_FROM;
  const onBar = (o) => PRIMARY.has(o.v) && (o.ok || o.on || CORE.includes(o.v)); // a greyed one that only matters now and then (Unjam, Revive …): its tray
  return groups.map(({ gi, list }) => {
    const rest = list.filter((o) => !onBar(o));
    if (!trays || gi === VIEW || rest.length < 2) return { gi, bar: list, tray: [] };
    return { gi, bar: list.filter(onBar), tray: rest };
  });
}
// A group's tray button: its name, how many of its orders can be given now; open, its tray stands over the bar.
function trayBtn(gi, tray, open) {
  const [name, ic] = TRAY[gi];
  const ready = tray.filter((o) => o.ok).length;
  const busy = tray.some((o) => o.on);
  const tip = open ? "" : `${name}: ${tray.map((o) => plain(o.label)).join(", ")}.\nOpens them in a tray over the bar (Esc closes it); each keeps its key.`; // open: no tip over the tray
  return `<button class="bb-btn bb-traybtn${open ? " active" : ""}${busy ? " busy" : ""}${ready ? "" : " off"}" data-action="cb-bar" data-v="tray" data-g="${gi}" data-tip="${esc(tip)}" data-tip-pre>${name}<i class="bb-ic">${ic}</i><i class="bb-caret">${open ? "▾" : "▴"}</i><i class="bb-ap">${ready}</i></button>`;
}
// The orders, a thin line between the groups.
function ordersHtml(layout, u, open) {
  return layout.map(({ gi, bar, tray }) => bar.map((o) => orderBtn(o, u)).join("") + (tray.length ? trayBtn(gi, tray, open === gi) : "")).filter(Boolean).join(`<i class="bb-sep"></i>`);
}
// The open tray: its orders with their names, over the bar.
function trayHtml(layout, u, open) {
  const g = layout.find((x) => x.gi === open && x.tray.length);
  if (!g) return "";
  const [name, ic] = TRAY[g.gi];
  return `<div class="bb-tray"><div class="bb-trayhead"><b>${ic} ${esc(name)}</b><button class="bb-trayx" data-action="cb-bar" data-v="tray" data-g="${g.gi}" data-tip="Close (Esc)">✕</button></div><div class="bb-trayrow">${g.tray.map((o) => orderBtn(o, u, true)).join("")}</div></div>`;
}

// ---------- the card ----------
const FACE_WORDS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"]; // map north: the compass's N (−y)
export function facingWord(u) {
  const a = faceAng(u);
  if (a == null) return "";
  return FACE_WORDS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
// num: each lit diamond carries its place from the last (data-s, 1 = the last): the card's, lit by a hovered order's cost.
const pips = (n, max, num = false) => `<span class="bb-pips">${Array.from({ length: Math.max(0, n) }, (_, i) => (num ? `<i class=on data-s=${n - i}></i>` : "<i class=on></i>")).join("")}${"<i></i>".repeat(Math.max(0, max - n))}</span>`;
const hpCol = (f) => (f > 0.6 ? PAL.good : f > 0.3 ? PAL.mid : PAL.bad);
function sprite(state, b, p, salt, size) {
  try { return spriteImg(canvasURL(unitCanvas(state, b, p, salt)), size); } catch { return ""; } // no canvas (a headless tool)
}
const survivorOf = (state, p) => (p && p.sid != null && state && state.survivors ? state.survivors.find((x) => x.id === p.sid) : null);
// The state chips of the card: the strip's (down, bleeding, overwatch, jammed …) and the selected one's own ways:
// sneaking, facing, the light and night vision, then the survivor's mood, hunger and the like.
export function cardChips(state, b, u) {
  const c = unitChips(state, b, u).map(([t, cls, tip]) => [t, cls, tip]);
  if (u.dead || u.left) return c;
  if (u.sneaking) c.push(["SNEAK", "info", "Sneaking: slower, silent, hidden behind cover from those it faces."]);
  const fw = facingWord(u);
  if (fw) c.push([`FACING ${fw.split("-").map((w) => w[0]).join("").toUpperCase()}`, "", `Facing ${fw} (the compass's N is north): the cone is what they watch; an overwatch reacts only in it, loot is searched only facing it.`]);
  if (u.light) { const L = LIGHTS[u.light] || {}; c.push([activeLight(u) ? "LIGHT ON" : "LIGHT OFF", activeLight(u) ? "warn" : "", `${L.name || "Light"} ${activeLight(u) ? "on: seen from far off by anyone facing it" : "off"}.`]); }
  if (u.nvg) c.push([nvgOn(u) ? "NVG ON" : "NVG OFF", nvgOn(u) ? "good" : "", `Night vision ${nvgOn(u) ? "on" : "off (flipped up)"}.`]);
  return c;
}
// look: the look-only buttons (Inventory, Cones), small in the card's corner.
function cardHtml(state, b, u, n, salt, head, look = "") {
  if (!u) return `<div class="bb-card empty"><span class="muted">Select one of your people (1–9 or Tab).</span>${look ? `<div class="bb-look">${look}</div>` : ""}</div>`;
  const f = Math.max(0, Math.min(1, u.hp / u.maxHp));
  const max = Math.max(2, u.ap || 0);
  const acting = b.phase === "player" && !u.dead && !u.left;
  const s = survivorOf(state, u);
  const icons = s && !u.dead && !u.left ? statusIcons(state, s, { skip: ["health"] }) : "";
  const chips = cardChips(state, b, u);
  const apLine = !acting ? `<span class="muted">${b.phase === "enemy" ? "Enemy turn" : b.phase === "deploy" ? "Deploying" : ""}</span>`
    : head ? `<span class="warn">${esc(head)}</span>` : `${pips(u.ap, max, true)}<b>${u.ap}</b><span class="muted"> action${u.ap === 1 ? "" : "s"} left</span>`;
  return `<div class="bb-card" data-tip="${esc(`${u.name}: ${Math.round(u.hp)} of ${u.maxHp} health. ${u.weaponName || ""}. Aim ${Math.round(u.aim || 0)}.`)}">
    <span class="bb-face">${sprite(state, b, u, salt, 2.6)}</span>
    <div class="bb-who"><div class="bb-name"><b>${esc(u.name)}</b>${n ? `<span class="bb-n">${n}</span>` : ""}</div>
      <div class="bb-hpline"><span class="bb-hp${u.bleeding > 0 || (u.down && !u.stab) ? " bleed" : ""}"><i style="width:${(f * 100).toFixed(0)}%;background:${hpCol(f)}"></i></span><span class="bb-hpn">${Math.round(u.hp)}<span class="muted">/${u.maxHp}</span></span></div>
      <div class="bb-apline">${apLine}</div>
      ${chips.length || icons ? `<div class="bh-chips bb-chips">${chips.map(([t, c, tip]) => `<span class="bh-chip ${c}" data-tip="${esc(tip)}">${esc(t)}</span>`).join("")}${icons}</div>` : ""}</div>${look ? `<div class="bb-look">${look}</div>` : ""}</div>`;
}
// A tab a person of yours: their face, number, actions left, health; click (or the number key) selects them.
function tabHtml(state, b, p, i, sel, salt) {
  const out = p.dead || p.left || p.fled;
  const ready = !out && !p.down && b.phase === "player" && p.ap > 0;
  const cls = ["bb-tab", p.id === sel ? "on" : "", out ? "out" : p.down ? "downed" : b.phase === "player" && !ready ? "done" : ""].filter(Boolean).join(" ");
  const f = Math.max(0, Math.min(1, p.hp / p.maxHp));
  const state1 = p.dead ? "dead" : p.left ? "got away" : p.down ? "down" : b.phase !== "player" ? "" : p.ap > 0 ? `${p.ap} action${p.ap === 1 ? "" : "s"} left` : "done this turn";
  const tip = `${p.name}${state1 ? `: ${state1}` : ""}. ${Math.round(p.hp)}/${p.maxHp} health. Click${i < 9 ? ` or press ${i + 1}` : ""} to select and center on them.`;
  return `<button class="${cls}" data-action="cb-sel" data-id="${p.id}" data-center="1" data-tip="${esc(tip)}">${sprite(state, b, p, salt, 1.35)}<span class="bb-tn">${i < 9 ? i + 1 : ""}</span>${!out && !p.down && b.phase === "player" ? pips(p.ap, Math.max(2, p.ap)) : ""}<i class="bb-thp" style="width:${(f * 100).toFixed(0)}%;background:${hpCol(f)}"></i></button>`;
}

// ---------- the bar ----------
// d: { state, b, u, team, orders (unitOrders' list), head, extra (its context panels), controls [{ act, v?, ic, label, ok, why?, on?, primary?, key, tip }],
//   ask (the question over the controls), all (show the orders that cannot be given too), tray (the open tray's group),
//   flat (the tools' screen: every order of the unit on the bar, no trays), cones, autoPlay, salt }
export function barHtml(d) {
  const { state, b, u, team, controls, ask, salt } = d;
  if (!b || b.over) return "";
  const sel = u && u.side === "player" && u.vol == null ? u : null;
  const n = sel ? team.indexOf(sel) + 1 : 0;
  // Middle: the orders (or what is going on instead).
  const acting = b.phase === "player" && !d.autoPlay && sel && !sel.dead && !sel.left && !sel.fled;
  const canAct = acting && !d.head && (!sel.down || sel.aboard);
  const { list, more } = barOrders(b, sel, acting ? d.orders : [], { cones: d.cones, canInv: !!(sel && sel.sid != null), acting: canAct });
  // Ready only (the default): the orders that can be given now (and those switched on). All: the greyed ones too, and
  // the key table's other orders. flat (the tools' screen): the bar as it was, every order of the unit on it.
  const all = d.flat || d.all;
  const canGive = (o) => o.ok || (o.on && o.v !== "move"); // switched on (sneaking, the light, a throw being aimed); Move is the default mode
  let shown = all ? list : list.filter(canGive);
  if (d.all && !d.flat && canAct) shown = [...list, ...more].sort((a, c) => { const [ga, ia] = rankOf(a.v), [gc, ic] = rankOf(c.v); return ga - gc || ia - ic; });
  const hidden = list.length + more.length - list.filter(canGive).length;
  let note = "";
  if (b.phase === "enemy") note = "Enemy turn: watch the map. Your turn comes next.";
  else if (b.phase === "deploy") note = b.drill ? "A drill: place your people (the panel), then Save as plan." : `Deploy: click one of your people, then a green cell. Start the fight in the panel (${keyLabel("battle.confirm", 1) || "Enter"}).`;
  else if (d.autoPlay) note = `The AI is playing your side (${keyLabel("battle.autoplay", 1) || "Shift+A"} or Take back control to play again).`;
  else if (!sel) note = "Select one of your people: click them, their tab, or press 1–9 or Tab.";
  else if (sel.dead || sel.left || sel.fled) note = `${first(sel)} is out of the fight: select someone else (Tab).`;
  else if (canAct && !shown.some((o) => rankOf(o.v)[0] !== VIEW)) note = `${first(sel)} has nothing to do now${sel.ap < 1 ? " (no actions left)" : ""}: select someone else (Tab) or end the turn.`;
  const layout = barLayout(shown.filter((o) => rankOf(o.v)[0] !== VIEW), { flat: d.flat });
  // Left: the selected one's card (Inventory and Cones in its corner: they look, they do nothing), everyone's tabs.
  const look = shown.filter((o) => rankOf(o.v)[0] === VIEW).map((o) => orderBtn(o, sel)).join("");
  const left = `<div class="bb-left">${cardHtml(state, b, sel, n > 0 && n <= 9 ? n : 0, salt, d.head, look)}<div class="bb-team">${team.map((p, i) => tabHtml(state, b, p, i, sel ? sel.id : null, salt)).join("")}</div></div>`;
  const open = d.flat ? null : d.tray;
  const allBtn = canAct && !d.flat && (hidden || d.all) ? `<i class="bb-sep"></i><button class="bb-btn bb-allbtn${d.all ? " active" : ""}" data-action="cb-bar" data-v="all" data-tip="${esc(d.all ? "Ready only: show just the orders that can be given now (all of them are shown now)." : `All orders: the ${hidden} that cannot be given now too, greyed, each saying why or when it applies.`)}" data-tip-pre><span class="bb-lbl">${d.all ? "Ready only" : "All"}</span><i class="bb-ic">${ICON.more}</i>${d.all ? "" : `<i class="bb-ap">+${hidden}</i>`}</button>` : "";
  const float = `${acting && d.extra ? `<div class="bb-extra">${d.extra}</div>` : ""}${trayHtml(layout, sel, open)}`;
  const mid = `<div class="bb-mid">${note ? `<div class="bb-note">${esc(note)}</div>` : ""}${float ? `<div class="bb-float${all ? "" : " ready"}">${float}</div>` : ""}<div class="bb-orders">${ordersHtml(layout, sel, open)}${allBtn}</div></div>`;
  // Right: the turn, the weapon, the turn controls (and their question above them).
  const phase = b.phase === "player" ? `<b class="good">Your turn</b>` : b.phase === "enemy" ? `<b class="danger">Enemy turn</b>` : `<b class="warn">Deploy</b>`;
  const ready = b.phase === "player" ? team.filter((p) => !p.dead && !p.left && !p.fled && !p.down && p.ap > 0).length : 0;
  const weapon = sel && !sel.dead ? weaponPanelHtml(state, b, sel) : "";
  const ctl = controls.map((c) => {
    const tip = `${c.label}${c.key ? ` (${c.key})` : ""}${!c.ok && c.why ? `\nNot now: ${c.why}` : ""}${c.tip ? `\n${c.tip}` : ""}`;
    return `<button class="${["bb-ctl", c.primary ? "primary bb-end" : "", c.on ? "active" : "", c.wide ? "wide" : ""].filter(Boolean).join(" ")}" data-action="${c.act}"${c.v ? ` data-v="${c.v}"` : ""} ${c.ok ? "" : "disabled"} data-tip="${esc(tip)}" data-tip-pre><i class="bb-ic">${c.ic}</i><span class="bb-cl">${esc(c.label)}</span>${c.key ? `<span class="key">${esc(shortKey(c.key))}</span>` : ""}</button>`;
  }).join("");
  const right = `<div class="bb-right">${ask ? `<div class="bb-ask">${ask}</div>` : ""}<div class="bb-turn"><span>Turn <b>${b.turn}</b></span>${phase}${b.phase === "player" ? `<span class="muted" data-tip="Your people with actions left this turn.">${ready}/${team.filter((p) => !p.dead && !p.left && !p.fled).length} ready</span>` : ""}</div>${weapon ? `<div class="bb-weapon">${weapon}</div>` : ""}<div class="bb-ctls">${ctl}</div></div>`;
  return `<div class="bb">${left}${mid}${right}</div>`;
}
