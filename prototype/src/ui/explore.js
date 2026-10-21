// Base-panel pieces for exploration and upkeep (sim/blueprints.js, sim/locks.js, sim/breakdowns.js): the Repairs
// tab, the known blueprints card (Buildings tab), the key ring (Armory tab) and the "Needs: …" lines on locked
// buildings and recipes. Handlers in EXPLORE_ACTIONS (main.js registers them).
import { SKILL_NAMES } from "../sim/data.js";
import { pieceName } from "../sim/buildings.js"; // the wall's segment under way (its row of the Repairs table)
import { WALL_REPAIR, orderWallRepair, cancelWallRepair, reassignWallRepair, wallSegHours } from "../sim/breakdowns.js"; // the wall's repair order
import { baseById, day, atBase, skill, survivorById } from "../sim/world.js";
import { tileLabel } from "../sim/parties.js";
import { blueprintRows, lockNote, craftBookRows, cookBookRows } from "../sim/blueprints.js";
import { keyRing } from "../sim/locks.js";
import { repairList, repairHands, repairAllBill, startRepair, orderRepair, cancelRepair, reassignRepair, fixtureById, costText, fxDef, WEAR, RAID_DAMAGE, startAllRepairs } from "../sim/breakdowns.js";
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
// Repair orders (the user's request 2026-10-19): one list of everything placed at the base, most damaged at the top
// (breakdowns.js repairList), each row with its wear bar, state, and a Repair order ("Repair: <who>, <h>h, <cost>",
// a partial job on a worn thing, the full one on a broken one), Jury-rig on the broken, a who-picker (rp-order starts
// the job with that person; rp-who changes who works a running job), Cancel with the progress on a running job, and
// Repair all for the broken and the damaged (60+). The wall is one row (wallRowHtml). The last raid's card, the parked
// vehicles and the wear note stay.
// The wall's row (repairList kind "wall"; sim/breakdowns.js WALL_REPAIR, the user's request 2026-10-19): its pieces are
// mended by one order, a builder working through every damaged segment at so many hours a segment. What wants mending,
// who has the order, the segment under way; give the order (rw-order) or change who has it (rw-who), call it off
// (rw-cancel). The wear bar is its worst piece's.
function wallRowHtml(state, base, r) {
  const o = base.wallRepair, plan = r.plan, people = atBase(state, base.id);
  const who = o && o.who != null ? survivorById(state, o.who) : null;
  const cur = o && o.cur != null ? base.buildings.find((b) => b.id === o.cur) : null;
  const pick = `<select data-action="rw-who" data-base="${base.id}"${tip(o ? "Who has the order" : "Give the order to someone (the builders are listed first)")}><option value="">${o ? (who ? "Change who…" : "Pick someone…") : "Give it to…"}</option>${people.filter((s) => !s.inBed).sort((a, b) => (b.role === "build") - (a.role === "build") || skill(b, "mechanics") - skill(a, "mechanics")).map((s) => `<option value="${s.id}">${esc(s.name)} (${s.role === "build" ? "builder, " : ""}Mechanics ${skill(s, "mechanics")})</option>`).join("")}</select>`;
  const each = WALL_REPAIR.HOURS.slice(1).map((h, i) => `${["wood", "logs", "scrap metal", "metal sheets"][i]} ${h}h`).join(", ");
  const w = r.wear;
  const color = r.fx.broken ? "var(--danger)" : w >= WEAR.riskFrom ? "var(--warn, #e0a84f)" : "var(--good)";
  const cls = r.fx.broken ? "danger" : w >= WEAR.riskFrom ? "warn" : plan.list.length ? "" : "muted";
  const note = `<div class="small muted">${r.pieces} piece${r.pieces === 1 ? "" : "s"} (walls, gates, stands) · ${plan.list.length} segment${plan.list.length === 1 ? "" : "s"} to mend${plan.broken ? ` · <span class="danger">${plan.broken} broken: a gap until it is mended</span>` : ""}</div>`;
  const act = o ? `<div>Repairing: ${who ? firstName(who) : `<span class="warn">nobody (pick someone)</span>`}${cur ? ` · ${esc(pieceName(cur))} ${Math.floor(Math.max(0, o.done) * 10) / 10}/${wallSegHours(cur)}h` : ""} · ${o.mended} mended${o.stalled ? ` · <span class="danger">${esc(o.stalled)}</span>` : ""}</div>
        <div class="row" style="margin-top:0.2rem;flex-wrap:wrap;gap:0.3rem">${pick}<button class="mini" data-action="rw-cancel" data-base="${base.id}"${tip("Call the order off; the materials for the segment under way go back")}>Cancel</button></div>` :
    plan.list.length ? `<div class="row" style="flex-wrap:wrap;gap:0.3rem"><button class="mini" data-action="rw-order" data-base="${base.id}" ${plan.ok ? "" : "disabled"}${tip(plan.ok ? `${firstName(plan.who)} works through the wall's ${plan.list.length} damaged segment${plan.list.length === 1 ? "" : "s"}, broken first, 08:00–20:00: about ${plan.hours} work-hours, ${costText(plan.cost) || "no materials"} as they go.` : plan.why)}>Repair the wall${plan.who ? `: ${firstName(plan.who)}, ${plan.hours}h, ${esc(costText(plan.cost)) || "no materials"}` : ` (${esc(costText(plan.cost))})`}</button>${pick}</div>` : `<span class="muted">—</span>`;
  return `<tr${tip(`The wall is mended by an order, not a repair each: one person works through every broken or worn piece (wear ${WALL_REPAIR.FROM}+), broken first, 08:00–20:00. A 1×4 section takes ${each} (a 1×2 half, a 1×1 a quarter, a gate half again), faster with Mechanics; each segment's materials (half its build cost) are paid as it is started. The wear shown is the worst piece's.`)}><td><b>🧱 The wall</b>${note}</td><td style="width:22%">${bar(w, color)}</td><td>${w}%</td><td class="${cls}">${esc(r.state)}</td><td>${act}</td></tr>`;
}
const RAID_OUTCOME = { held: "driven off", won: "beaten in person", broken: "a break-in", overrun: "overrun" };
export function repairsTab(state, base) {
  const rows = repairList(state, base);
  const broken = rows.filter((r) => r.fx.broken);
  const worn = rows.filter((r) => !r.fx.broken && (r.kind === "wall" ? r.plan.list.length > 0 : r.plan.share > 0));
  const mech = (s) => `${esc(s.name)} (Mechanics ${skill(s, "mechanics")}${s.role === "build" ? ", builder" : ""})`;
  // "Repair: Ana, 4h, 3 scrap" (the first of repairHands, or the plan's reason in the tooltip when it cannot be done).
  const btn = (r, method) => {
    const plan = method === "rig" ? r.rig : r.plan;
    const label = method === "rig" ? "Jury-rig" : "Repair";
    const part = method === "repair" && !r.fx.broken ? ` A partial job: ${Math.round(plan.share * 100)}% of the full repair (${esc(costText(fxDef(r.fx).repair.cost))}, ${fxDef(r.fx).repair.hours}h by the book).` : "";
    return `<button class="mini" data-action="rp-start" data-base="${base.id}" data-fx="${r.fx.id}" data-m="${method}" ${plan.ok ? "" : "disabled"}${tip(plan.ok ? `${firstName(plan.who)} (Mechanics ${skill(plan.who, "mechanics")}${plan.who.role === "build" ? ", a builder" : ""}) works on it ${plan.hours} work-hours (08:00–20:00) for ${costText(plan.cost)}.${method === "rig" ? ` Cheap, but it wears ${Math.round((WEAR.rigMult - 1) * 100)}% faster and breaks again sooner.` : ` Wear back to ${WEAR.repairWear}.${part}`}` : plan.why)}>${label}${plan.who ? `: ${firstName(plan.who)}, ${plan.hours}h, ${esc(costText(plan.cost))}` : ` (${esc(costText(plan.cost))})`}</button>`;
  };
  // The who-picker: on a running job it changes who works it (rp-who); on an order it starts the job with that person (rp-order).
  const picker = (r) => {
    const j = r.job;
    const able = j ? repairHands(state, base, r.fx, j.method).concat(j.who != null && survivorById(state, j.who) && !repairHands(state, base, r.fx, j.method).some((s) => s.id === j.who) ? [survivorById(state, j.who)] : []) : repairHands(state, base, r.fx, "repair");
    if (!able.length) return "";
    return `<select data-action="${j ? "rp-who" : "rp-order"}" data-base="${base.id}" data-fx="${r.fx.id}"${tip(j ? "Who works on it (builders first, then the best mechanics)" : "Order the repair by someone else than the one the game picks (builders first, then the best mechanics)")}><option value="">${j ? (j.who != null ? "Change who…" : "Pick someone…") : "Repair by…"}</option>${able.map((s) => `<option value="${s.id}">${mech(s)}</option>`).join("")}</select>`;
  };
  const rowHtml = rows.map((r) => {
    if (r.kind === "wall") return wallRowHtml(state, base, r);
    const w = r.wear;
    const j = r.job;
    const who = j && j.who != null ? survivorById(state, j.who) : null;
    const color = r.fx.broken ? "var(--danger)" : w >= WEAR.riskFrom ? "var(--warn, #e0a84f)" : "var(--good)";
    const cls = r.fx.broken ? "danger" : r.fx.rigged || w >= WEAR.riskFrom ? "warn" : w > WEAR.repairWear ? "" : "muted";
    const note = r.fx.broken ? `<div class="danger small">${esc(r.def.what[0].toUpperCase() + r.def.what.slice(1))}. Broken since day ${r.fx.broken.day} (${esc(r.fx.broken.cause)}).</div>` : "";
    const act = j ? `<div>${j.method === "rig" ? "Jury-rigging" : "Repairing"}: ${who ? firstName(who) : "<span class=\"warn\">nobody (pick someone)</span>"} · ${Math.floor(j.done)}/${j.hours} work-hours</div>${bar((j.done / j.hours) * 100, "var(--accent)")}
        <div class="row" style="margin-top:0.2rem;flex-wrap:wrap;gap:0.3rem">${picker(r)}<button class="mini" data-action="rp-cancel" data-base="${base.id}" data-fx="${r.fx.id}"${tip("Stop the job; the materials go back to the stock")}>Cancel</button></div>` :
      r.plan.share > 0 ? `<div class="row" style="flex-wrap:wrap;gap:0.3rem">${btn(r, "repair")}${r.fx.broken ? btn(r, "rig") : ""}${picker(r)}</div>` : `<span class="muted">—</span>`;
    return `<tr${tip(`${r.name}: ${r.def.what} when it breaks. ${r.def.raidOnly ? "It only wears from raid damage." : "Wear builds with use, age and weather."} At ${WEAR.riskFrom}+ it can break any day, at ${WEAR.breakAt} it does. Anything worn above ${WEAR.repairWear} can be ordered repaired (a part of the full job, by its wear); builders with no construction job do upkeep too.`)}><td><b>${esc(r.name)}</b>${note}</td><td style="width:22%">${bar(w, color)}</td><td>${w}%</td><td class="${cls}">${esc(r.state)}</td><td>${act}</td></tr>`;
  }).join("");
  // Repair all: the broken and the damaged (60+) that nobody works on yet, with the bill of their plans.
  const all = repairAllBill(state, base);
  const allHtml = all.list.length > 1 ? `<div class="row" style="margin:0.3rem 0"><button class="mini" data-action="rp-all" data-base="${base.id}"${tip(`Every broken building here gets a repairer (a proper repair where it can be paid and someone fit is free, else a jury-rig), everything damaged (wear ${RAID_DAMAGE.damaged}+) a repair order, and the wall its repair order. All ${all.list.length}: ${costText(all.cost)}, about ${all.hours} work-hours.`)}>Repair all (${esc(costText(all.cost))})</button></div>` : "";
  const lr = base.lastRaid;
  const how = lr ? RAID_OUTCOME[lr.outcome] || lr.outcome : "";
  const raidHtml = lr ? `<div class="card small"${tip("What the last raid on this base smashed: the longer the siege and the worse it went, the more. Broken buildings do nothing until repaired; damaged ones (wear 60+) may give way any day, and damaged walls give 2 wall strength instead of 3.")}>
      <div class="spread"><b>Last raid: day ${lr.day}</b><span class="muted">${esc(lr.by)} · ${esc(how)} · ${lr.hours}h at the walls</span></div>
      <div class="${lr.broken.length || lr.destroyed ? "danger" : "muted"}">${esc(lr.text)}</div></div>` : "";
  const rep = canRepair(state, base);
  const cars = vehiclesAtBase(state, base.id).filter((v) => v.condition < 100);
  const carsHtml = cars.length ? cars.map((v) => `<div class="spread small"><span>${esc(v.name)} · ${Math.round(v.condition)}%${v.condition < 35 ? ` <span class="danger">(breaks down often)</span>` : ""}</span><button class="mini" data-action="repairv" data-base="${base.id}" data-id="${v.id}" ${rep.ok && carPartsCost((k) => base.stock[k] || 0, 1).ok ? "" : "disabled"}${tip(rep.ok ? `${carPartsText(1)} → +${rep.per} condition` : "Needs a garage or a Mechanics 4+ survivor here")}>Repair (1 car part)</button></div>`).join("") : `<div class="muted small">No parked vehicle needs work.</div>`;
  return `<div>
    <h3${tip("Everything placed at the base wears and can be ordered repaired, most damaged at the top. A broken building does nothing until someone fixes it: repair it properly (the job's hours, scrap and parts, Mechanics) or jury-rig it (cheap and quick, but it breaks again sooner). A worn one takes a part of the full job by its wear. The worker is a builder first, else the best free mechanic; pick another from the list. The repairer keeps their role and works the job 08:00–20:00, but not while the base is on alert or under siege. A steward with Building on, and the autopilot, start repairs themselves.")}>Repairs (${broken.length} broken, ${worn.length} worn)</h3>
    ${raidHtml}
    ${allHtml}
    <table class="t small"><tr><th>Building</th><th>Wear</th><th></th><th>State</th><th>Repair</th></tr>${rowHtml || `<tr><td colspan="5" class="muted">Nothing here wears out yet.</td></tr>`}</table>
    <div class="small muted" style="margin-top:0.3rem">Wear a day: use (a running station, a pumping well) × age, plus frost (pumps), storms (pumps, the radio mast, the storehouse roof) and hordes (walls, gate). Raids smash buildings by their strength and how long they stay at the walls: the defences first, then what is inside. A good mechanic on a station, a Grease Monkey (−20%) or Handy (−15%) survivor here slow it; builders with nothing to build take ${WEAR.upkeep} wear a day off the most worn. A repair order on a worn thing costs its share of the full job (wear back to ${WEAR.repairWear}); at ${RAID_DAMAGE.damaged}+ it may break any day.</div>
    <h3>Parked vehicles</h3>
    ${carsHtml}
    <div class="small muted" style="margin-top:0.3rem">Frost costs parked vehicles 1% condition a day (2% in a blizzard).</div>
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
    ui.baseMsg = startRepair(state, base, fx, d.m === "rig" ? "rig" : "repair", d.who ? Number(d.who) : null);
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
  // A repair order by the person picked (repair orders 2026-10-19): the select's value is who does it.
  "rp-order": (state, ui, el) => {
    const base = baseById(state, Number(el.dataset.base));
    if (!base || !el.value) return;
    ui.baseMsg = orderRepair(state, base, el.dataset.fx, Number(el.value));
  },
};
export { day };
