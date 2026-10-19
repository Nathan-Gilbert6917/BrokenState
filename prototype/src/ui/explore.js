// Base-panel pieces for exploration and upkeep (sim/blueprints.js, sim/locks.js, sim/breakdowns.js): the Repairs
// tab, the known blueprints card (Buildings tab), the key ring (Armory tab) and the "Needs: …" lines on locked
// buildings and recipes. Handlers in EXPLORE_ACTIONS (main.js registers them).
import { SKILL_NAMES } from "../sim/data.js";
import { BUILDINGS, pieceName } from "../sim/buildings.js"; // the wall's pieces fold into one row of the wear table
import { WALL_REPAIR, wallRepairPlan, orderWallRepair, cancelWallRepair, reassignWallRepair, wallSegHours } from "../sim/breakdowns.js"; // the wall's repair order
import { baseById, day, atBase, skill, survivorById } from "../sim/world.js";
import { tileLabel } from "../sim/parties.js";
import { blueprintRows, lockNote, craftBookRows, cookBookRows } from "../sim/blueprints.js";
import { keyRing } from "../sim/locks.js";
import { repairRows, repairPlan, startRepair, cancelRepair, reassignRepair, fixtureById, costText, fxDef, WEAR, RAID_DAMAGE, repairBill, startAllRepairs, brokenAt, jobFor } from "../sim/breakdowns.js";
import { vehiclesAtBase, canRepair, carPartsCost, carPartsText } from "../sim/vehicles.js";
import { activeCrashes, CRASH_KINDS, daysLeft } from "../sim/crashes.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const firstName = (s) => esc(String(s.name).split(" ")[0]);

// ---------- "Needs: …" on locked buildings and recipes ----------
export function lockLine(state, base, kind, key) {
  const note = lockNote(state, base, kind, key);
  return note ? `<div class="small warn"${tip("Locked until the matching manual or blueprint is found and studied at a base (Read role, the blueprint's skill), or the craft book is read to the end by anyone at a base. See the Buildings tab's Blueprints list.")}>🔒 ${esc(note)}</div>` : "";
}

// ---------- Blueprints (Buildings tab) ----------
export function blueprintsCard(state, base) {
  const rows = blueprintRows(state);
  const known = rows.filter((r) => r.known).length;
  return `<h3${tip("Manuals and blueprints unlock the upper tiers. Found on the shelves of fitting sites, in locked safes and cases, at crash sites and from traders; studied at a base by someone on the Read role with the skill (blueprints come before books).")}>Blueprints (${known} of ${rows.length} known)</h3>
  <table class="t small">${rows.map((r) => {
    const status = r.known ? `<span class="chip on">Known</span>` :
      r.hours > 0 ? `<span class="chip">Studying ${Math.floor(r.hours)}/${r.d.hours}h${r.who.length ? ` (${r.who.map(firstName).join(", ")})` : ""}</span>` :
      r.held ? `<span class="chip"${tip(`A copy is in your hands. Put someone with ${SKILL_NAMES[r.d.skill]} ${r.d.min}+ on the Read role at the base that holds it.`)}>Copy held: needs ${SKILL_NAMES[r.d.skill]} ${r.d.min}+ reader</span>` :
      `<span class="muted"${tip(`Look in: ${r.where}.`)}>Not found</span>`;
    return `<tr${tip(`${r.d.desc} ${r.d.hours}h of study, ${SKILL_NAMES[r.d.skill]} ${r.d.min}+. Look in: ${r.where}.`)}><td><b>${esc(r.d.name)}</b><br><span class="muted">unlocks ${esc(r.opens.join(", "))}</span></td><td>${status}</td></tr>`;
  }).join("")}</table>${craftBooksCard(state)}`;
}
// Craft books (blueprints.js CRAFT_BOOKS): read to the end by anyone at a base, they unlock recipes and the crafting edge.
function craftBooksCard(state) {
  const rows = craftBookRows(state);
  return `<h3${tip("Some books teach crafting too: once anyone has read one to the end at a base (Read role), its recipes are unlocked for good and the recipes it covers come out better and faster.")}>Craft books (${rows.filter((r) => r.known).length} of ${rows.length} read)</h3>
  <table class="t small">${rows.map((r) => {
    const status = r.known ? `<span class="chip on">Read</span>` : r.held ? `<span class="chip">Copy held</span>` : `<span class="muted"${tip(`Look in: ${r.where}.`)}>Not found</span>`;
    const what = [r.opens.length ? `unlocks ${r.opens.join(", ")}` : "", `better at ${r.covers.join(", ")}`].filter(Boolean).join("; ");
    return `<tr${tip(`${r.desc} Look in: ${r.where}.`)}><td><b>${esc(r.name)}</b><br><span class="muted">${esc(what)}</span></td><td>${status}</td></tr>`;
  }).join("")}</table>${cookBooksCard(state)}`;
}
// Cookbooks (wave 2 cooking, blueprints.js CRAFT_BOOKS cook): read to the end, the cooks make their meals below the usual Cooking.
function cookBooksCard(state) {
  const rows = cookBookRows(state);
  if (!rows.length) return "";
  return `<h3${tip("Cookbooks teach Cooking, and once anyone has read one to the end at a base (Read role) the cooks may make its meals below the usual Cooking level (a little more food poisoning when they do), and those meals go faster. Help: Cooking and meals.")}>Cookbooks (${rows.filter((r) => r.known).length} of ${rows.length} read)</h3>
  <table class="t small">${rows.map((r) => {
    const status = r.known ? `<span class="chip on">Read</span>` : r.held ? `<span class="chip">Copy held</span>` : `<span class="muted"${tip(`Look in: ${r.where}.`)}>Not found</span>`;
    return `<tr${tip(`${r.desc} Look in: ${r.where}.`)}><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.what)}</span></td><td>${status}</td></tr>`;
  }).join("")}</table>`;
}

// ---------- Key ring (Armory tab) ----------
export function keyRingCard(state) {
  const keys = keyRing(state);
  return `<h3${tip("Keys found in raids (on bodies, in drawers and locked things) and searches. Each opens every lock at its site: a locked room's doors, gun cages, safes. They are not cargo: they hang on the hub's key ring.")}>Key ring (${keys.length})</h3>
  <div class="small">${keys.length ? keys.map((k) => `<div class="spread"><span>🔑 ${esc(k.name)} <span class="muted">· day ${k.day}${k.how ? ` · ${esc(k.how)}` : ""}</span></span><button class="mini" data-action="center" data-tile="${k.tile}"${tip(`Show ${tileLabel(state, k.tile)} on the map`)}>Map</button></div>`).join("") : `<span class="muted">No keys yet. They turn up on bodies and in drawers, lockers and safes.</span>`}</div>`;
}

// ---------- Repairs tab ----------
// The wall (sim/breakdowns.js WALL_REPAIR, the user's request 2026-10-19): its pieces are mended by one order, a
// builder working through every damaged segment at so many hours a segment. What wants mending, who has the order,
// the segment under way; give the order (or change who has it), call it off.
function wallRepairCard(state, base, people) {
  const o = base.wallRepair, plan = wallRepairPlan(state, base);
  if (!o && !plan.list.length) return "";
  const who = o && o.who != null ? survivorById(state, o.who) : null;
  const cur = o && o.cur != null ? base.buildings.find((b) => b.id === o.cur) : null;
  const pick = `<select data-action="rw-who" data-base="${base.id}"${tip(o ? "Who has the order" : "Give the order to someone (the builders are listed first)")}><option value="">${o ? (who ? "Change who…" : "Pick someone…") : "Give it to…"}</option>${people.filter((s) => !s.inBed).sort((a, b) => (b.role === "build") - (a.role === "build") || skill(b, "mechanics") - skill(a, "mechanics")).map((s) => `<option value="${s.id}">${esc(s.name)} (${s.role === "build" ? "builder, " : ""}Mechanics ${skill(s, "mechanics")})</option>`).join("")}</select>`;
  const each = WALL_REPAIR.HOURS.slice(1).map((h, i) => `${["wood", "logs", "scrap metal", "metal sheets"][i]} ${h}h`).join(", ");
  return `<div class="card small"${tip(`The wall is mended by an order, not a repair each: one person works through every broken or worn piece (wear ${WALL_REPAIR.FROM}+), broken first, 08:00–20:00. A 1×4 section takes ${each} (a 1×2 half, a 1×1 a quarter, a gate half again), faster with Mechanics; each segment's materials (half its build cost) are paid as it is started.`)}>
    <div class="spread"><b>🧱 The wall</b><span class="muted">${plan.list.length} segment${plan.list.length === 1 ? "" : "s"} to mend${plan.broken ? ` · <span class="danger">${plan.broken} broken</span>` : ""}</span></div>
    ${o ? `<div style="margin-top:0.25rem">Repairing: ${who ? firstName(who) : `<span class="warn">nobody (pick someone)</span>`}${cur ? ` · ${esc(pieceName(cur))} ${Math.floor(o.done * 10) / 10}/${wallSegHours(cur)}h` : ""} · ${o.mended} mended${o.stalled ? ` · <span class="danger">${esc(o.stalled)}</span>` : ""}</div>
      <div class="row" style="margin-top:0.2rem">${pick}<button class="mini" data-action="rw-cancel" data-base="${base.id}"${tip("Call the order off; the materials for the segment under way go back")}>Cancel</button></div>`
    : `<div style="margin-top:0.25rem">About ${plan.hours} work-hours${plan.who ? ` for ${firstName(plan.who)}` : ""}, ${esc(costText(plan.cost)) || "no materials"} as they go.</div>
      <div class="row" style="margin-top:0.2rem"><button class="mini primary" data-action="rw-order" data-base="${base.id}" ${plan.ok ? "" : "disabled"}${tip(plan.ok ? `${firstName(plan.who)} works through the wall's damaged segments` : plan.why)}>Repair the wall</button>${pick}</div>`}
  </div>`;
}
const RAID_OUTCOME = { held: "driven off", won: "beaten in person", broken: "a break-in", overrun: "overrun" };
export function repairsTab(state, base) {
  const rows = repairRows(state, base);
  const isWallPiece = (r) => !!(BUILDINGS[r.fx.type] && BUILDINGS[r.fx.type].piece);
  const broken = rows.filter((r) => r.fx.broken && !isWallPiece(r)); // the wall's pieces: the wall's own card (its repair order)
  const people = atBase(state, base.id);
  const btn = (r, method) => {
    const plan = repairPlan(state, base, r.fx, method);
    const label = method === "rig" ? "Jury-rig" : "Repair";
    return `<button class="mini" data-action="rp-start" data-base="${base.id}" data-fx="${r.fx.id}" data-m="${method}" ${plan.ok ? "" : "disabled"}${tip(plan.ok ? `${firstName(plan.who)} (Mechanics ${skill(plan.who, "mechanics")}) works on it ${plan.hours} work-hours (08:00–20:00) for ${costText(plan.cost)}.${method === "rig" ? ` Cheap, but it wears ${Math.round((WEAR.rigMult - 1) * 100)}% faster and breaks again sooner.` : ` Wear back to ${WEAR.repairWear}.`}` : plan.why)}>${label}${plan.who ? `: ${firstName(plan.who)}, ${plan.hours}h, ${esc(costText(plan.cost))}` : ` (${esc(costText(plan.cost))})`}</button>`;
  };
  const brokenHtml = broken.length ? broken.map((r) => {
    const j = r.job;
    const who = j && j.who != null ? survivorById(state, j.who) : null;
    const able = people.filter((s) => skill(s, "mechanics") >= (fxDef(r.fx)[j ? j.method : "repair"] || {}).min);
    return `<div class="card small">
      <div class="spread"><b>⚠ ${esc(r.name)}</b><span class="muted">broken since day ${r.fx.broken.day} (${esc(r.fx.broken.cause)})</span></div>
      <div class="danger">${esc(r.def.what[0].toUpperCase() + r.def.what.slice(1))}.</div>
      ${j ? `<div style="margin-top:0.25rem">${j.method === "rig" ? "Jury-rigging" : "Repairing"}: ${who ? firstName(who) : "<span class=\"warn\">nobody (pick someone)</span>"} · ${Math.floor(j.done)}/${j.hours} work-hours</div>${bar((j.done / j.hours) * 100, "var(--accent)")}
        <div class="row" style="margin-top:0.2rem"><select data-action="rp-who" data-base="${base.id}" data-fx="${r.fx.id}"${tip("Who works on it")}><option value="">${who ? "Change who…" : "Pick someone…"}</option>${able.map((s) => `<option value="${s.id}">${esc(s.name)} (Mechanics ${skill(s, "mechanics")})</option>`).join("")}</select>
        <button class="mini" data-action="rp-cancel" data-base="${base.id}" data-fx="${r.fx.id}"${tip("Stop the job; the materials go back to the stock")}>Cancel</button></div>` :
        `<div class="row" style="margin-top:0.25rem;flex-wrap:wrap;gap:0.3rem">${btn(r, "repair")}${btn(r, "rig")}</div>`}
    </div>`;
  }).join("") : `<div class="muted small">Nothing is broken at ${esc(base.name)}.</div>`;
  // The bill for everything broken that nobody works on yet, and the last raid's damage (breakdowns.js raidDamage).
  const open = brokenAt(base).filter((fx) => !jobFor(base, fx) && !(BUILDINGS[fx.type] && BUILDINGS[fx.type].piece));
  const bill = repairBill(open);
  const allHtml = open.length > 1 ? `<div class="row" style="margin:0.3rem 0"><button class="mini" data-action="rp-all" data-base="${base.id}"${tip(`Every broken building here gets a repairer: a proper repair where it can be paid and someone fit is free, else a jury-rig. Proper repairs of all ${open.length}: ${costText(bill.cost)}, about ${bill.hours} work-hours.`)}>Repair all (${esc(costText(bill.cost))})</button></div>` : "";
  const lr = base.lastRaid;
  const how = lr ? RAID_OUTCOME[lr.outcome] || lr.outcome : "";
  const raidHtml = lr ? `<div class="card small"${tip("What the last raid on this base smashed: the longer the siege and the worse it went, the more. Broken buildings do nothing until repaired; damaged ones (wear 60+) may give way any day, and damaged walls give 2 wall strength instead of 3.")}>
      <div class="spread"><b>Last raid: day ${lr.day}</b><span class="muted">${esc(lr.by)} · ${esc(how)} · ${lr.hours}h at the walls</span></div>
      <div class="${lr.broken.length || lr.destroyed ? "danger" : "muted"}">${esc(lr.text)}</div></div>` : "";
  const patch = (r) => {
    const plan = repairPlan(state, base, r.fx, "repair");
    return `<button class="mini" data-action="rp-start" data-base="${base.id}" data-fx="${r.fx.id}" data-m="repair" ${plan.ok ? "" : "disabled"}${tip(plan.ok ? `Patch it up before it gives way: ${firstName(plan.who)}, ${plan.hours} work-hours, ${costText(plan.cost)}. Wear back to ${WEAR.repairWear}.` : plan.why)}>Patch</button>`;
  };
  // The wall's pieces (sim/buildings.js piece): one row for the sound ones, a row each only for the worn, broken or mended.
  const soundWall = rows.filter((r) => isWallPiece(r) && !r.fx.broken && !r.job && !r.fx.rigged && r.wear < WEAR.riskFrom);
  const wallRow = soundWall.length ? (() => { const avg = Math.round(soundWall.reduce((a, r) => a + r.wear, 0) / soundWall.length); return `<tr${tip("The wall's pieces, gates and stands that are sound: each wears on its own (horde attacks, raids, age) and shows on a row of its own once it is worn, broken or being mended.")}><td>Wall: ${soundWall.length} piece${soundWall.length === 1 ? "" : "s"} in good order</td><td style="width:40%">${bar(avg, "var(--good)")}</td><td>${avg}%</td><td class="muted">OK (average)</td></tr>`; })() : "";
  const wearRows = wallRow + rows.filter((r) => !soundWall.includes(r)).map((r) => {
    const w = r.wear;
    const color = r.fx.broken ? "var(--danger)" : w >= WEAR.riskFrom ? "var(--warn, #e0a84f)" : "var(--good)";
    const state2 = r.fx.broken ? "Broken" : r.job ? "Being patched" : r.fx.rigged ? "Jury-rigged" : w >= RAID_DAMAGE.damaged && r.def.raidOnly ? "Damaged: may break" : w >= WEAR.riskFrom ? "Worn: may break" : "OK";
    const btn = !r.fx.broken && !r.job && w >= RAID_DAMAGE.damaged && !isWallPiece(r) ? ` ${patch(r)}` : "";
    return `<tr${tip(`${r.name}: ${r.def.what} when it breaks. ${r.def.raidOnly ? "It only wears from raid damage." : "Wear builds with use, age and weather."} At ${WEAR.riskFrom}+ it can break any day, at ${WEAR.breakAt} it does. Builders with no construction job do upkeep; a damaged one can be patched up with a proper repair.`)}><td>${esc(r.name)}</td><td style="width:40%">${bar(w, color)}</td><td>${w}%</td><td class="${r.fx.broken ? "danger" : r.fx.rigged || w >= WEAR.riskFrom ? "warn" : "muted"}">${state2}${btn}</td></tr>`;
  }).join("");
  const rep = canRepair(state, base);
  const cars = vehiclesAtBase(state, base.id).filter((v) => v.condition < 100);
  const carsHtml = cars.length ? cars.map((v) => `<div class="spread small"><span>${esc(v.name)} · ${Math.round(v.condition)}%${v.condition < 35 ? ` <span class="danger">(breaks down often)</span>` : ""}</span><button class="mini" data-action="repairv" data-base="${base.id}" data-id="${v.id}" ${rep.ok && carPartsCost((k) => base.stock[k] || 0, 1).ok ? "" : "disabled"}${tip(rep.ok ? `${carPartsText(1)} → +${rep.per} condition` : "Needs a garage or a Mechanics 4+ survivor here")}>Repair (1 car part)</button></div>`).join("") : `<div class="muted small">No parked vehicle needs work.</div>`;
  return `<div class="grid2">
    <div>
      <h3${tip("A broken building does nothing until someone fixes it. Repair properly (the job's hours, scrap and parts, Mechanics) or jury-rig it (cheap and quick, but it breaks again sooner). The repairer keeps their role and works the job 08:00–20:00, but not while the base is on alert or under siege. A steward with Building on, and the autopilot, start repairs themselves.")}>Repairs (${broken.length})</h3>
      ${raidHtml}
      ${wallRepairCard(state, base, people)}
      ${allHtml}
      ${brokenHtml}
      <h3>Parked vehicles</h3>
      ${carsHtml}
      <div class="small muted" style="margin-top:0.3rem">Frost costs parked vehicles 1% condition a day (2% in a blizzard).</div>
    </div>
    <div>
      <h3>Wear</h3>
      <table class="t small"><tr><th>Building</th><th>Wear</th><th></th><th>State</th></tr>${wearRows || `<tr><td colspan="4" class="muted">Nothing here wears out yet.</td></tr>`}</table>
      <div class="small muted" style="margin-top:0.3rem">Wear a day: use (a running station, a pumping well) × age, plus frost (pumps), storms (pumps, the radio mast, the storehouse roof) and hordes (walls, gate). Raids smash buildings by their strength and how long they stay at the walls: the defences first, then what is inside. A good mechanic on a station, a Grease Monkey (−20%) or Handy (−15%) survivor here slow it; builders with nothing to build take ${WEAR.upkeep} wear a day off the most worn.</div>
    </div>
  </div>`;
}

// ---------- the crash circles (left panel / alerts helper) ----------
export function crashLines(state) {
  return activeCrashes(state).map((c) => {
    const def = CRASH_KINDS[c.kind];
    return { c, text: c.found ? `${def.icon} ${state.tiles[c.tile].loc ? state.tiles[c.tile].loc.name : def.name}: ${daysLeft(state, c).toFixed(1)} days left` : `${def.icon} Downed ${def.name.toLowerCase()}: search ${c.radius} tiles around ${tileLabel(state, c.center)}, ${daysLeft(state, c).toFixed(1)} days left` };
  });
}

// ---------- handlers ----------
export const EXPLORE_ACTIONS = {
  "rw-order": (state, ui, d) => { const base = baseById(state, Number(d.base)); if (base) ui.baseMsg = orderWallRepair(state, base); },
  "rw-cancel": (state, ui, d) => { const base = baseById(state, Number(d.base)); if (base) ui.baseMsg = cancelWallRepair(state, base); },
  "rp-start": (state, ui, d) => {
    const base = baseById(state, Number(d.base));
    const fx = base && fixtureById(base, d.fx);
    if (!fx) return;
    ui.baseMsg = startRepair(state, base, fx, d.m === "rig" ? "rig" : "repair");
  },
  "rp-all": (state, ui, d) => {
    const base = baseById(state, Number(d.base));
    if (base) ui.baseMsg = startAllRepairs(state, base);
  },
  "rp-cancel": (state, ui, d) => {
    const base = baseById(state, Number(d.base));
    if (base) ui.baseMsg = cancelRepair(state, base, d.fx);
  },
};
export const EXPLORE_CHANGE = {
  "rw-who": (state, ui, el) => { const base = baseById(state, Number(el.dataset.base)); if (base && el.value) ui.baseMsg = reassignWallRepair(state, base, Number(el.value)); },
  "rp-who": (state, ui, el) => {
    const base = baseById(state, Number(el.dataset.base));
    if (!base || !el.value) return;
    ui.baseMsg = reassignRepair(state, base, el.dataset.fx, Number(el.value));
  },
};
export { day };
