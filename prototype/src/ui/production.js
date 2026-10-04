// Base screen pieces for production orders, power and stewards (src/sim/production.js, power.js, steward.js):
// the Order column of the Workshops tab, the drying racks' order, the Power card, the standing craft orders on the
// Crafting tab, the Steward card on the Overview tab and the pin toggle next to a person. Actions are merged into
// main.js's dispatcher (PROD_ACTIONS on click, PROD_CHANGE on change).
import { baseById, survivorById, atBase } from "../sim/world.js";
import { BUILDINGS, stations, count } from "../sim/buildings.js";
import { SKILL_NAMES } from "../sim/data.js";
import { CRAFTS, craftName, MAX_CRAFT_QUEUE } from "../sim/crafting.js";
import { ROLES } from "../sim/economy.js";
import {
  ORDER_MODES, FALLBACK_ROLES, QUALITY_STEPS, RACK, stationOrder, hasOrder, setStationOrder, clearStationOrder, orderHold,
  productKey, inputKeys, untilMargin, craftOrders, addCraftOrder, setCraftOrder, removeCraftOrder, craftOrderStatus, bestQuality,
} from "../sim/production.js";
import { POWER, POWER_USERS, STILL, powerStatus, refreshPower, generators } from "../sim/power.js";
import { STEWARD_AREAS, stewardOf, setSteward, setStewardArea, setStewardStyle, setPinned, stewardSummary, STEWARD_LOG_HOUR } from "../sim/steward.js";
import { PERSONALITIES, GOVERN_AREAS } from "../sim/autopilot.js";

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
  return `<h3>Steward</h3>
    <div class="card small prodctl">
      <div class="spread"><b>${s.on ? "A steward runs this base" : "You run this base"}</b><button class="${s.on ? "" : "primary"}" data-action="stw-toggle" data-base="${b.id}"${tip(s.on ? "Take over: the steward stops and everything stays as it is" : "Hand this base to a steward: it uses the governor's logic for the areas ticked below, every hour. You keep teams, trips, cards and the other bases; pinned people are left alone.")}>${s.on ? "Take over" : "Hand to a steward"}</button></div>
      ${state.autopilot ? `<div class="muted">The dev autopilot runs the whole holdout now; stewards wait until it is off.</div>` : ""}
      <div class="row" style="margin-top:0.3rem">Style <select data-action="stw-style" data-base="${b.id}"${tip("How careful the steward is (the governor's styles)")}>${Object.entries(PERSONALITIES).map(([k, p]) => `<option value="${k}" ${k === s.style ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="stwareas">${GOVERN_AREAS.map((k) => `<label${tip(STEWARD_AREAS[k].desc)}><input type="checkbox" data-action="stw-area" data-base="${b.id}" data-area="${k}" ${s.areas[k] ? "checked" : ""}> ${esc(STEWARD_AREAS[k].name)}</label>`).join("")}</div>
      ${s.on ? `<div class="muted">So far today: ${esc(stewardSummary(state, b))}. A summary goes to the log at ${STEWARD_LOG_HOUR}:00.</div>` : ""}
      ${s.last ? `<div class="muted">Last report: ${esc(s.last)}</div>` : ""}
      <div class="muted">${pinned.length ? `Pinned (never moved): ${pinned.map((x) => esc(first(x))).join(", ")}` : "Nobody is pinned. Pin someone in the list of people to keep a steward off them."}</div>
    </div>`;
}

export function pinButton(s) {
  return `<button class="mini${s.pinned ? " pinned" : ""}" data-action="pin" data-id="${s.id}"${tip(s.pinned ? "Pinned: stewards and the autopilot never change their role, station or gear. Click to unpin." : "Pin: stewards and the autopilot will never change this person's role, station or gear")}>${s.pinned ? "Pinned" : "Pin"}</button>`;
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
  "stw-style": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setStewardStyle(state, b, el.value)); },
};

