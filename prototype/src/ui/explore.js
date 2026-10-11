// Base-panel pieces for exploration and upkeep (sim/blueprints.js, sim/locks.js, sim/breakdowns.js): the Repairs
// tab, the known blueprints card (Buildings tab), the key ring (Armory tab) and the "Needs: …" lines on locked
// buildings and recipes. Handlers in EXPLORE_ACTIONS (main.js registers them).
import { SKILL_NAMES } from "../sim/data.js";
import { baseById, day, atBase, skill, survivorById } from "../sim/world.js";
import { tileLabel } from "../sim/parties.js";
import { blueprintRows, lockNote, craftBookRows } from "../sim/blueprints.js";
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
  }).join("")}</table>`;
}

// ---------- Key ring (Armory tab) ----------
export function keyRingCard(state) {
  const keys = keyRing(state);
  return `<h3${tip("Keys found in raids (on bodies, in drawers and locked things) and searches. Each opens every lock at its site: a locked room's doors, gun cages, safes. They are not cargo: they hang on the hub's key ring.")}>Key ring (${keys.length})</h3>
  <div class="small">${keys.length ? keys.map((k) => `<div class="spread"><span>🔑 ${esc(k.name)} <span class="muted">· day ${k.day}${k.how ? ` · ${esc(k.how)}` : ""}</span></span><button class="mini" data-action="center" data-tile="${k.tile}"${tip(`Show ${tileLabel(state, k.tile)} on the map`)}>Map</button></div>`).join("") : `<span class="muted">No keys yet. They turn up on bodies and in drawers, lockers and safes.</span>`}</div>`;
}

// ---------- Repairs tab ----------
const RAID_OUTCOME = { held: "driven off", won: "beaten in person", broken: "a break-in", overrun: "overrun" };
export function repairsTab(state, base) {
  const rows = repairRows(state, base);
  const broken = rows.filter((r) => r.fx.broken);
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
  const open = brokenAt(base).filter((fx) => !jobFor(base, fx));
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
  const wearRows = rows.map((r) => {
    const w = r.wear;
    const color = r.fx.broken ? "var(--danger)" : w >= WEAR.riskFrom ? "var(--warn, #e0a84f)" : "var(--good)";
    const state2 = r.fx.broken ? "Broken" : r.job ? "Being patched" : r.fx.rigged ? "Jury-rigged" : w >= RAID_DAMAGE.damaged && r.def.raidOnly ? "Damaged: may break" : w >= WEAR.riskFrom ? "Worn: may break" : "OK";
    const btn = !r.fx.broken && !r.job && w >= RAID_DAMAGE.damaged ? ` ${patch(r)}` : "";
    return `<tr${tip(`${r.name}: ${r.def.what} when it breaks. ${r.def.raidOnly ? "It only wears from raid damage." : "Wear builds with use, age and weather."} At ${WEAR.riskFrom}+ it can break any day, at ${WEAR.breakAt} it does. Builders with no construction job do upkeep; a damaged one can be patched up with a proper repair.`)}><td>${esc(r.name)}</td><td style="width:40%">${bar(w, color)}</td><td>${w}%</td><td class="${r.fx.broken ? "danger" : r.fx.rigged || w >= WEAR.riskFrom ? "warn" : "muted"}">${state2}${btn}</td></tr>`;
  }).join("");
  const rep = canRepair(state, base);
  const cars = vehiclesAtBase(state, base.id).filter((v) => v.condition < 100);
  const carsHtml = cars.length ? cars.map((v) => `<div class="spread small"><span>${esc(v.name)} · ${Math.round(v.condition)}%${v.condition < 35 ? ` <span class="danger">(breaks down often)</span>` : ""}</span><button class="mini" data-action="repairv" data-base="${base.id}" data-id="${v.id}" ${rep.ok && carPartsCost((k) => base.stock[k] || 0, 1).ok ? "" : "disabled"}${tip(rep.ok ? `${carPartsText(1)} → +${rep.per} condition` : "Needs a garage or a Mechanics 4+ survivor here")}>Repair (1 car part)</button></div>`).join("") : `<div class="muted small">No parked vehicle needs work.</div>`;
  return `<div class="grid2">
    <div>
      <h3${tip("A broken building does nothing until someone fixes it. Repair properly (the job's hours, scrap and parts, Mechanics) or jury-rig it (cheap and quick, but it breaks again sooner). The repairer keeps their role and works the job 08:00–20:00, but not while the base is on alert or under siege. A steward with Building on, and the autopilot, start repairs themselves.")}>Repairs (${broken.length})</h3>
      ${raidHtml}
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
  "rp-who": (state, ui, el) => {
    const base = baseById(state, Number(el.dataset.base));
    if (!base || !el.value) return;
    ui.baseMsg = reassignRepair(state, base, el.dataset.fx, Number(el.value));
  },
};
export { day };
