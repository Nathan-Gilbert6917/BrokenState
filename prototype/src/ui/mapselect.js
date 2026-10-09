// Selecting things on the State Map the way a tile is selected: your teams, other groups' parties (raids, caravans,
// convoys, scavengers), the hardcore bands on the road and the outsiders (raiders, merchants, travellers), and what
// the right panel shows for a selected base (yours: its buildings and the base screen's tabs; another group's: what
// you know of it, sim/intelest.js).
//
// - A click on a tile with something on it selects the first thing there (your teams first, then the groups' parties,
//   the bands, the outsiders); clicking the same tile again goes on to the next one and then the tile itself, round
//   and round. Shift+click always selects the tile. The "On this tile" row at the top of the right panel lists them
//   all (data-action "mapsel-pick").
// - ui.mapSel = { kind: "team" | "convoy" | "group" | "band" | "visitor", id, tile } (null: the tile itself). A team
//   opens its team panel (ui.expedition) as before; the others get a card here. A selected party is followed as it
//   moves while you can see it; out of sight the card says where it was last. Selecting another tile some other way
//   (Locate, the search box) drops it.
// - view.pick ("kind:id") tells the map which sprite to ring in gold (ui/render.js pickRing).
// Only what you could see: the same sight (state.live, by night as far as your people see) and radio coverage the
// map draws by.
import { partyTile, plannedTile, partyMembers, teamName, MISSIONS, tileLabel, cargoLoad, partyCapacity } from "../sim/parties.js";
import { contactable } from "../sim/orders.js";
import { baseIntel, partyIntel, rangeText } from "../sim/intelest.js";
import { hcMapBands, bandTipLines } from "../sim/hardcore-groups.js";
import { visitorTipLines, visitorById } from "../sim/visitors.js";
import { roadCaravans, guardText, cargoText } from "../sim/caravanraids.js";
import { inCoverage } from "../sim/radio.js";
import { canRadio } from "../sim/trade.js";
import { BUILDINGS, tierName } from "../sim/buildings.js";
import { atBase, factionById, baseById } from "../sim/world.js";
import { SUPPLIES } from "../sim/data.js";
import { partyVehicle } from "../sim/vehicles.js";
import { liveSet, view, redrawMap } from "./render.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const attColor = (a) => ({ Hostile: "var(--danger)", Neutral: "var(--muted)", Friendly: "var(--good)", Allied: "var(--accent)" }[a] || "var(--muted)");
const swatch = (c) => `<span class="swatch" style="background:${esc(c)}"></span>`;
const PICK_TIP = "Click the tile again for the next thing on it, then the tile itself. Shift+click picks the tile.";

// ---------- what is on a tile ----------
// Where one of your teams shows on the map: where it is (in contact, waiting, working, a convoy), else where it
// should be by its plan (ui/render.js drawPlayerParty).
export function teamTileOf(state, p) {
  if (p.radioLive || p.kind === "convoy" || p.phase === "waiting" || p.phase === "task") return partyTile(p);
  const plan = p.planPath || p.path;
  if (!plan || !plan.length) return partyTile(p);
  if (p.etaOut != null) return plannedTile(state, p);
  const elapsed = state.hour - p.departed, half = (p.plannedHours || 0) / 2;
  const frac = half <= 0 ? 0 : elapsed < half ? elapsed / half : Math.max(0, 1 - (elapsed - half) / half);
  return plan[Math.min(plan.length - 1, Math.round(frac * (plan.length - 1)))];
}
const shortKind = { raid: "war party", caravan: "caravan", convoy: "convoy", scav: "scavengers", salvage: "salvage crew" };
// Everything you can pick on a tile, in click order: [{ kind, id, label }].
export function picksAt(state, tile, live = liveSet(state)) {
  const out = [];
  if (tile == null || tile < 0) return out;
  for (const p of state.parties) {
    if (p.owner !== "player" || teamTileOf(state, p) !== tile) continue;
    out.push({ kind: p.kind === "convoy" ? "convoy" : "team", id: p.id, label: p.kind === "convoy" ? "Your convoy" : `Your team (${partyMembers(state, p).length})` });
  }
  if (live.has(tile)) for (const p of state.parties) {
    if (p.owner === "player" || partyTile(p) !== tile) continue;
    const f = typeof p.owner === "number" ? factionById(state, p.owner) : null;
    out.push({ kind: "group", id: p.id, label: `${f && f.known ? f.name.replace(/^The /, "") : "Unknown"} ${shortKind[p.kind] || "party"}` });
  }
  if (live.has(tile)) for (const b of hcMapBands(state)) if (b.tile === tile) out.push({ kind: "band", id: b.id, label: b.strike ? "Military strike force" : b.known ? b.name : "A band on the road" });
  for (const v of state.visitors || []) if (v.tile === tile && (live.has(tile) || inCoverage(state, tile))) out.push({ kind: "visitor", id: v.id, label: v.name ? v.name.replace(/^./, (c) => c.toUpperCase()) : "Outsiders" });
  return out;
}
const same = (a, b) => !!a && !!b && a.kind === b.kind && String(a.id) === String(b.id);
const pickKey = (p) => (p ? `${p.kind}:${p.id}` : null);

// Select a thing (or the tile, pick null) on a tile.
export function applyPick(state, ui, tile, pick) {
  ui.selected = tile;
  ui.mapSel = pick ? { kind: pick.kind, id: pick.id, tile } : null;
  ui.expedition = pick && pick.kind === "team" ? Number(pick.id) : null;
  ui.xpMsg = "";
  view.selected = tile;
  syncPick(state, ui);
}
// A left click on a tile (main.js). tileOnly: Shift was held. Returns what was picked (null: the tile).
export function clickPick(state, ui, tile, tileOnly = false) {
  const picks = tileOnly ? [] : picksAt(state, tile);
  let next = null;
  if (picks.length) {
    const cur = ui.selected === tile ? (ui.expedition != null ? { kind: "team", id: ui.expedition } : ui.mapSel && ui.mapSel.tile === tile ? ui.mapSel : "tile") : null;
    if (!cur) next = picks[0]; // a new tile: the first thing on it
    else {
      const order = [...picks, null]; // then the tile itself, and round again
      const i = cur === "tile" ? order.length - 1 : order.findIndex((x) => same(x, cur));
      next = order[(i + 1) % order.length];
    }
  }
  applyPick(state, ui, tile, next);
  return next;
}
// The "On this tile" row's chips (data-action mapsel-pick).
export function pickAction(state, ui, d) {
  const tile = Number(d.tile);
  if (!Number.isFinite(tile) || tile < 0) return;
  if (!d.kind || d.kind === "tile") return applyPick(state, ui, tile, null);
  const pick = picksAt(state, tile).find((x) => x.kind === d.kind && String(x.id) === String(d.id));
  applyPick(state, ui, tile, pick || null);
}

// The entity behind a selection, where you can see it now (null: gone or out of sight).
function locate(state, sel, live) {
  if (!sel) return null;
  if (sel.kind === "group" || sel.kind === "convoy" || sel.kind === "team") {
    const p = state.parties.find((q) => q.id === Number(sel.id));
    if (!p) return null;
    if (sel.kind === "group") return live.has(partyTile(p)) ? { tile: partyTile(p), ref: p } : null;
    return { tile: teamTileOf(state, p), ref: p };
  }
  if (sel.kind === "band") {
    const b = hcMapBands(state).find((x) => String(x.id) === String(sel.id));
    return b && live.has(b.tile) ? { tile: b.tile, ref: b } : null;
  }
  if (sel.kind === "visitor") {
    const v = visitorById(state, sel.id);
    return v && (live.has(v.tile) || inCoverage(state, v.tile)) ? { tile: v.tile, ref: v } : null;
  }
  return null;
}
// Before each refresh (main.js): drop a selection whose tile was left by other means, follow a party that moved,
// and tell the map which sprite to ring.
export function syncPick(state, ui) {
  const sel = ui.mapSel;
  if (sel && sel.kind === "team") { if (ui.expedition !== Number(sel.id)) ui.mapSel = null; }
  else if (sel) {
    if (ui.selected !== sel.tile) ui.mapSel = null;
    else {
      const at = locate(state, sel, liveSet(state));
      if (at && at.tile !== sel.tile) { sel.tile = at.tile; ui.selected = at.tile; view.selected = at.tile; }
      sel.gone = !at;
    }
  }
  const key = ui.expedition != null ? `team:${ui.expedition}` : pickKey(ui.mapSel);
  if (view.pick !== key) { view.pick = key; redrawMap(); }
}

// ---------- the right panel ----------
// "On this tile: [the tile] [Your team (3)] [Raiders' war party]…" when there is more than the tile to pick.
export function pickBar(state, ui) {
  const tile = ui.selected;
  if (tile == null || tile < 0) return "";
  const picks = picksAt(state, tile);
  if (!picks.length) return "";
  const cur = ui.expedition != null ? { kind: "team", id: ui.expedition } : ui.mapSel;
  const chip = (kind, id, label, on) => `<button class="mini${on ? " active" : ""}" data-action="mapsel-pick" data-tile="${tile}" data-kind="${kind}" data-id="${esc(id)}"${tip(PICK_TIP)}>${esc(label)}</button>`;
  return `<div class="row small mapsel-bar" style="flex-wrap:wrap;gap:0.25rem;margin-bottom:0.4rem"><span class="muted">On this tile:</span>${chip("tile", "", "The tile", !cur)}${picks.map((p) => chip(p.kind, p.id, p.label, same(p, cur))).join("")}</div>`;
}

// The card for a selected party, band or outsider (null: the selection is the tile or a team).
export function pickCard(state, ui) {
  const sel = ui.mapSel;
  if (!sel || sel.kind === "team" || ui.selected !== sel.tile) return null;
  const live = liveSet(state);
  const at = locate(state, sel, live);
  const bar = pickBar(state, ui);
  const back = `<button class="mini" data-action="mapsel-pick" data-tile="${sel.tile}" data-kind="tile"${tip("Show the tile instead")}>Tile info</button>`;
  if (!at) return `${bar}<h2>Out of sight</h2><div class="card small">What you selected is no longer in view. Last seen at ${esc(tileLabel(state, sel.tile))}.<div class="row" style="margin-top:0.35rem">${back}</div></div>`;
  if (sel.kind === "group") return bar + groupPartyCard(state, at.ref, live, back);
  if (sel.kind === "convoy") return bar + convoyCard(state, at.ref, back);
  if (sel.kind === "band") return bar + linesCard(state, at.ref.strike ? "Military strike force" : "A band on the road", bandTipLines(state, at.tile, live).map((o) => o.text), at.tile, back, at.ref.color);
  if (sel.kind === "visitor") return bar + linesCard(state, "Outsiders", visitorTipLines(state, at.tile, live).map((o) => o.text), at.tile, back, null, !live.has(at.tile));
  return null;
}

function groupPartyCard(state, p, live, back) {
  const o = partyIntel(state, p, live);
  if (!o) return "";
  const f = o.fid != null ? factionById(state, o.fid) : null;
  const c = roadCaravans(state).find((x) => x.ref === p) || null; // a caravan or convoy: guards and cargo as the tooltip says
  const size = `about ${rangeText(o.size)} ${o.size && o.size.hi === 1 ? "person" : "people"}${o.night ? ` <span class="muted"${tip("Hard to count in the dark: the range is wider at night")}>(at night)</span>` : ""}`;
  const heading = o.siege ? "Camped at the walls (a siege)" : o.heading ? `Moving ${o.heading}` : "Standing";
  const btns = [
    `<button class="mini" data-action="center" data-tile="${o.tile}"${tip("Center the map here")}>Locate</button>`,
    f && f.known && f.alive && f.bases.length ? `<button class="mini" data-action="center" data-tile="${f.bases[0]}"${tip("Center the map on their main base")}>Their base</button>` : "",
    f && f.known && f.alive && canRadio(state, f) ? `<button class="mini" data-action="rd-open" data-id="${f.id}"${tip("Radio panel: greet, ask for news, deals, pacts")}>Radio…</button>` : "",
    back,
  ].join("");
  return `<h2>${swatch(o.color)}${esc(o.kindLabel)}</h2>
    <div class="small muted">${esc(o.name)}${o.attitude ? ` · <span style="color:${attColor(o.attitude)}">${esc(o.attitude)}</span>` : ""} · ${esc(o.where)}</div>
    <div class="card" style="margin-top:0.5rem"><div class="kv small">
      <div${tip("What your lookouts or your team can make out from a distance: a range, never a head count")}>Size</div><div>${size}</div>
      ${o.vehicle ? `<div>Vehicle</div><div>${esc(o.vehicle)}</div>` : ""}
      ${c ? `<div>Guards</div><div>${esc(guardText(state, c))}</div><div>Carrying</div><div>${esc(cargoText(c))}</div>` : ""}
      <div>Heading</div><div>${esc(heading)}</div>
      <div${tip("Where it is going: only if you heard it on their radio channel (Listen in) or your lookouts called the raid")}>Going to</div><div>${o.dest ? esc(o.dest) : `<span class="muted">unknown</span>`}</div>
    </div>
    <div class="row" style="margin-top:0.4rem;flex-wrap:wrap">${btns}</div></div>
    ${p.kind === "caravan" || p.kind === "convoy" ? `<div class="small muted">A team within a tile can attack it, or intercept it from up to a few tiles: the team's orders.</div>` : ""}`;
}

function convoyCard(state, p, back) {
  const members = partyMembers(state, p);
  const v = partyVehicle(state, p);
  const goods = Object.entries((p.cargo && p.cargo.supplies) || {}).filter(([, q]) => q >= 1).map(([k, q]) => `${Math.floor(q)} ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`).join(", ");
  const dest = p.path && p.path.length ? p.path[p.path.length - 1] : partyTile(p);
  return `<h2>Your convoy</h2>
    <div class="small muted">${esc(teamName(state, p))} · ${esc(tileLabel(state, partyTile(p)))}</div>
    <div class="card" style="margin-top:0.5rem"><div class="kv small">
      <div>Crew</div><div>${members.map((s) => esc(s.name.split(" ")[0])).join(", ") || "none"}</div>
      <div>Vehicle</div><div>${v ? esc(v.name) : "on foot"}</div>
      <div>Bound for</div><div>${esc(tileLabel(state, dest))}${p.phase === "back" ? " (heading home)" : ""}</div>
      <div>Load</div><div>${Math.round(cargoLoad(p.cargo))}/${Math.round(partyCapacity(state, p))} kg${goods ? ` · ${esc(goods)}` : ""}</div>
    </div>
    <div class="row" style="margin-top:0.4rem;flex-wrap:wrap"><button class="mini" data-action="center" data-tile="${partyTile(p)}">Locate</button>${p.supplyJobId != null && baseById(state, p.homeBaseId) ? `<button class="mini" data-action="openbase" data-id="${p.homeBaseId}" data-tab="convoys">Supply runs…</button>` : ""}${back}</div></div>`;
}

function linesCard(state, title, lines, tile, back, color = null, heard = false) {
  return `<h2>${color ? swatch(color) : ""}${esc(title)}</h2>
    <div class="small muted">${esc(tileLabel(state, tile))}${heard ? ` · <span${tip("In your radio coverage: heard of, not seen")}>heard on the radio</span>` : ""}</div>
    <div class="card small" style="margin-top:0.5rem">${lines.length ? lines.map((l) => `<div>${esc(l)}</div>`).join("") : `<span class="muted">Nothing more to make out from here.</span>`}
    <div class="row" style="margin-top:0.4rem"><button class="mini" data-action="center" data-tile="${tile}">Locate</button>${back}</div></div>`;
}

// ---------- bases ----------
// Your base on the selected tile: its buildings at a glance and the base screen's tabs (the base screen, ui.js
// baseModal).
const OWN_TABS = [["overview", "Overview", "Stock, people and roles"], ["buildings", "Buildings", "What is built here and what it gives"], ["construction", "Build", "The build queue and what you can build"], ["defence", "Defence", "The watch roster and the defence plan"], ["armory", "Armory", "Stored gear and everyone's equipment"], ["vehicles", "Vehicles", "Fuel, condition, repairs"]];
export function ownBaseCard(state, b) {
  if (!b) return "";
  const counts = new Map();
  let broken = 0;
  for (const x of b.buildings || []) {
    const name = (BUILDINGS[x.type] && BUILDINGS[x.type].name) || x.type;
    counts.set(name, (counts.get(name) || 0) + 1);
    if (x.broken) broken++;
  }
  const list = [...counts.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0])).map(([n, q]) => (q > 1 ? `${esc(n)} ×${q}` : esc(n))).join(", ");
  const building = (b.construction || []).map((c) => (BUILDINGS[c.type] && BUILDINGS[c.type].name) || c.type);
  return `<div class="card small mapsel-base">
    <div class="spread"><b>Buildings</b><span class="muted">${esc(tierName(b))} · ${atBase(state, b.id).length} people</span></div>
    <div>${list || `<span class="muted">Nothing built yet.</span>`}${broken ? ` <span class="warn"${tip("Broken buildings: the Repairs tab")}>· ${broken} broken</span>` : ""}</div>
    ${building.length ? `<div class="muted">Building: ${esc(building.slice(0, 3).join(", "))}${building.length > 3 ? ` +${building.length - 3}` : ""}</div>` : ""}
    <div class="row" style="margin-top:0.35rem;flex-wrap:wrap;gap:0.25rem">${OWN_TABS.map(([k, l, t]) => `<button class="mini" data-action="openbase" data-id="${b.id}" data-tab="${k}"${tip(t)}>${l}</button>`).join("")}</div>
  </div>`;
}

// Another group's base on the selected tile, as far as you know (sim/intelest.js baseIntel). f: the group your map
// says holds it (ui.js knownGroupBase); null: nothing to show.
const SRC_WORD = { sight: "seen from outside", survey: "a close look", visit: "a trade visit", ally: "allies' word", captive: "a prisoner", radio: "their channel" };
export function groupBaseCard(state, tile, f) {
  if (!f) return "";
  const o = baseIntel(state, tile, liveSet(state), f);
  if (!o) return "";
  const unk = `<span class="muted">unknown</span>`;
  const seen = o.lastSeen ? `last looked ${o.lastSeen.ago ? `${o.lastSeen.ago} day${o.lastSeen.ago === 1 ? "" : "s"} ago` : "today"} (${SRC_WORD[o.lastSeen.src]})` : o.located ? `located day ${o.located}, never looked at closely` : "never looked at";
  const srcs = [...new Set(o.sources.map((s) => SRC_WORD[s.src]))].join(", ");
  const confTip = "How sure these estimates are: the best look you have (allies' word, a trade visit, a close look, seen from outside), rougher the older it is. Ranges hold what was there when your people looked.";
  const walls = o.walls ? `${o.walls.lo === o.walls.hi ? o.walls.lo : `${o.walls.lo}–${o.walls.hi}`} of ${o.walls.goal}` : unk;
  const stores = o.stores ? o.stores.map((s) => `${s.key} ${s.word}`).join(", ") : "";
  const heard = o.heard ? [o.heard.short.length ? `short of ${o.heard.short.join(" and ")}` : "", o.heard.plenty.length ? `plenty of ${o.heard.plenty.join(" and ")}` : ""].filter(Boolean).join("; ") : "";
  return `<div class="card small mapsel-intel">
    <div class="spread"><b>${swatch(o.color)}${esc(o.known ? `${o.name}'s base` : "A group's base")}</b>${o.attitude ? `<span style="color:${attColor(o.attitude)}">${esc(o.attitude)}${o.ally ? " · shares news" : ""}</span>` : ""}</div>
    <div class="muted"${tip(confTip)}>Intel: <b>${esc(o.confidence)}</b> · ${esc(seen)}${srcs ? ` · from ${esc(srcs)}` : ""}</div>
    <div class="kv" style="margin-top:0.3rem">
      <div${tip("People living at this base (a group's main base holds twice a share)")}>People here</div><div>${o.pop ? `about ${rangeText(o.pop)}` : unk}</div>
      <div>Whole group</div><div>${o.gpop ? `about ${rangeText(o.gpop)}` : unk}</div>
      <div${tip("Wall points built against what this kind of group wants at this base")}>Walls</div><div>${walls}</div>
      <div${tip("Wells and fields show from outside; quarters, a workshop and a storehouse from close by (a survey); a jail only from inside")}>Buildings seen</div><div>${o.works ? (o.works.length ? esc(o.works.map((w) => w.text).join(", ")) : "none seen") : unk}</div>
      <div${tip("Working vehicles parked at their main base")}>Vehicles</div><div>${o.cars ? rangeText(o.cars) : unk}</div>
      <div${tip("Their guns and armour: exact when friends tell you or you fought them lately, a rough band after a close look")}>Arms</div><div>${o.arms ? esc(o.arms.text) : unk}</div>
      <div${tip("Food, ammo, meds and fuel a head: seen inside their gates, told by a prisoner, or heard on their channel")}>Stores</div><div>${stores ? `${esc(stores)} <span class="muted">(${esc(SRC_WORD[o.storesFrom])})</span>` : heard ? "" : unk}${heard ? `${stores ? "<br>" : ""}${esc(heard)} <span class="muted">(their channel, day ${o.heard.day})</span>` : ""}</div>
      ${o.force ? `<div${tip("A war party of theirs, heard on their channel")}>War party</div><div>strength about ${o.force.strength} (day ${o.force.day})</div>` : ""}
    </div>
    ${o.tips.map((t) => `<div class="muted" style="margin-top:0.25rem">${esc(t)}</div>`).join("")}
    ${o.known && canRadio(state, factionById(state, o.fid)) ? `<div class="row" style="margin-top:0.35rem"><button class="mini" data-action="rd-open" data-id="${o.fid}"${tip("Radio panel: greet, ask for news, deals, pacts")}>Radio…</button></div>` : ""}
  </div>`;
}

export const MAPSEL_ACTIONS = { "mapsel-pick": pickAction };
