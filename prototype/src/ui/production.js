// Base screen pieces for production orders, power and stewards (src/sim/production.js, power.js, steward.js):
// the Order column of the Workshops tab, the drying racks' order, the Power card, the standing craft orders on the
// Crafting tab, the Steward card on the Overview tab and the pin toggle next to a person. Actions are merged into
// main.js's dispatcher (PROD_ACTIONS on click, PROD_CHANGE on change).
import { baseById, survivorById, atBase, skill } from "../sim/world.js";
import { BUILDINGS, stations, count } from "../sim/buildings.js";
import { SKILL_NAMES, SUPPLIES } from "../sim/data.js";
import { CRAFTS, craftName, MAX_CRAFT_QUEUE } from "../sim/crafting.js";
import { ROLES } from "../sim/economy.js";
import {
  ORDER_MODES, FALLBACK_ROLES, QUALITY_STEPS, RACK, stationOrder, hasOrder, setStationOrder, clearStationOrder, orderHold,
  productKey, inputKeys, untilMargin, craftOrders, addCraftOrder, setCraftOrder, removeCraftOrder, craftOrderStatus, bestQuality,
} from "../sim/production.js";
import { POWER, POWER_USERS, STILL, powerStatus, refreshPower, generators } from "../sim/power.js";
import { STEWARD_AREAS, stewardOf, setSteward, setStewardArea, setStewardStyle, setPinned, stewardSummary, STEWARD_LOG_HOUR, leaderChoices, leaderOf, leaderStatus, leaderScore, ledBy, setLeader, actingLeader, actsShare } from "../sim/steward.js";
import { LEADER_LIFT } from "../sim/morale.js";
import { PERSONALITIES } from "../sim/autopilot.js";
import { CALIBERS, AMMO_TYPES } from "../sim/data-ammo.js";
import { RELOAD, recipeList, inputsPer10, dayRate, handHq, reloadOrders, reloadJob, reloadBenches, setReloadOrder, removeReloadOrder, toggleReloadOrder, handMake } from "../sim/reloading.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];
const pct = (q) => `${Math.round(q * 100)}%`;
// Default amounts when an order is switched to Until / Keep.
const UNTIL_N = { ammo: 200, meds: 10, parts: 8, preserved: 100, fuel: 30 };
const KEEP_N = { scrap: 30, food: 60, fuel: 10, water: 20, jars: 4 };
const stationOf = (b, id) => (id === "rack" ? RACK : stations(b).find((x) => x.id === Number(id)));

// ---------- Workshops tab ----------
// The Order cell of a station row: mode, amount, input, fallback; who set it.
export function orderCell(state, b, st) {
  const o = stationOrder(b, st);
  const prod = productKey(st);
  const ins = inputKeys(st);
  const isRack = st.id === RACK.id;
  const sid = isRack ? "rack" : st.id;
  const data = `data-base="${b.id}" data-station="${sid}"`;
  const modes = Object.entries(ORDER_MODES).filter(([k]) => k !== "until" || prod);
  const hold = orderHold(state, b, st);
  const parked = isRack ? [] : atBase(state, b.id).filter((x) => x.parked && x.parked.from === st.id);
  const n = (o.mode === "until" || o.mode === "keep")
    ? `<input type="number" min="0" max="99999" step="1" class="po-n" data-action="po-n" ${data} value="${o.n}"${tip(o.mode === "until" ? `Stop at this many ${prod} here; start again below ${Math.max(0, o.n - untilMargin(o.n))} (10% under)` : `Never take the ${o.key} here below this`)}>` : "";
  const what = o.mode === "until" ? `<span>${esc(prod)}</span>`
    : o.mode === "keep" ? (ins.length > 1 ? `<select data-action="po-key" ${data}${tip("The input to keep")}>${ins.map((k) => `<option value="${k}" ${k === o.key ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>` : `<span>${esc(ins[0] || "")}</span>`) : "";
  const fbOpts = [["idle", "Idle at the station"], ...FALLBACK_ROLES.map((k) => [k, `Go to ${ROLES[k] ? ROLES[k].name : k}`]),
    ...stations(b).filter((x) => x.id !== st.id && BUILDINGS[x.type].station !== "power").map((x) => [`st:${x.id}`, `Run the ${BUILDINGS[x.type].name.toLowerCase()}`])];
  const fb = isRack || o.mode === "forever" ? "" : `<div class="row po-fb">When it stops: <select data-action="po-fb" ${data}${tip("What the operator does while this order holds the station. They come back by themselves when it wants work again. While a steward (Roles) or the autopilot runs this base, they decide.")}>${fbOpts.map(([k, l]) => `<option value="${k}" ${k === o.fallback ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
  const who = hasOrder(b, st) ? (o.by === "ai" ? `<span class="chip"${tip("Set by this base's steward (or the autopilot). Change it and it becomes yours: stewards leave your orders alone.")}>steward</span>` : `<button class="mini" data-action="po-reset" ${data}${tip("Clear your order: back to Forever, or to what the steward decides")}>Reset</button>`) : "";
  return `<div class="prodctl">
    <div class="row"><select data-action="po-mode" ${data}${tip(Object.values(ORDER_MODES).map((m) => `${m.name}: ${m.desc}`).join(" "))}>${modes.map(([k, m]) => `<option value="${k}" ${k === o.mode ? "selected" : ""}>${esc(m.name.replace(/ N.*$/, "").replace(/ of an input$/, ""))}</option>`).join("")}</select>${n}${what}${who}</div>
    ${fb}${hold ? `<div class="small muted">${esc(hold)}</div>` : ""}${parked.length ? `<div class="small muted">${parked.map((x) => `${esc(first(x))} ${x.role === "operate" ? "runs another station" : `is on ${esc(ROLES[x.role] ? ROLES[x.role].name : x.role)}`}`).join(", ")} until it is needed again</div>` : ""}
  </div>`;
}

// The drying racks have no operator, but they take an order too.
export function racksCard(state, b) {
  const racks = count(b, "smoker");
  if (!racks) return "";
  return `<h3>Drying racks</h3><div class="card small"><div class="spread"><b>${racks} drying rack${racks === 1 ? "" : "s"}</b><span class="muted">no operator · surplus food → preserved</span></div>${orderCell(state, b, RACK)}</div>`;
}

// Supply and demand, the generators and every powered building with its switch.
export function powerCard(state, b) {
  const gens = generators(b);
  const users = b.buildings.filter((x) => POWER_USERS[x.type]);
  const usesText = Object.entries(POWER_USERS).map(([k, u]) => `${BUILDINGS[k].name} (${u.need}): ${u.what}`).join("; ");
  if (!gens.length && !users.length) return `<h3>Power</h3><div class="small muted"${tip(usesText)}>No generator and nothing to power. A generator (Construction) burns ${POWER.genFuel} fuel a day for ${POWER.genOut} power and needs an operator; an ethanol still makes fuel from surplus or spoiled food.</div>`;
  const ps = powerStatus(state, b);
  const row = (u) => {
    const d = BUILDINGS[u.b.type];
    const st = u.off ? `<span class="chip off">Switched off</span>` : u.served ? `<span class="chip on">Powered</span>` : u.wants ? `<span class="chip off"${tip("Not enough power: build or staff another generator, or switch something off")}>No power</span>` : `<span class="chip"${tip("A workshop station draws power only while its operator works it")}>Not working</span>`;
    return `<tr><td${tip(`${d.desc} Powered: ${POWER_USERS[u.b.type].what}.`)}>${esc(d.name)}</td><td>${u.need}</td><td class="small">${esc(POWER_USERS[u.b.type].what)}</td><td>${st}</td><td><button class="mini" data-action="pw-toggle" data-base="${b.id}" data-id="${u.b.id}"${tip(u.off ? "Let it draw power again" : "Switch its power off (saves fuel)")}>${u.off ? "Switch on" : "Switch off"}</button></td></tr>`;
  };
  const cls = ps.demand > ps.supply ? "danger" : "";
  return `<h3>Power</h3>
    <div class="card small">
      <div class="spread"><b class="${cls}">${ps.supply} supply / ${ps.demand} demand</b><span class="muted">${ps.running} of ${gens.length} generator${gens.length === 1 ? "" : "s"} running · ${ps.fuelPerDay} fuel a day · +${ps.heat} Heat · ${Math.floor(b.stock.fuel || 0)} fuel here</span></div>
      ${gens.length ? "" : `<div class="danger">No generator: build one in Construction (Mechanics 3+).</div>`}
      ${users.length ? `<table class="t"><tr><th>Building</th><th${tip("Power it draws")}>Need</th><th>With power</th><th>Status</th><th></th></tr>${ps.users.map(row).join("")}</table>` : `<div class="muted">Nothing here draws power yet. ${esc(usesText)}.</div>`}
      <div class="muted" style="margin-top:0.3rem">A generator runs only while something draws power and burns its ${POWER.genFuel} fuel for the day when it starts. Each generator and each powered station needs its operator (Operate role). The still turns 8 food (up to ${STILL.mash} of it yesterday's spoiled food) and 2 water into 3 fuel a day.</div>
    </div>`;
}

// ---------- the reloading bench (sim/reloading.js) ----------
// Default "keep at least" when an order is added, by type.
const RELOAD_N = { hp: 100, slug: 25, ap: 60, match: 40, subsonic: 50, sp: 60, bird: 50, buck: 100, fmj: 200 };
const n0r = (v) => Math.floor((v || 0) + 1e-9);
// The reloading card on the Workshops tab: the inputs in stock, the standing "keep at least N" orders and what the
// bench does with them today, and every recipe by calibre (inputs per 10, rounds a day, the Mechanics it needs).
export function reloadCard(state, b) {
  const benches = reloadBenches(b);
  if (!benches.length) return count(b, "ammo_bench") ? `<h3>Reloading</h3><div class="small muted">Upgrade an ammo bench into a reloading bench (Construction, on its utility plot: 1 machine part, 3 gun parts, 20 scrap, ${RELOAD.UP.hours} work-hours, a Mechanics 3+ survivor here) to load hollow points, slugs, match and AP rounds from brass, powder and primers.</div>` : "";
  const st = b.stock;
  const ops = benches.map((x) => atBase(state, b.id).find((s) => s.role === "operate" && s.station === x.id && !s.inBed)).filter(Boolean);
  const op = ops.sort((a, c) => skill(c, "mechanics") - skill(a, "mechanics"))[0] || null;
  const m = op ? skill(op, "mechanics") : 0;
  const R = b.reload || { wear: 0 };
  const stockLine = [
    `<b>${n0r(st.brass)}</b> brass`,
    `<b>${n0r(st.powder)}</b> powder charges${st.blackpowder >= 1 ? ` (+${n0r(st.blackpowder)} black)` : ""}`,
    `<b>${n0r(st.primers)}</b> primers${st.matchprimers >= 1 ? ` (+${n0r(st.matchprimers)} match-head)` : ""}`,
    `<b>${n0r(st.scrap)}</b> scrap`, `<b>${n0r(st.gunparts)}</b> gun parts`,
  ].join(" · ");
  const rows = reloadJob(state, b, op, true);
  const orderRows = rows.map((r) => {
    const o = r.order, key = o.key, data = `data-base="${b.id}" data-id="${o.id}"`;
    const hk = key + "_hand", hm = SUPPLIES[hk] ? handMake(state, hk) : null;
    const hand = SUPPLIES[hk] && st[hk] >= 1 ? ` <span class="muted"${tip(`Handloads here: quality ${pct(hm.hq)}${hm.bp ? `, ${pct(hm.bp)} black powder` : ""}${hm.mp ? `, ${pct(hm.mp)} match-head primers` : ""}${hm.lo ? `, ${pct(hm.lo)} loaded below Mechanics 8 (aim −1)` : ""}`)}>(${n0r(st[hk])} handloads)</span>` : "";
    return `<div class="spread small prodctl"><span>Keep <input type="number" min="0" max="${RELOAD.ORDER_MAX}" step="10" class="po-n" data-action="rl-n" ${data} data-key="${key}" value="${o.n}"${tip("Rounds of this calibre and type to keep at this base (its handloads count)")}> <b>${esc(SUPPLIES[key].name)}</b> · have ${r.have ?? 0}${hand}${o.by === "ai" ? ` <span class="chip"${tip("Set by this base's steward (or the autopilot). Change it and it becomes yours.")}>steward</span>` : ""}</span>
      <span class="row"><span class="${r.n ? "good" : "muted"}">${r.n ? `+${r.n} today` : esc(r.reason)}</span><button class="mini" data-action="rl-toggle" ${data}>${o.on ? "Pause" : "Resume"}</button><button class="mini" data-action="rl-del" ${data}>Remove</button></span></div>`;
  }).join("");
  const have = new Set(reloadOrders(b).map((o) => o.key));
  const recipes = recipeList();
  const opts = recipes.map((g) => `<optgroup label="${esc(CALIBERS[g.cal].name)}">${g.types.filter((t) => !have.has(t.key)).map((t) => `<option value="${t.key}">${esc(SUPPLIES[t.key].name)}</option>`).join("")}</optgroup>`).join("");
  const table = recipes.map((g) => `<tr><td colspan="4"><b>${esc(CALIBERS[g.cal].name)}</b></td></tr>${g.types.map((t) => {
    const inp = inputsPer10(g.cal, t.type);
    const lock = m < t.min;
    const ins = `${inp.brass} brass, ${inp.primers} primers, ${Math.round(inp.powder * 10) / 10} powder, ${inp.scrap} scrap${inp.parts ? `, ${inp.parts} machine parts` : ""}`;
    return `<tr class="${lock ? "muted" : ""}"><td>${esc(AMMO_TYPES[t.type].name)}${t.ap ? `<span class="small muted"${tip("AP needs a machine shop here (steel cores: a machine part per 20)")}> (machine shop)</span>` : ""}</td><td class="small">${ins}</td><td>${dayRate(t.rate, m)}/day</td><td class="small">${lock ? `<span class="warn">Mechanics ${t.min}</span>` : `Mechanics ${t.min} · hand q ${pct(handHq(m))}`}</td></tr>`;
  }).join("")}`).join("");
  return `<h3>Reloading</h3>
    <div class="card small prodctl">
      <div class="spread"><b>${benches.length} reloading bench${benches.length === 1 ? "" : "es"}</b><span class="muted">${op ? `${esc(op.name)} (Mechanics ${m})` : "no operator (Operate role)"} · dies worn ${n0r(R.wear)}/${RELOAD.WEAR} rounds</span></div>
      <div>${stockLine}</div>
      <div class="muted" style="margin:0.2rem 0">Each day the bench works the order furthest short that it can make; with none it makes common rounds from scrap like an ammo bench. Per round: a case, a primer, its powder; a scrap per ${RELOAD.LEAD} bullets; a gun part per ${RELOAD.WEAR} rounds (the dies). Typed rounds come out as handloads: they jam ×(2.5 − 1.5 × quality), quality 0.6 + 0.03 × Mechanics; loaded below Mechanics 8 they aim 1 worse. Black powder (jams ×1.5, louder) and match-head primers (×3) are used only when the factory ones run out. Brass comes back after a won fight.</div>
      ${orderRows || `<div class="muted">No reloading orders: the bench makes common rounds.</div>`}
      ${opts ? `<div class="row" style="margin-top:0.3rem"><select data-action="rl-add" data-base="${b.id}"${tip("Add a standing order: keep at least this many rounds of a calibre and type here")}><option value="">Add a reloading order…</option>${opts}</select></div>` : ""}
      <details style="margin-top:0.3rem"><summary>Recipes (inputs per 10 rounds, rounds a day for ${op ? esc(op.name.split(" ")[0]) : "Mechanics 0"})</summary><table class="t">${table}</table></details>
    </div>`;
}

// ---------- Crafting tab ----------
export function craftOrdersCard(state, b) {
  const list = craftOrders(b);
  const free = Object.keys(CRAFTS).filter((k) => !list.some((o) => o.recipe === k));
  const rows = list.map((o) => {
    const r = CRAFTS[o.recipe];
    const cs = craftOrderStatus(state, b, o);
    const q = r.gear ? bestQuality(state, b, o.recipe) : null;
    const data = `data-base="${b.id}" data-id="${o.id}"`;
    const qSel = r.gear ? `<select data-action="co-q" ${data}${tip("Minimum quality (condition) of the item. Only items at this quality or better count toward the target, and a job is only queued and worked when a crafter here reaches it (their expected quality from skill). The best here now makes it at " + (q != null ? pct(q) : "—") + ".")}>${QUALITY_STEPS.map((x) => `<option value="${x}" ${x === (o.minQ || 0) ? "selected" : ""}>${x ? `${pct(x)}+` : "any quality"}</option>`).join("")}</select>` : `<span class="muted">${esc(Object.keys(r.supplies).join(", "))} in stock</span>`;
    return `<div class="card small prodctl">
      <div class="spread"><b>${esc(craftName(o.recipe))}</b><span><button class="mini" data-action="co-toggle" ${data}${tip(o.on ? "Pause this order (queued jobs stay)" : "Resume this order")}>${o.on ? "Pause" : "Resume"}</button><button class="mini" data-action="co-del" ${data}${tip("Remove this order (queued jobs stay in the queue)")}>Remove</button></span></div>
      <div class="row">Keep <input type="number" min="0" max="99" step="1" class="po-n" data-action="co-n" ${data} value="${o.n}"${tip(r.gear ? "Items of this kind to keep in the armory" : "Stock to keep")}> ${qSel}</div>
      <div class="${cs.ready || /^Stocked|queue/.test(cs.reason) ? "muted" : "danger"}">Have ${cs.have} of ${o.n}${cs.reason ? ` · ${esc(cs.reason)}` : cs.ready ? " · queues a job within the hour" : ""}</div>
    </div>`;
  }).join("");
  return `<h3>Standing orders</h3>
    <div class="small muted" style="margin-bottom:0.3rem">Keep N of an item in the armory: whenever there are fewer (at the quality you ask), one job is queued (materials paid then). Takes from the queue's ${MAX_CRAFT_QUEUE}-job limit.</div>
    ${rows || `<div class="muted small">No standing craft orders.</div>`}
    ${free.length ? `<div class="prodctl" style="margin-top:0.3rem"><select data-action="co-add" data-base="${b.id}"${tip("Add a repeating order: keep a number of this item in the armory")}><option value="">Add a standing order…</option>${free.map((k) => `<option value="${k}">${esc(craftName(k))} (${SKILL_NAMES[CRAFTS[k].skill]} ${CRAFTS[k].min}+)</option>`).join("")}</select></div>` : ""}`;
}

// ---------- Overview tab ----------
export function stewardCard(state, b) {
  const s = stewardOf(b);
  const pinned = atBase(state, b.id).filter((x) => x.pinned);
  const L = leaderOf(state, b);
  const where = leaderStatus(state, b);
  const choices = leaderChoices(state, b);
  if (L && !choices.includes(L)) choices.push(L); // away: still listed
  const label = (x) => {
    const other = ledBy(state, x);
    return `${x.name} (Leadership ${skill(x, "leadership")}, Speech ${skill(x, "speech")})${other && other !== b ? ` · leads ${other.name}` : ""}`;
  };
  const pick = `<select data-action="stw-leader" data-base="${b.id}"${tip("Who leads this base: one of the people living here. The best by Leadership (Speech counts half) is picked for you if you hand it over without choosing. The leader keeps their own work and is never sent out by the base; while they are away the next best here stands in, and if they die or move the next best takes over. A person leads one base. Their Leadership lifts everyone's mood here (0.15 a day a point), and under Leadership 5 they are slow to act: some hours nothing gets done.")}>
      ${s.on ? "" : `<option value="" ${L ? "" : "selected"}>No leader</option>`}
      ${choices.map((x) => `<option value="${x.id}" ${L === x ? "selected" : ""}>${esc(label(x))}</option>`).join("")}
    </select>`;
  const best = choices.slice().sort((x, y) => leaderScore(y) - leaderScore(x))[0];
  const A = actingLeader(state, b);
  const runs = s.on ? (where === "away" ? (A ? `${esc(L.name)} is away: ${esc(A.name)} stands in` : `${esc(L.name)} is away: ${esc(b.name)} waits for them`) : `${esc(L ? L.name : "The leader")} runs this base`) : "You run this base";
  // What the leader's Leadership does (morale.js crowdInfo; steward.js actsShare).
  const lead = L ? skill(L, "leadership") : 0;
  const groupLeaderHere = atBase(state, b.id).some((x) => x.leader && x.alive);
  const effects = [];
  if (L && where === "here" && !groupLeaderHere && lead > 0) effects.push(`everyone here +${(lead * LEADER_LIFT).toFixed(1)} mood a day while ${esc(first(L))} is here`);
  if (L && groupLeaderHere && !L.leader) effects.push("the group's leader lives here, so their mood lift counts instead");
  const share = A ? actsShare(A) : L ? actsShare(L) : 1;
  if (share < 1) effects.push(`<span class="warn">slow to act: gets things done about ${Math.round(share * 100)}% of the hours (Leadership under 5)</span>`);
  const name = L ? first(L) : best ? first(best) : "a leader";
  return `<h3>Base leader</h3>
    <div class="card small prodctl">
      <div class="row">Leader ${pick}</div>
      ${effects.length ? `<div class="muted">${effects.join(" · ")}</div>` : ""}
      <div class="spread" style="margin-top:0.3rem"><b>${runs}</b><button class="${s.on ? "" : "primary"}" data-action="stw-toggle" data-base="${b.id}"${tip(s.on ? "Take over: the leader stops running it and everything stays as it is" : `Let ${name} run this base: keep people safe and supplied with the governor's logic for the areas ticked below, every hour: roles, building, crafting, the sick, defence and warnings, emergency hauls, trading, supply runs to outposts, hunting, fishing and firewood. Nothing drastic: no scavenging trips, wars, new outposts, people moved or bases left. You keep teams, cards and the other bases; pinned people are left alone.`)}>${s.on ? "Take over" : `Let ${esc(name)} run it`}</button></div>
      ${state.autopilot ? `<div class="muted">The dev autopilot runs the whole holdout now; base leaders wait until it is off.</div>` : ""}
      <div class="row" style="margin-top:0.3rem">Style <select data-action="stw-style" data-base="${b.id}"${tip("How careful the leader is (the governor's styles)")}>${Object.entries(PERSONALITIES).map(([k, p]) => `<option value="${k}" ${k === s.style ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="stwareas">${Object.keys(STEWARD_AREAS).map((k) => `<label${tip(STEWARD_AREAS[k].desc)}><input type="checkbox" data-action="stw-area" data-base="${b.id}" data-area="${k}" ${s.areas[k] ? "checked" : ""}> ${esc(STEWARD_AREAS[k].name)}</label>`).join("")}</div>
      ${s.on ? `<div class="muted">So far today: ${esc(stewardSummary(state, b))}. A summary goes to the log at ${STEWARD_LOG_HOUR}:00.</div>` : ""}
      ${s.last ? `<div class="muted">Last report: ${esc(s.last)}</div>` : ""}
      <div class="muted">${pinned.length ? `Pinned (never moved): ${pinned.map((x) => esc(first(x))).join(", ")}` : "Nobody is pinned. Pin someone in the list of people to keep the leader off them."}</div>
    </div>`;
}

export function pinButton(s) {
  return `<button class="mini${s.pinned ? " pinned" : ""}" data-action="pin" data-id="${s.id}"${tip(s.pinned ? "Pinned: base leaders and the autopilot never change their role, station or gear. Click to unpin." : "Pin: base leaders and the autopilot will never change this person's role, station or gear")}>${s.pinned ? "Pinned" : "Pin"}</button>`;
}

// ---------- actions ----------
const baseOf = (state, d) => baseById(state, Number(d.base));
const say = (ui, msg) => { if (msg) ui.baseMsg = msg; };

export const PROD_ACTIONS = {
  "po-reset": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, clearStationOrder(state, b, d.station)); },
  "pw-toggle": (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    b.powerOff = b.powerOff || {};
    const id = Number(d.id);
    if (b.powerOff[id]) delete b.powerOff[id]; else b.powerOff[id] = true;
    refreshPower(state, b);
    const x = b.buildings.find((y) => y.id === id);
    say(ui, x ? `${BUILDINGS[x.type].name}: power ${b.powerOff[id] ? "switched off" : "on"}.` : "");
  },
  "co-toggle": (state, ui, d) => { const b = baseOf(state, d); const o = b && craftOrders(b).find((x) => x.id === Number(d.id)); if (o) say(ui, setCraftOrder(state, b, o.id, { on: !o.on }) || `Order ${o.on ? "resumed" : "paused"}.`); },
  "co-del": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, removeCraftOrder(state, b, d.id)); },
  "stw-toggle": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, setSteward(state, b, !stewardOf(b).on)); },
  "stw-area": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, setStewardArea(state, b, d.area, !stewardOf(b).areas[d.area])); },
  "rl-del": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, removeReloadOrder(state, b, d.id)); },
  "rl-toggle": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, toggleReloadOrder(state, b, d.id)); },
  pin: (state, ui, d) => { const s = survivorById(state, Number(d.id)); if (s) say(ui, setPinned(state, s, !s.pinned)); },
};

export const PROD_CHANGE = {
  "po-mode": (state, ui, el) => {
    const b = baseOf(state, el.dataset);
    const st = b && stationOf(b, el.dataset.station);
    if (!st) return;
    const mode = el.value;
    const cur = stationOrder(b, st);
    const patch = { mode };
    if (mode === "until" && (cur.mode !== "until" || !cur.n)) patch.n = UNTIL_N[productKey(st)] ?? 20;
    if (mode === "keep" && (cur.mode !== "keep" || !cur.n)) patch.n = KEEP_N[cur.key] ?? 10;
    say(ui, setStationOrder(state, b, el.dataset.station, patch));
  },
  "po-n": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setStationOrder(state, b, el.dataset.station, { n: el.value })); },
  "po-key": (state, ui, el) => {
    const b = baseOf(state, el.dataset);
    if (b) say(ui, setStationOrder(state, b, el.dataset.station, { key: el.value, n: KEEP_N[el.value] ?? 10 }));
  },
  "po-fb": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setStationOrder(state, b, el.dataset.station, { fallback: el.value })); },
  "co-add": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b && el.value) say(ui, addCraftOrder(state, b, el.value, 2, 0)); },
  "co-n": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setCraftOrder(state, b, el.dataset.id, { n: el.value })); },
  "co-q": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setCraftOrder(state, b, el.dataset.id, { minQ: el.value })); },
  "rl-add": (state, ui, el) => { const b = baseOf(state, el.dataset); const r = el.value && SUPPLIES[el.value] && SUPPLIES[el.value].round; if (b && r) say(ui, setReloadOrder(state, b, el.value, RELOAD_N[r.type] ?? 50)); },
  "rl-n": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b && el.dataset.key) say(ui, setReloadOrder(state, b, el.dataset.key, el.value)); },
  "stw-style": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setStewardStyle(state, b, el.value)); },
  "stw-leader": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setLeader(state, b, el.value)); },
};

