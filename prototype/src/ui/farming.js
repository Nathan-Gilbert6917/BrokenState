// Base screen: Farming tab (crop plots, the food and water outlook, the crop guide) and the short food / water
// lines used by the Bases list and the top bar. Actions are merged into main.js's dispatcher (FARM_ACTIONS,
// FARM_CHANGE).
import {
  CROPS, CROP_KEYS, farmOf, careToday, expectedYield, daysToRipe, plotWeatherNote, plantCheck, bestCrop, plantPlot,
  harvestPlot, clearPlot, setPlotWant, setAutoReplant, plotLimit, greenhouseLimit, siteFarm, farmers, recentGrowth,
  cropForecast, winterOutlook,
} from "../sim/farming.js";
import { foodOutlook, waterOutlook, RATION, RATION_DAYS } from "../sim/economy.js";
import { storeLine } from "../sim/storage.js";
import { baseById, atBase } from "../sim/world.js";
import { count } from "../sim/buildings.js";
import * as Weather from "../sim/weather.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const days = (d) => (!isFinite(d) ? "∞" : d >= 99 ? "99+" : n0(d));
const SEASON_NAMES = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };

// ---------- short lines (Bases list, overview, top bar) ----------
// Food: the forecast line that replaces "food per day".
export function foodLine(state, b) {
  const o = foodOutlook(state, b);
  const sl = storeLine(state, b);
  const next = o.harvests[0];
  const text = `${n0(o.stock)} in store (${n0(o.fresh)} fresh + ${n0(o.preserved)} preserved) · eaten ${n1(o.eat)}/day · spoils ${n1(o.spoil)}/day${o.used > 0.05 ? ` · workshops ${n1(o.used)}/day` : ""} · ${days(o.daysLeft)} days left without harvests`;
  const nextText = next ? `next harvest: ${next.name} in ${next.inDays} day${next.inDays === 1 ? "" : "s"} (~${n0(next.food)} food)` : "nothing growing";
  const why = `Crops do not give food every day: each plot is harvested once, when it ripens (Farming tab). ${text}. Fresh food ${sl.short}. Expected from the plots over the next 30 days: about ${n1(o.farm)} a day. ${nextText}.${b.rationing ? ` On short rations (${Math.round(RATION * 100)}%): under ${RATION_DAYS} days of food.` : ""}${o.store.outside >= 1 ? " The stores are full: food stored outside spoils fast." : ""} Loot brought home by teams and convoys comes on top. ${sl.tip}`;
  const cls = o.daysLeft < 7 || o.store.outside >= 1 ? "danger" : o.daysLeft < 20 ? "" : "good";
  return { cls, short: `${days(o.daysLeft)}d · ${next ? `${next.name} in ${next.inDays}d` : "no crops"}`, text: `${text}; ${nextText}`, tip: why };
}
export const foodCellHtml = (state, b) => { const f = foodLine(state, b); return `<div class="${f.cls}"${tip(f.tip)}>${esc(f.short)}</div>`; };
// Food storage for the base panel: "in cellar 180/200, outside 40 (spoiling 2.3/day)" and the preserved stock.
export const storeCellHtml = (state, b) => { const sl = storeLine(state, b); return `<div class="${sl.cls}"${tip(sl.tip)}>${esc(sl.short)}<div class="small muted">${esc(sl.pres)}</div></div>`; };

// The winter outlook (farming.js winterOutlook), one line: food to reach the first spring harvest against what
// is in store and in the ground.
export function winterLine(state, b) {
  const w = winterOutlook(state, b);
  const firstHarvest = w.gap.end + 1;
  const tipText = `Planning figure for ${b.name}: from today to the first spring harvest (around day ${firstHarvest}; winter starts on day ${w.gap.start + 1}) the ${w.people} here eat about ${w.need} (more in the cold) and about ${w.spoil} spoils on the way. In store: ${w.have}. The crops in the ground (and one more sowing of the free plots) should bring about ${w.crops}, by the usual weather and the chance they survive. Seed for the spring sowing: ${w.seed}. ${w.short > 0 ? `Short by about ${w.short}${w.runsOut != null ? `: the food runs out around day ${w.runsOut + 1}` : ""}.` : `About ${Math.max(0, w.end)} to spare.`} Loot, trade and crops sown later come on top. Keep the winter stock in a cellar (or preserve it): food stored outside spoils fast.`;
  const text = w.short > 0 ? `short by ~${w.short} (runs out ~day ${(w.runsOut ?? w.gap.end) + 1})` : `enough (~${Math.max(0, w.end)} to spare)`;
  return { w, text: `${text} · need ~${w.need} to day ${firstHarvest}`, tip: tipText, cls: w.short > 0 ? "danger" : "good" };
}

export function waterLine(state, b) {
  const o = waterOutlook(state, b);
  const p = o.prod;
  const ins = [`well ${n1(p.own)}`, p.stream ? `stream ${n1(p.stream)}` : "", p.wells ? `wells ${n1(p.wells)}` : "", p.rain ? `rain ${n1(p.rain)}` : "", p.filters ? `filters ${p.filters}` : ""].filter(Boolean).join(", ");
  const why = `In: ${ins} (${n1(o.inflow)}/day; the well and rain only fill up to the capacity of ${o.cap}). Out: people ${n1(o.need.people)}${o.need.hot ? " (hot day: 1.5 each)" : ""}, crops ${n1(o.need.crops)} (none on a rainy day). On a dry day the balance is ${o.dryNet >= 0 ? "+" : ""}${n1(o.dryNet)}. A base that runs dry goes thirsty: everyone loses health every day and nobody heals. Wells, rain catchers and cisterns (Construction) help; a water filter adds 3 a day and cuts dysentery.`;
  const cls = o.daysLeft < 5 ? "danger" : o.net < 0 ? "" : "good";
  return { cls, short: `${o.net >= 0 ? "+" : ""}${n1(o.net)}/day · ${n0(o.stock)}/${o.cap}${isFinite(o.daysLeft) ? ` · ${days(o.daysLeft)}d left` : ""}`, tip: why };
}
export const waterCellHtml = (state, b) => { const w = waterLine(state, b); return `<div class="${w.cls}"${tip(w.tip)}>${esc(w.short)}</div>`; };

// Days left for the top bar's tooltip.
export function hubSupplyTip(state, b, key) {
  if (key === "food") return foodLine(state, b).tip;
  if (key === "water") return waterLine(state, b).tip;
  return "";
}

// ---------- the Farming tab ----------
const STAGE = { empty: "Empty", growing: "Growing", ripe: "Ripe", dead: "Dead" };

function cropOptions(selected, gh, state, b, p) {
  return `<option value="">Farmers pick</option>` + CROP_KEYS.map((k) => {
    const chk = plantCheck(state, b, { ...p, stage: "empty" }, k);
    return `<option value="${k}" ${selected === k ? "selected" : ""}>${esc(CROPS[k].name)}${chk.ok ? "" : " (not now)"}</option>`;
  }).join("");
}

export function baseFarming(state, b) {
  const f = farmOf(state, b);
  const care = careToday(state, b);
  const fo = foodOutlook(state, b);
  const wo = waterOutlook(state, b);
  const s = Weather.season ? Weather.season(state) : null;
  const wx = Weather.weatherSummary ? Weather.weatherSummary(state) : "";
  const wxTip = Weather.weatherReport ? Weather.weatherReport(state) : "";
  const workers = farmers(state, b);
  const anyFarmer = workers.length > 0;
  const rows = f.plots.map((p) => {
    const c = p.crop ? CROPS[p.crop] : null;
    const pct = c ? Math.min(100, (p.grown / c.days) * 100) : 0;
    const exp = c ? (p.stage === "ripe" ? p.yieldLeft : expectedYield(state, b, p, care.care)) : 0;
    const note = plotWeatherNote(state, b, p);
    const warn = /risk|short|out of season|not growing|left to harvest/.test(note);
    const pick = p.want || (p.stage === "empty" || p.stage === "dead" ? bestCrop(state, b, p) : null);
    const chk = pick ? plantCheck(state, b, { ...p, stage: "empty" }, pick) : { ok: false, reason: "Nothing would ripen before its season ends" };
    const plantable = p.stage === "empty" || p.stage === "dead";
    const actions = [
      plantable ? `<button class="mini" data-action="farm-plant" data-base="${b.id}" data-plot="${p.id}" ${anyFarmer && chk.ok && p.stage === "empty" ? "" : "disabled"}${tip(!anyFarmer ? "Nobody is on the Farm role here." : p.stage === "dead" ? "Clear the dead crop first." : chk.ok ? `Sow ${CROPS[pick].name.toLowerCase()} now (${CROPS[pick].seed} food as seed).` : chk.reason)}>Plant${pick && chk.ok ? ` ${esc(CROPS[pick].name)}` : ""}</button>` : "",
      p.stage === "ripe" ? `<button class="mini" data-action="farm-harvest" data-base="${b.id}" data-plot="${p.id}" ${anyFarmer ? "" : "disabled"}${tip(anyFarmer ? `Bring in about ${n0(p.yieldLeft)} food now. Farmers harvest ripe plots by themselves each day too (3 plots per farmer).` : "Nobody is on the Farm role here.")}>Harvest</button>` : "",
      p.stage !== "empty" ? `<button class="mini" data-action="farm-clear" data-base="${b.id}" data-plot="${p.id}"${tip(p.stage === "dead" ? "Dig the dead crop under so the plot can be sown again." : "Dig this crop under (it is lost).")}>Clear</button>` : "",
    ].join(" ");
    return `<tr>
      <td>${p.id}${p.gh ? ` <span class="chip on"${tip("Greenhouse plot: grows in every season and the weather rarely harms it")}>glass</span>` : ""}</td>
      <td${tip(c ? c.desc : "")}>${c ? esc(c.name) : "<span class='muted'>—</span>"}</td>
      <td style="min-width:7rem">${STAGE[p.stage]}${c && p.stage === "growing" ? bar(pct, "var(--good)") : ""}${p.note && p.stage !== "growing" ? `<div class="small muted">${esc(p.note)}</div>` : ""}</td>
      <td>${p.stage === "growing" ? `~${daysToRipe(p)}d` : p.stage === "ripe" ? "ready" : "—"}</td>
      <td>${c && (p.stage === "growing" || p.stage === "ripe") ? `~${n0(exp)}` : "—"}</td>
      <td class="small ${warn ? "danger" : "muted"}">${esc(note || (p.stage === "empty" ? "" : ""))}</td>
      <td><select data-action="farm-want" data-base="${b.id}" data-plot="${p.id}"${tip("What to sow on this plot next. 'Farmers pick' chooses the best crop for the season.")}>${cropOptions(p.want, p.gh, state, b, p)}</select></td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
  const harvests = fo.harvests.slice(0, 4).map((h) => `${esc(h.name)} in ${h.inDays}d (~${n0(h.food)})`).join(", ");
  const sl = storeLine(state, b);
  const wl = winterLine(state, b);
  const today = Math.floor(state.hour / 24);
  const guide = CROP_KEYS.map((k) => {
    const c = CROPS[k], cl = c.climate;
    const g = recentGrowth(state, k, false);
    const fc = cropForecast(k, false, today);
    const sowable = cl.seasons.includes(s ? s.key : "summer") && (!c.sowIn || c.sowIn.includes(s ? s.key : "summer"));
    const sow = !sowable ? "<span class='muted'>not now</span>" : isFinite(fc.days) ? `<span class="${fc.survival < 0.5 ? "danger" : ""}">~${fc.days}d, ${Math.round(fc.survival * 100)}%</span>` : "<span class='muted'>won't ripen</span>";
    return `<tr${tip(c.desc)}><td><b>${esc(c.name)}</b></td><td>${c.days}</td><td>${c.yield}</td><td>${c.seed}</td><td>${c.water}</td><td class="small">${cl.seasons.map((x) => SEASON_NAMES[x]).join(", ")}${c.sowIn ? ` <span class="muted">(sow in ${c.sowIn.map((x) => SEASON_NAMES[x].toLowerCase()).join(", ")})</span>` : ""}</td>
      <td>${Math.round(cl.hardy * 100)}%</td><td>${Math.round((1 - cl.thirst) * 100)}%</td><td>${Math.round(c.heatTol * 100)}%</td><td>${c.spoil}d</td><td>${c.store === "preserved" ? "preserved" : "fresh"}</td><td>${Math.round(g * 100)}%</td><td class="small">${sow}</td></tr>`;
  }).join("");
  return `<div class="grid2">
    <div>
      <h3>Outlook</h3>
      <div class="kv small">
        <div${tip(wxTip)}>Season</div><div${tip(wxTip)}>${esc(wx || (s ? s.name : ""))}</div>
        <div>Food in store</div><div class="${fo.daysLeft < 7 ? "danger" : ""}">${n0(fo.stock)} <span class="muted">(${n0(fo.fresh)} fresh + ${n0(fo.preserved)} preserved)</span>${b.rationing ? " · <b>short rations</b>" : ""}</div>
        <div${tip(sl.tip)}>Storage</div><div class="${sl.cls}"${tip(sl.tip)}>${esc(sl.short)}<div class="small muted">${esc(sl.pres)}</div></div>
        <div${tip("What everyone living here eats a day (more in the cold)")}>Eaten</div><div>${n1(fo.eat)} a day</div>
        <div${tip(`Fresh food spoils ${n1(fo.store.rate * 100)}% a day on average now (by where it is stored), preserved food ${n1(fo.store.presRate * 100)}%. ${sl.tip}`)}>Spoiling</div><div class="${fo.store.outside >= 1 ? "danger" : ""}">${n1(fo.spoil)} a day${fo.store.outside >= 1 ? ` (${n1(fo.store.outLoss)} of it outside)` : ""}</div>
        <div${tip("Days the stock lasts at today's rate, with no harvests and no loot")}>Days of food</div><div class="${fo.daysLeft < 7 ? "danger" : fo.daysLeft < 20 ? "" : "good"}">${days(fo.daysLeft)}</div>
        <div>Next harvests</div><div>${harvests || "<span class='muted'>nothing growing</span>"}</div>
        <div${tip(wl.tip)}>Winter outlook</div><div class="${wl.cls}"${tip(wl.tip)}>${esc(wl.text)}</div>
        <div${tip(waterLine(state, b).tip)}>Water</div><div class="${waterLine(state, b).cls}">${esc(waterLine(state, b).short)}</div>
      </div>
      <h3>Farmers</h3>
      <div class="card small">
        ${workers.length ? workers.map((x) => esc(x.name.split(" ")[0])).join(", ") : "<span class='danger'>Nobody on the Farm role: nothing is tended, planted or harvested (ripe crops rot).</span>"}
        <div class="kv" style="margin-top:0.3rem">
          <div${tip("Farmers (by how much they can work) per planted plot. More hands give a bigger harvest from the same days, with diminishing returns: 0.5 per plot about 1.0, 1 per plot 1.23, 2 per plot 1.4.")}>Tending</div><div>${n1(care.perPlot)} per plot → ×${n1(care.tend)}</div>
          <div${tip("Average Farming of the farmers who tend (one per planted plot): Farming 0 ×0.75, 7 ×1.0, 20 ×1.45")}>Skill</div><div>Farming ${n1(care.avgSkill)} → ×${n1(care.skill)}</div>
          <div${tip("Farmland 1.3, forest 0.9, hills 0.85, elsewhere 1")}>Ground</div><div>×${siteFarm(state, b)}</div>
          <div>Plots</div><div>${plotLimit(b)} outdoor${greenhouseLimit(b) ? ` + ${greenhouseLimit(b)} under glass` : ""} · ${f.plots.filter((p) => p.stage === "growing").length} growing</div>
        </div>
        <label style="display:block;margin-top:0.35rem"${tip("Farmers sow free plots by themselves (the crop picked for the plot, or the best one for the season) and clear dead ones. Off: only what you sow.")}><input type="checkbox" data-action="farm-auto" data-base="${b.id}" ${f.auto ? "checked" : ""}> Replant automatically</label>
      </div>
    </div>
    <div>
      <h3>How farming works</h3>
      <div class="small muted">A crop takes days to ripen (slower in cold or dry weather, not at all out of season) and is harvested in one go. Seed costs a little food. Frost, storms, drought and heat can kill a standing crop; wet weather rots a ripe one, and a ripe crop not harvested within its window is lost. Growing crops need watering on dry days (people drink first). More plots: Farm plot (+2), Greenhouse (+2 under glass, grows in winter).</div>
      <div class="small muted" style="margin-top:0.35rem"><b>Winter:</b> nothing grows outdoors in winter and the first spring harvest comes weeks into spring, so the food for the hungry gap has to be grown and stored before it. Sow kale, winter roots and winter wheat in autumn (they stand the frost); wheat, winter wheat and dry beans are threshed or dried and go into the preserved stock. Fresh food fills the cellar first and spoils fast once it is stored outside: build root cellars, a storehouse or a cold store, and preserve the surplus (Preserving kitchen with jars, Drying racks).</div>
    </div>
  </div>
  <h3>Plots</h3>
  <table class="t"><tr><th>#</th><th>Crop</th><th>Stage</th><th>Ripe in</th><th${tip("Food at harvest from the care so far (farmers, skill, ground)")}>Yield</th><th>Weather</th><th>Next crop</th><th></th></tr>${rows}</table>
  <h3>Crop guide</h3>
  <table class="t small"><tr><th>Crop</th><th${tip("Growing days at full growth")}>Days</th><th${tip("Food per plot at care ×1")}>Yield</th><th>Seed</th><th${tip("Water per plot on a dry day")}>Water</th><th>Seasons</th><th>Frost</th><th>Drought</th><th>Heat</th><th${tip("Days a ripe crop keeps in the field")}>Keeps</th><th${tip("Where the harvest goes: fresh food (cellar, spoils) or the preserved stock (dry grain and beans: barely spoils, no cellar room)")}>Store</th><th${tip("Growth over the last week outdoors")}>Growth</th><th${tip("Sown outdoors today: about how many days until it is ripe and the chance it lives that long, by the usual weather for the time of year (frost, storms, heat)")}>Sow now</th></tr>${guide}</table>`;
}

// ---------- actions ----------
const baseOf = (state, d) => baseById(state, Number(d.base));
export const FARM_ACTIONS = {
  "farm-plant": (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    const p = farmOf(state, b).plots.find((x) => x.id === Number(d.plot));
    const crop = p && (p.want || bestCrop(state, b, p));
    ui.baseMsg = crop ? plantPlot(state, b, Number(d.plot), crop) : "Nothing would ripen there before its season ends.";
  },
  "farm-harvest": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = harvestPlot(state, b, Number(d.plot)); },
  "farm-clear": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = clearPlot(state, b, Number(d.plot)); },
  "farm-auto": (state, ui, d) => { const b = baseOf(state, d); if (b) ui.baseMsg = setAutoReplant(state, b, !farmOf(state, b).auto); },
};
// Change events (selects).
export const FARM_CHANGE = {
  "farm-want": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) ui.baseMsg = setPlotWant(state, b, Number(el.dataset.plot), el.value); },
};
