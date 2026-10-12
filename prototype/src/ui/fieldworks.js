// Field works in the interface (sim/fieldworks.js): the base window's Field works tab, placing one on the map (the
// tile picker: valid tiles of the base's land highlighted), the map's sprites with their condition bar, garrison and
// needs-repair icon, the hover lines, the alerts and the team's menu items at a structure.
import * as FW from "../sim/fieldworks.js";
import { atBase, baseById, survivorById, skill, hourOfDay } from "../sim/world.js";
import { shiftText } from "../sim/watch.js";
import { buildRate } from "../sim/buildings.js";
import { SUPPLIES } from "../sim/data.js";
import { tileLabel } from "../sim/parties.js";
import { healthRest } from "../sim/work.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const matWord = (k, n) => (k === "parts" ? (n === 1 ? "part" : "parts") : k === "wood" ? "firewood" : SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k);
// Cost chips: green when the base has it, red when short.
export function costChips(base, cost) {
  return Object.entries(cost || {}).map(([k, v]) => {
    const have = Math.floor((base && base.stock[k]) || 0);
    return `<span class="chip ${have >= v ? "on" : "off"}"${tip(`${base ? base.name : "The base"} has ${have}`)}>${v} ${esc(matWord(k, v))}</span>`;
  }).join("") || `<span class="chip">nothing</span>`;
}
const condColor = (fw) => (FW.condition(fw) < 0.35 ? "var(--danger)" : FW.condition(fw) < FW.FIELD.GOV.repairAt ? "var(--accent)" : "var(--good)");
const wrench = (fw) => { const b = FW.damageBand(fw); return b ? ` <span class="${b === "bad" ? "danger" : "warn"}"${tip(b === "bad" ? "Badly damaged: repair it before the next hit takes it down" : "Damaged: needs repair")}>🔧</span>` : ""; };
const where = (state, tile) => { const t = state.tiles[tile]; return `${t.x},${t.y}`; };

// ---------- the base window's tab ----------
export function fieldWorksTab(state, b, ui) {
  const K = FW.FIELD.KINDS;
  const mine = FW.playerWorks(state, b);
  const jobs = FW.fieldJobs(state, b);
  const max = FW.maxWorks(b);
  const rate = buildRate(state, b);
  const head = `<div class="card small">
    <div class="spread"><b>Field works</b><span class="muted">${FW.countedWorks(state, b).length} of ${max} · snare lines ${mine.filter((x) => x.kind === "snares").length} of ${FW.maxSnares(b)} · land within ${FW.FIELD.RANGE} tiles that ${esc(b.name)} holds</span></div>
    <div class="muted">Roadblocks, wells, watch towers, stockpiles, hunting blinds, snare lines, fuel caches, spike traps and relay masts out on the base's land. <button class="mini" data-action="help-open" data-sec="field-works"${tip("Help: Field works")}>?</button> The materials leave the stores when you place one; the builders here walk out and put it up (their hours include the walk), sharing their time with the base's own queue (every other hour while it has work). Out there they can be battered by the dead, raided and taken by other groups: repair them here.${rate > 0 ? "" : ` <span class="warn">Nobody here is on the Build job: nothing will go up but a snare line (a team you send sets it).</span>`}</div>
  </div>`;
  const plan = FW.FIELD.ORDER.map((k) => {
    const d = K[k];
    const tiles = FW.placeTiles(state, b, k);
    const ok = tiles.filter((x) => !x.why).length;
    const anyTile = tiles.find((x) => !x.why);
    const why = anyTile ? FW.placeProblem(state, b, k, anyTile.tile) : (tiles[0] ? tiles[0].why : "No land of this base's to build on.");
    const reqs = d.req ? Object.entries(d.req).map(([sk, lv]) => `${sk[0].toUpperCase() + sk.slice(1)} ${lv}+`).join(", ") : "";
    return `<div class="card small"${tip(d.desc)}>
      <div class="spread"><b>${d.icon} ${esc(d.name)}</b><button class="mini" data-action="fw-place" data-base="${b.id}" data-kind="${k}" ${!why && ok ? "" : "disabled"}${tip(!why && ok ? `Pick a highlighted tile on the map (${ok} possible). Esc cancels.` : why)}>${ui.fwPlace && ui.fwPlace.kind === k ? "Click a tile…" : "Place on map…"}</button></div>
      <div>${costChips(b, d.cost)}<span class="muted small"> · ${d.craft ? `a team walks out and sets it (${d.hours} h there)` : `${d.hours} work-hours + the walk`} · ${d.hp} condition${reqs ? ` · ${reqs}` : ""}</span></div>
      ${why && ok ? `<div class="small warn">${esc(why)}</div>` : !ok ? `<div class="small muted">${esc(tiles[0] ? tiles[0].why : "No land of this base's to build on.")}</div>` : ""}
    </div>`;
  }).join("");
  const jobRows = jobs.map((j) => {
    const fw = FW.fwById(state, j.fw);
    const pct = j.hours ? (j.progress / j.hours) * 100 : 0;
    const blocked = fw && FW.threatOn(state, fw.tile);
    return `<div class="card small"><div class="spread"><span>${fw ? K[fw.kind].icon : ""} ${esc(FW.jobText(state, j))} <span class="muted">at ${fw ? where(state, fw.tile) : "?"}</span></span>
      <span class="row"><span class="muted">${Math.floor(j.progress)}/${j.hours} h${blocked ? ` · <span class="danger">enemies there: waiting</span>` : ""}</span><button class="mini" data-action="fw-cancel" data-id="${j.id}"${tip(j.progress > 0 ? "Stop: half the materials come back" : "Stop: everything comes back")}>Cancel</button></span></div>
      ${bar(pct, "var(--accent)")}</div>`;
  }).join("");
  const people = atBase(state, b.id).filter((s) => !healthRest(s));
  const list = mine.map((fw) => {
    const d = K[fw.kind];
    const job = FW.jobFor(state, fw);
    const cond = fw.built ? `${bar(FW.condition(fw) * 100, condColor(fw))}` : "";
    const rc = fw.built && fw.hp < fw.max && !job ? FW.repairCost(state, fw) : null;
    const rwhy = rc ? FW.repairProblem(state, fw) : "";
    const repair = rc ? `<div class="row" style="margin-top:0.25rem;gap:0.3rem;flex-wrap:wrap"><span class="small">Repair: ${costChips(b, rc.cost)} <span class="muted">${rc.hours} h with the walk</span></span><button class="mini" data-action="fw-repair" data-id="${fw.id}" ${rwhy ? "disabled" : ""}${tip(rwhy || "The builders go out and mend it")}>Repair</button></div>` : "";
    let extra = "";
    if (FW.garrisonCap(fw) && fw.built) extra = shiftsBlock(state, b, fw, people);
    if (fw.kind === "stockpile" && fw.built) {
      const empty = !Object.keys(fw.contents || {}).length;
      const H = fw.haul || {};
      const opt = (v, cur, word) => `<option value="${v}" ${v === (cur || 0) ? "selected" : ""}>${word(v)}</option>`;
      extra = `<div class="row small" style="margin-top:0.25rem;gap:0.3rem"><span style="flex:1" class="muted">A haul team brings it home; teams can leave finds here (their menu on the tile).</span><button class="mini" data-action="fw-haul" data-id="${fw.id}" ${empty ? "disabled" : ""}${tip(empty ? "Nothing to bring in" : "Two people (and the base's best running vehicle, if any) go out, load it and come home")}>Send a haul team</button></div>
      <div class="row small" style="margin-top:0.25rem;gap:0.3rem;flex-wrap:wrap"${tip("A standing order: on its day (or once it holds that much) at 09:00 two people take the base's best running vehicle out, load it and come home. Skipped (tried again the next day) with no running vehicle with fuel, nobody fit, the base under attack or enemies at the stockpile.")}>Haul it <select data-action="fw-haul-every" data-id="${fw.id}">${FW.FIELD.HAUL.every.map((v) => opt(v, H.every, (x) => (x ? `every ${x} days` : "not on a schedule"))).join("")}</select>
        <select data-action="fw-haul-kg" data-id="${fw.id}">${FW.FIELD.HAUL.atKg.map((v) => opt(v, H.atKg, (x) => (x ? `or at ${x} kg` : "(no weight)"))).join("")}</select>
        ${FW.haulText(state, fw) ? `<span class="muted">${esc(FW.haulText(state, fw))}</span>` : ""}</div>`;
    }
    if (fw.kind === "snares") extra = snareBlock(state, b, fw);
    if (fw.kind === "cache" && fw.built) {
      const plan = FW.cachePlan(state, fw);
      const rwhy = FW.restockProblem(state, fw);
      extra = `<div class="row small" style="margin-top:0.25rem;gap:0.3rem;flex-wrap:wrap"><span style="flex:1" class="muted">Teams take what they need here (their menu on the tile), or leave supplies.${Object.keys(plan).length ? ` A restock carries out ${esc(FW.costText(plan))}.` : ""}</span><button class="mini" data-action="fw-restock" data-id="${fw.id}" ${rwhy ? "disabled" : ""}${tip(rwhy || "The builders carry fuel, food, ammo and meds out from the stores (at most half of each): the walk and an hour")}>Restock</button></div>`;
    }
    const dwhy = FW.demolishProblem(state, fw);
    return `<div class="card small"${tip(d.desc)}>
      <div class="spread"><span><b>${d.icon} ${esc(d.name)}</b>${wrench(fw)} <span class="muted">at ${where(state, fw.tile)}${fw.captured ? " · taken back" : ""}</span></span>
      <span class="row"><button class="mini" data-action="fw-show" data-tile="${fw.tile}"${tip("Show it on the map")}>Show</button><button class="mini" data-action="fw-demolish" data-id="${fw.id}" ${dwhy ? "disabled" : ""}${tip(dwhy || (fw.built ? "The builders pull it down: half its materials come back" : "Cancel the build"))}>${fw.built ? "Demolish" : "Cancel"}</button></span></div>
      ${cond}<div class="muted small">${esc(FW.fwStatusText(state, fw))}</div>${repair}${extra}
    </div>`;
  }).join("");
  const damaged = mine.filter((fw) => fw.built && fw.hp < fw.max && !FW.jobFor(state, fw));
  const total = {};
  for (const fw of damaged) for (const [k, v] of Object.entries(FW.repairCost(state, fw).cost)) total[k] = (total[k] || 0) + v;
  const allBtn = damaged.length ? `<div class="row small" style="gap:0.3rem;margin:0.3rem 0">Repair all damaged (${damaged.length}): ${costChips(b, total)}<button class="mini" data-action="fw-repair-all" data-base="${b.id}"${tip("Queue repairs on every damaged field work this base can pay for, worst first")}>Repair all</button></div>` : "";
  return `${head}
    <h3>Plan</h3>${plan}
    ${jobs.length ? `<h3>Builders' field jobs</h3>${jobRows}` : ""}
    <h3>Standing</h3>${allBtn}${list || `<div class="muted small">None yet.</div>`}`;
}

// A snare line of yours (WORLD-02): set and checked only by a team sent out to it. Send one now, or a standing check
// every few days; what it holds is known from the last check alone.
function snareBlock(state, b, fw) {
  const team = FW.snareTeam(state, fw);
  const route = FW.snareRoute(state, b, fw.tile);
  const how = !route ? "No way out to it now (water in the way)." : route.boat ? `Across the river: the team builds a boat there and one back (${FW.boatScrap()} scrap from ${b.name}).` : "";
  const busy = team ? "A team is on its way there." : "";
  if (!fw.built) {
    return `<div class="row small" style="margin-top:0.25rem;gap:0.3rem"><span style="flex:1" class="muted">${esc(team ? `${busy} It sets the line when it gets there.` : `Waiting for a team to set it (tried again each morning).${how ? ` ${how}` : ""}`)}</span><button class="mini" data-action="fw-snare-team" data-id="${fw.id}" ${team ? "disabled" : ""}${tip(team ? busy : `Send ${FW.FIELD.SNARES.crew === 1 ? "one person" : `${FW.FIELD.SNARES.crew} people`} (a hunter first) out to set it, then home`)}>Send a team</button></div>`;
  }
  const C = fw.check || {};
  const opt = (v) => `<option value="${v}" ${v === (C.every || 0) ? "selected" : ""}>${v ? `every ${v} day${v === 1 ? "" : "s"}` : "only when sent"}</option>`;
  const known = FW.snareKnownText(state, fw);
  return `<div class="row small" style="margin-top:0.25rem;gap:0.3rem"><span style="flex:1" class="muted">${esc(`${known ? `${known[0].toUpperCase()}${known.slice(1)}.` : "Not checked yet."} What it holds now is unknown until a team checks it.${how ? ` ${how}` : ""}`)}</span><button class="mini" data-action="fw-snare-team" data-id="${fw.id}" ${team || !route ? "disabled" : ""}${tip(team ? busy : !route ? how : "Send someone (a hunter first) to check it: they take the catch, put down anything caught in the wires and come home")}>Send a team to check</button></div>
    <div class="row small" style="margin-top:0.25rem;gap:0.3rem;flex-wrap:wrap"${tip(`A standing order: on its day at ${String(FW.CHECK_HOUR).padStart(2, "0")}:00 someone walks out, checks the line and brings the catch home. Skipped (tried again the next day) with nobody fit, the base under attack, enemies at the line or no scrap for the boats. The catch keeps 2–6 days by the heat.`)}>Check it <select data-action="fw-snare-every" data-id="${fw.id}">${FW.FIELD.SNARES.every.map(opt).join("")}</select>${FW.snareCheckText(state, fw) ? ` <span class="muted">${esc(FW.snareCheckText(state, fw))}</span>` : ""}</div>`;
}

// The shifts at a tower or a roadblock: the preset, each shift with its people (✕ takes them off) and a picker, the
// 24-hour coverage strip (gaps red) and the line under it.
const hh = (h) => String(((h % 24) + 24) % 24).padStart(2, "0");
function shiftsBlock(state, b, fw, people) {
  const R = FW.ensureRoster(fw);
  const cap = FW.garrisonCap(fw);
  const word = fw.kind === "tower" ? "Lookouts" : "Guards";
  const sk = fw.kind === "tower" ? "scouting" : "shooting";
  const elsewhere = new Set(FW.fwList(state).filter((x) => x !== fw).flatMap((x) => FW.rosterIds(x)));
  const opts = people.filter((s) => !s.pinned && !elsewhere.has(s.id)).sort((a, c) => skill(c, sk) - skill(a, sk) || a.id - c.id);
  const rows = R.shifts.map((sh, i) => {
    const chips = sh.ids.map((id) => survivorById(state, id)).filter(Boolean).map((s) => {
      const out = FW.onPost(s) && s.location.fw === fw.id;
      return `<span class="chip${out ? " on" : ""}"${tip(out ? "Out there now" : "At the base (off duty, or waiting for the shift)")}>${esc(s.name.split(" ")[0])} <button class="mini" data-action="fw-recall" data-sid="${s.id}"${tip("Off the shifts (and home, if out there)")}>✕</button></span>`;
    }).join("") || `<span class="muted">nobody</span>`;
    const add = sh.ids.length < cap ? `<select data-action="fw-post" data-id="${fw.id}" data-i="${i}"${tip(`Put someone on the ${sh.name.toLowerCase()} shift: they walk out for it and come home after (fed and rested at the base; no base work while out there).`)}><option value="">Add…</option>${opts.filter((s) => !sh.ids.includes(s.id)).map((s) => `<option value="${s.id}">${esc(s.name)} (${sk[0].toUpperCase() + sk.slice(1)} ${Math.floor(skill(s, sk))})</option>`).join("")}</select>` : "";
    return `<div class="row small" style="gap:0.3rem;flex-wrap:wrap;margin-top:0.2rem"><b>${esc(sh.name)}</b> <span class="muted">${shiftText(sh)}</span> ${chips} ${add}</div>`;
  }).join("");
  const cov = FW.shiftCoverage(state, fw);
  const now = hourOfDay(state);
  const strip = `<div class="dcov">${cov.map((c) => `<div class="dcell${c.n ? "" : " gap"}${c.h === now ? " cur" : ""}"${tip(`${hh(c.h)}:00 · ${c.n ? `${c.n} on duty: ${c.who.map((s) => s.name.split(" ")[0]).join(", ")}` : "nobody on duty"}${c.shifts.length ? ` (${c.shifts.map((sh) => `${sh.name} ${shiftText(sh)}`).join(", ")})` : " (no shift)"}`)}><i style="height:${Math.round((c.n / Math.max(1, cap)) * 100)}%"></i><span>${c.h % 3 === 0 ? hh(c.h) : ""}</span></div>`).join("")}</div>`;
  const line = FW.shiftLine(state, fw);
  return `<div class="small fwshifts" style="margin-top:0.3rem"><div class="row" style="gap:0.3rem;flex-wrap:wrap">${word} on shifts: <select data-action="fw-preset" data-id="${fw.id}"${tip("How the day is split. People keep a shift that matches by name or hours.")}>${Object.entries(FW.FIELD.SHIFTS).map(([k, p]) => `<option value="${k}" ${R.preset === k ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select> <span class="muted">up to ${cap} a shift · a ${FW.shiftWalk(state, fw)} h walk each way</span></div>
    ${rows}${strip}<div class="${line.gaps.length ? "warn" : "muted"}">${esc(line.text)}</div></div>`;
}

// ---------- the tile picker ----------
// ui.fwPlace = { baseId, kind, tab }: the base window is put aside while a tile is picked; valid tiles light up.
export function fwPlaceTiles(state, ui) {
  if (!ui.fwPlace) return null;
  const b = baseById(state, ui.fwPlace.baseId);
  return b ? FW.placeTiles(state, b, ui.fwPlace.kind) : null;
}
export function fwPlaceBanner(state, ui) {
  if (!ui.fwPlace) return "";
  const b = baseById(state, ui.fwPlace.baseId);
  const d = FW.FIELD.KINDS[ui.fwPlace.kind];
  return `<div class="movemode" data-tip="The clock waits until you pick a tile.">${d.icon} ${esc(d.name)} for ${esc(b ? b.name : "the base")}: <b>click a green tile</b> · <b>Esc</b> cancels` +
    (ui.fwMsg ? `<br><span class="danger">${esc(ui.fwMsg)}</span>` : "") + `</div>`;
}
// A tile clicked while placing: planned (the base window comes back on its Field works tab), or why not (the mode stays on).
export function fwPlaceClick(state, ui, tile) {
  const b = baseById(state, ui.fwPlace.baseId);
  const r = FW.planFieldWork(state, b, ui.fwPlace.kind, tile);
  if (r.error) { ui.fwMsg = r.error; return false; }
  ui.baseView = { id: b.id, tab: "fieldworks" };
  ui.baseMsg = r.text;
  ui.fwPlace = null;
  ui.fwMsg = "";
  return true;
}
export function fwPlaceCancel(ui) {
  if (!ui.fwPlace) return false;
  ui.baseView = { id: ui.fwPlace.baseId, tab: "fieldworks" };
  ui.fwPlace = null;
  ui.fwMsg = "";
  return true;
}

// ---------- actions (main.js) ----------
// getState: () => state; centerOn: (tile) => void.
export function fieldworksActions(getState, ui, { centerOn, select = null }) {
  const msg = (r) => { ui.baseMsg = r && r.error ? r.error : r ? (r.text || r) : ""; };
  return {
    "fw-place": (d) => { ui.fwPlace = { baseId: Number(d.base), kind: d.kind }; ui.fwMsg = ""; ui.baseView = null; centerOn(baseById(getState(), Number(d.base)).tile); },
    "fw-cancel": (d) => { ui.baseMsg = FW.cancelFieldJob(getState(), Number(d.id)); },
    "fw-repair": (d) => msg(FW.queueRepair(getState(), Number(d.id))),
    "fw-repair-all": (d) => { const st = getState(); ui.baseMsg = FW.repairAll(st, baseById(st, Number(d.base))).text; },
    "fw-demolish": (d) => msg(FW.queueDemolish(getState(), Number(d.id))),
    "fw-recall": (d) => { ui.baseMsg = FW.recallPerson(getState(), Number(d.sid)) || ""; },
    "fw-haul": (d) => msg(FW.sendHaul(getState(), Number(d.id))),
    "fw-restock": (d) => msg(FW.queueRestock(getState(), Number(d.id))),
    "fw-snare-team": (d) => msg(FW.sendSnareTeam(getState(), Number(d.id))),
    "fw-show": (d) => { ui.baseView = null; centerOn(Number(d.tile)); if (select) select(Number(d.tile)); else ui.selected = Number(d.tile); }, // selected: a tower shows its sight ring
  };
}
export function fieldworksChange(getState, ui) {
  return {
    "fw-post": (el) => { if (!el.value) return; const r = FW.postPerson(getState(), Number(el.dataset.id), Number(el.value), el.dataset.i != null ? Number(el.dataset.i) : null); ui.baseMsg = r.error || r.text; },
    "fw-preset": (el) => { const st = getState(); ui.baseMsg = FW.setRosterPreset(st, FW.fwById(st, Number(el.dataset.id)), el.value); },
    "fw-haul-every": (el) => { const st = getState(), fw = FW.fwById(st, Number(el.dataset.id)); if (fw) ui.baseMsg = FW.setHaul(st, fw, Number(el.value), fw.haul ? fw.haul.atKg : 0); },
    "fw-snare-every": (el) => { const st = getState(), fw = FW.fwById(st, Number(el.dataset.id)); if (fw) ui.baseMsg = FW.setSnareCheck(st, fw, Number(el.value)); },
    "fw-haul-kg": (el) => { const st = getState(), fw = FW.fwById(st, Number(el.dataset.id)); if (fw) ui.baseMsg = FW.setHaul(st, fw, fw.haul ? fw.haul.every : 0, Number(el.value)); },
  };
}

// ---------- alerts (ui/alerts.js) ----------
export function fieldworkAlerts(state, out) {
  for (const n of FW.recentNews(state)) {
    if (n.tone !== "danger") continue;
    out.push({ key: `fw:${n.fw}:${n.hour}`, kind: "fieldwork", icon: n.text.includes("destroyed") || n.text.includes("took") ? "🏚" : "⚔", tone: "danger", text: n.text.length > 90 ? `${n.text.slice(0, 88)}…` : n.text, tip: `${n.text} Click to look.`, go: { tile: n.tile }, event: true });
  }
  // A planned shift at a tower or roadblock nobody can stand now (hurt, ill, away): one alert a structure, gone once
  // someone covers it again (or the roster is changed).
  for (const fw of FW.playerWorks(state)) {
    if (!FW.garrisonCap(fw)) continue;
    const u = FW.uncovered(state, fw);
    if (!u) continue;
    const b = baseById(state, fw.baseId);
    const why = u.who.map((x) => `${x.name} ${x.why}`).join(", ");
    out.push({ key: `fwgap:${fw.id}`, kind: "fwgap", icon: fw.kind === "tower" ? "👁" : "🛡", tone: "warn", text: `${FW.kindName(fw)} at ${where(state, fw.tile)} uncovered: ${u.shift.name.toLowerCase()} shift (${why})`.slice(0, 90), tip: `The ${u.shift.name.toLowerCase()} shift (${shiftText(u.shift)}) has nobody fit to stand it: ${why}. Put someone else on it from ${b ? b.name : "its base"}'s Field works tab. Click to open it.`, go: b ? { base: b.id, tab: "fieldworks" } : { tile: fw.tile } });
  }
  for (const fw of FW.playerWorks(state)) {
    const band = FW.damageBand(fw);
    if (!band || FW.jobFor(state, fw)) continue;
    const b = baseById(state, fw.baseId);
    out.push({ key: `fwrep:${fw.id}:${band}`, kind: "fwrepair", icon: "🔧", tone: band === "bad" ? "danger" : "warn", text: `${FW.kindName(fw)} at ${where(state, fw.tile)} needs repair (${Math.round(FW.condition(fw) * 100)}%)`, tip: `${b ? b.name : "Its base"}'s Field works tab: Repair (materials by the damage, the builders walk out). Click to open it.`, go: b ? { base: b.id, tab: "fieldworks" } : { tile: fw.tile } });
  }
}

// ---------- the map (ui/render.js) ----------
// Draws every field work you know of (yours always; a group's where you see it or have seen the tile; a group's hidden
// cache only once a team of yours found it), and the tile picker's highlight. Zoomed far out (zoom < FAR) each is a
// round badge in the owner's colour with the kind's icon and a condition arc, so it stays readable; a watch tower of
// yours under the mouse or selected shows its sight: a faint ring of the tiles its lookouts see now (grey when nobody
// is on duty). o: { ctx, G, inView, s (zoom boost), zoom, hover, selected, live, knowledge, place: [{ tile, why }] |
// null, colorOf(owner) }.
const FAR = 0.6;
export function drawFieldWorks(state, o) {
  const { ctx, G, inView } = o;
  const s = o.s * 1.35; // a little larger than a site's badge: they are small structures on a big tile
  const far = o.zoom != null && o.zoom < FAR;
  sightRings(state, o);
  if (o.place) for (const x of o.place) {
    if (!inView(x.tile)) continue;
    const px = G.x[x.tile], py = G.y[x.tile];
    ctx.save();
    ctx.strokeStyle = x.why ? "rgba(226,104,95,0.45)" : "rgba(108,196,138,0.95)";
    ctx.fillStyle = x.why ? "rgba(226,104,95,0.08)" : "rgba(108,196,138,0.18)";
    ctx.lineWidth = 2 * s;
    hex(ctx, px, py, 22);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  for (const fw of FW.fwList(state)) {
    if (!inView(fw.tile)) continue;
    if (fw.owner !== "player" && !(o.live && o.live.has(fw.tile)) && !(o.knowledge && o.knowledge[fw.tile] && o.knowledge[fw.tile].hour >= fw.since)) continue;
    if (fw.owner !== "player" && fw.kind === "cache" && !fw.found) continue; // hidden
    const site = !!state.tiles[fw.tile].loc; // a site's sprite in the middle: the field work stands in the tile's lower corner
    const px = G.x[fw.tile] + (site ? 13 : 8) * s, py = G.y[fw.tile] + (site ? 9 : -6) * s;
    const color = o.colorOf(fw.owner);
    if (far) { badge(state, ctx, fw, px, py, s, color); continue; }
    ctx.save();
    ctx.globalAlpha = fw.built ? 1 : 0.6;
    // A small plate in the owner's colour, the kind's sprite on it.
    ctx.fillStyle = "rgba(20,22,26,0.75)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.ellipse(px, py + 6 * s, 8 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    paint(ctx, fw, px, py, s, color);
    if (!fw.built) { // scaffold: dashed outline
      ctx.setLineDash([2 * s, 2 * s]); ctx.strokeStyle = "#e0a84f"; ctx.strokeRect(px - 7 * s, py - 10 * s, 14 * s, 16 * s); ctx.setLineDash([]);
    }
    ctx.restore();
    // The condition bar (damaged) or the build bar (going up), the garrison and the needs-repair icon.
    const job = FW.jobFor(state, fw);
    const f = !fw.built ? (job ? job.progress / job.hours : 0) : FW.condition(fw);
    if (!fw.built || f < 1 || job) {
      const w = 14 * s, h = 2.5 * s, x = px - w / 2, y = py + 10 * s;
      ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.fillStyle = !fw.built ? "#e0a84f" : f < 0.35 ? "#e2685f" : f < FW.FIELD.GOV.repairAt ? "#e0a84f" : "#6cc48a";
      ctx.fillRect(x, y, w * Math.max(0, Math.min(1, f)), h);
    }
    const gar = fw.owner === "player" ? FW.postedAt(state, fw).length : fw.gar || 0;
    ctx.font = `${Math.round(8 * s)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (fw.kind === "tower" && fw.built && gar) {
      ctx.fillStyle = FW.manned(state, fw) ? "#ffd166" : "#9aa0a6";
      ctx.fillText(`👁${gar}`, px + 10 * s, py - 10 * s);
    }
    if (fw.kind === "roadblock" && fw.built && gar) {
      ctx.fillStyle = FW.guards(state, fw) ? "#ffd166" : "#9aa0a6";
      ctx.fillText(`🛡${gar}`, px + 10 * s, py - 10 * s);
    }
    const band = FW.damageBand(fw);
    if (band && fw.owner === "player") {
      ctx.beginPath(); ctx.arc(px - 9 * s, py - 9 * s, 5 * s, 0, Math.PI * 2);
      ctx.fillStyle = band === "bad" ? "#e2685f" : "#e0a84f"; ctx.fill();
      ctx.fillStyle = "#111"; ctx.font = `${Math.round(7 * s)}px sans-serif`;
      ctx.fillText("🔧", px - 9 * s, py - 9 * s);
    }
  }
}
// Zoomed far out: a round plate in the owner's colour, the kind's icon, the condition as an arc round it (amber
// going up), a small count of the people on duty.
function badge(state, ctx, fw, x, y, s, color) {
  const r = 7.5 * s;
  ctx.save();
  ctx.globalAlpha = fw.built ? 1 : 0.65;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20,22,26,0.85)"; ctx.fill();
  ctx.lineWidth = 2 * s; ctx.strokeStyle = color; ctx.stroke();
  const job = FW.jobFor(state, fw);
  const f = !fw.built ? (job ? job.progress / job.hours : 0) : FW.condition(fw);
  if (!fw.built || f < 1) {
    ctx.beginPath(); ctx.arc(x, y, r + 2.2 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, f)));
    ctx.lineWidth = 2 * s; ctx.strokeStyle = !fw.built ? "#e0a84f" : f < 0.35 ? "#e2685f" : f < FW.FIELD.GOV.repairAt ? "#e0a84f" : "#6cc48a"; ctx.stroke();
  }
  ctx.font = `${Math.round(9 * s)}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  if (fw.kind === "snares") snareSprite(ctx, x - 0.5 * s, y + 0.8 * s, s * 0.62, color); // the 🪤 emoji (a mousetrap) read as anything but a snare
  else ctx.fillText(FW.FIELD.KINDS[fw.kind].icon, x, y + 0.5 * s);
  const duty = fw.kind === "tower" ? FW.lookouts(state, fw) : fw.kind === "roadblock" ? FW.guards(state, fw) : 0;
  if (duty) {
    ctx.beginPath(); ctx.arc(x + r * 0.8, y - r * 0.8, 3.6 * s, 0, Math.PI * 2); ctx.fillStyle = "#ffd166"; ctx.fill();
    ctx.fillStyle = "#111"; ctx.font = `bold ${Math.round(6 * s)}px sans-serif`; ctx.fillText(String(duty), x + r * 0.8, y - r * 0.8 + 0.3 * s);
  }
  ctx.restore();
}
// A watch tower of yours under the mouse or selected (and with the Tower sight layer on, every manned one): the ring of
// what its lookouts see now (towerRadius), faint gold when someone is on duty, grey dashed when not.
function sightRings(state, o) {
  const { ctx, G } = o;
  const tiles = new Set([o.hover, o.selected].filter((x) => x != null && x >= 0));
  if (!tiles.size && !o.sight) return;
  for (const fw of FW.playerWorks(state)) {
    if (fw.kind !== "tower" || !fw.built || !(tiles.has(fw.tile) || (o.sight && FW.manned(state, fw)))) continue; // o.sight: the Tower sight layer (every manned tower)
    const nb = state.grid.neighbors(fw.tile)[0];
    if (nb == null) continue;
    const step = Math.hypot(G.x[nb] - G.x[fw.tile], G.y[nb] - G.y[fw.tile]);
    const on = FW.manned(state, fw);
    const R = (FW.towerRadius(state) + 0.5) * step;
    ctx.save();
    ctx.beginPath(); ctx.arc(G.x[fw.tile], G.y[fw.tile], R, 0, Math.PI * 2);
    ctx.fillStyle = on ? "rgba(255,209,102,0.08)" : "rgba(160,166,172,0.06)"; ctx.fill();
    ctx.setLineDash(on ? [] : [6, 5]);
    ctx.lineWidth = 2; ctx.strokeStyle = on ? "rgba(255,209,102,0.7)" : "rgba(160,166,172,0.6)"; ctx.stroke();
    ctx.restore();
  }
}
function hex(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i + Math.PI / 6; const X = x + r * Math.cos(a), Y = y + r * Math.sin(a); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
  ctx.closePath();
}
// The snare line's sprite (WORLD-02: the old three grey stakes were lost on the map): a tuft of grass, a stake with
// the owner's tag, a sapling bent over it and a big bright wire noose hanging from its tip, each stroke edged dark so
// it reads on any ground. game: a catch in the noose.
function snareSprite(ctx, x, y, u, color, game = false) {
  const stroke = (w, c, draw) => { ctx.lineWidth = w * u; ctx.strokeStyle = c; ctx.beginPath(); draw(); ctx.stroke(); };
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.fillStyle = "#4f7a34";
  ctx.beginPath(); ctx.ellipse(x + 1 * u, y + 5.5 * u, 7 * u, 2 * u, 0, 0, Math.PI * 2); ctx.fill();
  const stake = () => { ctx.moveTo(x - 5 * u, y + 6 * u); ctx.lineTo(x - 5 * u, y - 6 * u); };
  const pole = () => { ctx.moveTo(x - 5 * u, y - 6 * u); ctx.quadraticCurveTo(x + 1 * u, y - 13 * u, x + 6 * u, y - 5.5 * u); };
  const noose = () => { ctx.moveTo(x + 6 * u, y - 5.5 * u); ctx.lineTo(x + 6 * u, y - 1.2 * u); ctx.moveTo(x + 9.4 * u, y + 1.8 * u); ctx.ellipse(x + 6 * u, y + 1.8 * u, 3.4 * u, 3 * u, 0, 0, Math.PI * 2); };
  stroke(3.2, "#1d1812", stake); stroke(1.9, "#8a6a45", stake);
  stroke(2.8, "#1d1812", pole); stroke(1.5, "#a8834f", pole);
  if (game) { ctx.fillStyle = "#c9a36b"; ctx.beginPath(); ctx.ellipse(x + 6 * u, y + 2.2 * u, 2.4 * u, 1.7 * u, 0, 0, Math.PI * 2); ctx.fill(); }
  stroke(2.6, "#1d1812", noose); stroke(1.3, "#eef3f6", noose);
  ctx.fillStyle = color; ctx.strokeStyle = "#1d1812"; ctx.lineWidth = 0.8 * u;
  ctx.fillRect(x - 7 * u, y - 9 * u, 4 * u, 3 * u); ctx.strokeRect(x - 7 * u, y - 9 * u, 4 * u, 3 * u);
  ctx.restore();
}
// The sprites, drawn in code: a lattice tower, a striped barrier, a well with its roof, a mast with its waves, crates.
function paint(ctx, fw, x, y, s, color) {
  const u = s;
  ctx.lineWidth = 1.2 * u;
  ctx.strokeStyle = "#2a2118";
  if (fw.kind === "tower") {
    ctx.fillStyle = "#8a6a45";
    ctx.beginPath(); ctx.moveTo(x - 5 * u, y + 6 * u); ctx.lineTo(x - 2.5 * u, y - 7 * u); ctx.lineTo(x + 2.5 * u, y - 7 * u); ctx.lineTo(x + 5 * u, y + 6 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 4 * u, y + 2 * u); ctx.lineTo(x + 3.2 * u, y - 3 * u); ctx.moveTo(x + 4 * u, y + 2 * u); ctx.lineTo(x - 3.2 * u, y - 3 * u); ctx.stroke();
    ctx.fillRect(x - 4.5 * u, y - 10 * u, 9 * u, 3.5 * u);
    ctx.fillStyle = color; ctx.fillRect(x - 5.5 * u, y - 12 * u, 11 * u, 2 * u);
  } else if (fw.kind === "roadblock") {
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? "#f2f2f2" : "#d2483c"; ctx.fillRect(x - 7 * u + i * 4.6 * u, y - 2 * u, 4.6 * u, 3.5 * u); }
    ctx.strokeRect(x - 7 * u, y - 2 * u, 14 * u, 3.5 * u);
    ctx.fillStyle = "#5a4632"; ctx.fillRect(x - 6 * u, y + 1.5 * u, 1.5 * u, 4 * u); ctx.fillRect(x + 4.5 * u, y + 1.5 * u, 1.5 * u, 4 * u);
  } else if (fw.kind === "well") {
    ctx.fillStyle = "#8f8f8f"; ctx.fillRect(x - 5 * u, y - 1 * u, 10 * u, 6 * u); ctx.strokeRect(x - 5 * u, y - 1 * u, 10 * u, 6 * u);
    ctx.fillStyle = "#3d7fc4"; ctx.fillRect(x - 3.5 * u, y - 0.5 * u, 7 * u, 1.5 * u);
    ctx.strokeStyle = "#5a4632"; ctx.beginPath(); ctx.moveTo(x - 4.5 * u, y - 1 * u); ctx.lineTo(x - 4.5 * u, y - 7 * u); ctx.moveTo(x + 4.5 * u, y - 1 * u); ctx.lineTo(x + 4.5 * u, y - 7 * u); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x - 6.5 * u, y - 6 * u); ctx.lineTo(x, y - 10 * u); ctx.lineTo(x + 6.5 * u, y - 6 * u); ctx.closePath(); ctx.fill();
  } else if (fw.kind === "relay") {
    ctx.strokeStyle = "#c9c9c9"; ctx.beginPath(); ctx.moveTo(x, y + 6 * u); ctx.lineTo(x, y - 10 * u); ctx.moveTo(x - 4 * u, y + 6 * u); ctx.lineTo(x, y - 4 * u); ctx.lineTo(x + 4 * u, y + 6 * u); ctx.stroke();
    ctx.strokeStyle = fw.offline ? "#777" : color;
    for (const r of [3, 5.5]) { ctx.beginPath(); ctx.arc(x, y - 10 * u, r * u, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke(); }
  } else if (fw.kind === "blind") { // a screened hide: a sloped frame under brush
    ctx.fillStyle = "#5d7a3a";
    ctx.beginPath(); ctx.moveTo(x - 7 * u, y + 5 * u); ctx.lineTo(x - 1 * u, y - 7 * u); ctx.lineTo(x + 7 * u, y + 5 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2a3518"; ctx.fillRect(x - 3 * u, y - 1 * u, 5 * u, 2 * u); // the slit
    ctx.fillStyle = color; ctx.fillRect(x - 1.5 * u, y - 9 * u, 3 * u, 2.5 * u);
  } else if (fw.kind === "snares") { // a spring snare: a stake, a bent sapling, a wire noose hanging from its tip
    // (a group's line shows game in the noose where you see it; yours shows none: unknown until a team checks it)
    snareSprite(ctx, x, y, u, color, fw.owner !== "player" && FW.snareHeld(fw) > 0);
  } else if (fw.kind === "cache") { // a drum half in the ground
    ctx.fillStyle = "#6b5a3a"; ctx.beginPath(); ctx.ellipse(x, y + 4 * u, 7 * u, 2.5 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b03a2e"; ctx.fillRect(x - 3.5 * u, y - 5 * u, 7 * u, 9 * u); ctx.strokeRect(x - 3.5 * u, y - 5 * u, 7 * u, 9 * u);
    ctx.strokeStyle = "#2a2118"; ctx.beginPath(); ctx.moveTo(x - 3.5 * u, y - 2 * u); ctx.lineTo(x + 3.5 * u, y - 2 * u); ctx.moveTo(x - 3.5 * u, y + 1 * u); ctx.lineTo(x + 3.5 * u, y + 1 * u); ctx.stroke();
    ctx.fillStyle = color; ctx.fillRect(x - 3.5 * u, y - 7 * u, 7 * u, 2 * u);
  } else if (fw.kind === "spikes") { // a row of stakes (grey when sprung)
    const live = FW.spikesLive(fw);
    ctx.fillStyle = live ? "#a07a4a" : "#77736c";
    for (const dx of [-6, -2, 2, 6]) { ctx.beginPath(); ctx.moveTo(x + dx * u - 1.6 * u, y + 5 * u); ctx.lineTo(x + dx * u + (live ? 0 : 2) * u, y - 5 * u); ctx.lineTo(x + dx * u + 1.6 * u, y + 5 * u); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = color; ctx.fillRect(x - 7 * u, y + 4 * u, 14 * u, 1.5 * u);
  } else if (fw.kind === "stockpile") {
    ctx.fillStyle = "#9b7a4c";
    ctx.fillRect(x - 6 * u, y - 1 * u, 6 * u, 6 * u); ctx.strokeRect(x - 6 * u, y - 1 * u, 6 * u, 6 * u);
    ctx.fillRect(x + 0.5 * u, y + 0.5 * u, 5 * u, 4.5 * u); ctx.strokeRect(x + 0.5 * u, y + 0.5 * u, 5 * u, 4.5 * u);
    ctx.fillRect(x - 4 * u, y - 6 * u, 5.5 * u, 5 * u); ctx.strokeRect(x - 4 * u, y - 6 * u, 5.5 * u, 5 * u);
    const full = FW.stockKg(fw) / FW.FIELD.KINDS.stockpile.capKg;
    if (full > 0) { ctx.fillStyle = color; ctx.fillRect(x + 2 * u, y - 4 * u, 4 * u * Math.min(1, full) + 0.5, 3 * u); }
  }
}

// ---------- a team at a structure (ui/teamctx.js) ----------
// The menu items: [{ key, label, order, why, hint }].
export function teamFieldItems(state, p, tile) {
  return FW.teamActs(state, p, tile).map((a) => ({ key: `fwork:${a.act}`, label: a.label, order: { type: "fwork", act: a.act }, why: a.why, hint: a.hint }));
}
export const fwTooltipLine = (state, tile) => FW.fwTooltip(state, tile);
export const survivorPostText = (state, s) => {
  if (!FW.onPost(s)) return "";
  const fw = FW.fwById(state, s.location.fw);
  return fw ? `Posted at the ${FW.kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}` : "Posted at a field work";
};
