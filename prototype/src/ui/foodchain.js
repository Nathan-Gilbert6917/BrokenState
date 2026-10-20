// The base window's Food tab: the food chain, left to right (sim/foodchain.js has the numbers, sim/foodlog.js the
// last week's record): Sources (the last 7 days by where it came from, and the crops coming) → Stores (days of food on
// hand, fresh and what keeps, each food room with the days until its next lot spoils, what spoils within the week) →
// Kitchen (each cooking station, its bills and whether they can go; the purified water; the woodpile and the hours of
// wood the fires have left) → Eating (heads, eaten a day, the ration level, what kind of food it was, hot food) →
// Losses (spoiled, eaten raw, sent out with teams, into the packs, shipped, used or taken), then the verdict: how long the
// food lasts at this rate, the biggest drain, and one or two things to do about it.
import { FOODS } from "../sim/foods.js";
import { foodChain } from "../sim/foodchain.js";
import { FOODLOG } from "../sim/foodlog.js";
import { kindWord } from "../sim/storage.js";
import { EAT } from "../sim/eating.js";
import { foodTip } from "./food.js";
import { badge, pbar } from "./uikit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9).toLocaleString("en-US");
const n1 = (v) => { const x = Math.round((v || 0) * 10) / 10; return Math.abs(x) >= 100 ? Math.round(x).toLocaleString("en-US") : String(x); };
const daysText = (d) => (!isFinite(d) ? "keeps" : d >= 365 ? `${Math.round(d / 365)}y` : d >= 60 ? `${Math.round(d / 30)}mo` : d < 1 ? "<1d" : `${Math.floor(d)}d`);
const hoursText = (h) => (!isFinite(h) ? "—" : h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} days`);
// The span the week's record covers: "last 7 days", "last 2.5 days", "today so far".
const spanText = (d) => (d < 1 ? "today so far" : `last ${n1(Math.min(FOODLOG.window, d))} days`);
const spoilCls = (d) => (d < 2 ? "danger" : d < 5 ? "warn" : "");
const first = (name) => String(name || "").split(" ")[0];
const row = (l, v, t = "", cls = "") => `<div class="sk-row"${tip(t)}><span class="sk-l">${l}</span><span class="sk-v${cls ? ` ${cls}` : ""}">${v}</span></div>`;
const rows = (list) => `<div class="sk-rows">${list.filter(Boolean).join("")}</div>`;
const sub = (t, x = "") => `<div class="fc-sub"${tip(x)}>${t}</div>`;
// A few food items as icons and counts: "🦌 4 kg of venison, 🥫 12 cans of beans".
const itemsText = (items, max = 3) => Object.entries(items || {}).filter(([k, q]) => FOODS[k] && q >= 0.05).sort((a, b) => b[1] * FOODS[b[0]].kcal - a[1] * FOODS[a[0]].kcal).slice(0, max)
  .map(([k, q]) => `<span${tip(foodTip(k))}>${FOODS[k].icon} ${q >= 10 ? Math.round(q) : n1(q)} ${esc(FOODS[k].word)}</span>`).join(", ");

// One column of the chain: its step, title, headline and body.
function col(step, title, head, body, t = "") {
  return `<section class="fc-col"><div class="fc-head"${tip(t)}><span class="fc-step">${step}</span><b>${title}</b></div>${head ? `<div class="fc-big">${head}</div>` : ""}${body}</section>`;
}

function sourcesCol(c) {
  const d = c.days;
  const list = c.sources.filter((s) => s.units >= 0.05);
  const tot = list.reduce((a, s) => a + s.units, 0);
  const head = d > 0 ? `${n1(tot / Math.max(d, 1e-6))} <span class="fc-unit">a day</span>` : `<span class="muted small">recording…</span>`;
  const body = rows(list.length ? list.map((s) => row(`${s.icon} ${esc(s.name)}`, `${n1(s.units)} <span class="muted">· ${n1(s.perDay)}/d</span>`, `${s.about}. ${n1(s.units)} days of food in the last ${n1(d)} days.`)) : [`<div class="muted small">Nothing came in${d > 0 ? " this week" : " yet"}.</div>`]);
  const hv = c.harvests.slice(0, 4).map((h) => row(`🌱 ${esc(h.name)}`, `${h.inDays <= 0 ? "ripe" : `in ${h.inDays}d`} <span class="muted">· ${n1(h.food)}</span>`, `Plot ${h.plot}: ${h.name}, ${h.inDays <= 0 ? "ripe now" : `ripe in about ${h.inDays} days`}, about ${n1(h.food)} days of food expected (the Farming tab).`));
  const coming = c.harvests.length ? `${sub("Coming", "The crops in the ground and when they ripen (the Farming tab)")}${rows(hv)}${row("Plots, next 30 days", `${n1(c.farmPerDay)}/d`, "What the plots should bring in a day over the next 30 days, by what is in the ground now")}` : `${sub("Coming")}<div class="muted small">No crops in the ground.</div>`;
  return col(1, "Sources", head, `<div class="muted small">${spanText(d)} · in days of food</div>${body}${coming}`, `Food that came in over the last ${FOODLOG.window} days by where it came from, in days of food (2000 kcal), and the harvests coming. Recorded from day to day (saved with the game).`);
}

function storesCol(c) {
  const s = c.stores;
  const freshPct = s.all > 0 ? (s.fresh / s.all) * 100 : 0;
  const head = `${isFinite(s.daysOnHand) ? n1(s.daysOnHand) : n1(s.all)} <span class="fc-unit">days</span>`;
  const who = s.heads > 0 ? `for ${s.heads} ${s.heads === 1 ? "person" : "people"} · ${n1(s.all)} days of food in all` : `${n1(s.all)} days of food (nobody here)`;
  const room = s.rooms.map((r) => {
    const held = r.cap ? `${n0(r.held)}/${r.cap}` : n0(r.held);
    const next = r.held > 0.05 ? `<span class="${spoilCls(r.next)}">${daysText(r.next)}</span>` : `<span class="muted">—</span>`;
    const t = `${r.name} (${kindWord(r.kind === "stable" ? "dry" : r.kind)}): ${n1(r.held)} days of food${r.cap ? ` of ${r.cap} room` : ""}, ${n1(r.kg)} kg, ${n0(r.kcal)} kcal. Shelf used a day today ×${n1(r.factor)}. Its next lot spoils in ${daysText(r.next)}${r.soon > 0.05 ? `; ${n1(r.soon)} days of food of it within a week` : ""}.${Object.keys(r.items).length ? ` Most of it: ${Object.entries(r.items).sort((a, b) => b[1] * FOODS[b[0]].kcal - a[1] * FOODS[a[0]].kcal).slice(0, 4).map(([k, q]) => `${q >= 10 ? Math.round(q) : n1(q)} ${FOODS[k].word}`).join(", ")}.` : ""}`;
    return `<tr class="${r.key === "outside" && r.held >= 1 ? "danger" : ""}"${tip(t)}><td>${esc(r.name)} <span class="muted">×${n1(r.factor)}</span></td><td>${held}</td><td>${next}</td></tr>`;
  }).join("");
  const soon = s.spoil7.units >= 0.05
    ? `<div class="small ${s.waste7 >= 0.5 ? "danger" : "warn"}"${tip("Lots whose shelf runs out within 7 days where they sit today, and how much of that will not be eaten in time at today's eating (the soonest to spoil is eaten first)")}>Spoils within 7 days: <b>${n1(s.spoil7.units)}</b> days${s.waste7 >= 0.05 ? `, <b>${n1(s.waste7)}</b> of it won't be eaten in time` : " (eaten in time)"}<br>${itemsText(s.spoil7.items)}</div>`
    : `<div class="small good">Nothing spoils within 7 days.</div>`;
  const body = `<div class="muted small">${who}</div>
    ${pbar(freshPct, "good", `fresh ${n1(s.fresh)}`, `keeps ${n1(s.stable)}`, null, "Fresh food needs a food room (it spoils in days to weeks); canned, dry and preserved food keeps months to years anywhere")}
    ${rows([row("Weight", `${n0(s.kg)} kg · ${n0(s.kcal / 1000)}k kcal`, "The food in store by weight and by its energy (2000 kcal is a day of food)"), isFinite(s.daysAtUse) && s.heads ? row("At today's eating", `${n1(s.daysAtUse)} days`, `Everyone fed here eats ${n1(s.perDay)} days of food a day (the cold, the ration level, a Kitchen's saving)`) : ""])}
    <table class="t fc-rooms"><tr><th${tip("Each food room and how fast its food ages today: ×1 is room temperature, a cellar ×0.35, a running freezer ×0.05, outside ×1.5 and worse in heat and rain")}>Room</th><th${tip("Days of food in it / its room")}>Held</th><th${tip("Days until its next lot spoils")}>Next</th></tr>${room}</table>
    ${soon}`;
  return col(2, "Stores", head, body, "Days of food on hand: every food in store at 2000 kcal a day, for everyone fed from these stores (a ration a head)");
}

function kitchenCol(c) {
  const k = c.kitchen, f = c.fires;
  const st = k.stations.map((s) => {
    const tone = s.why ? "bad" : s.runs ? "good" : s.bills.length && s.bills.every((b) => b.idle) ? "muted" : "warn";
    const word = s.why ? "can't cook" : s.runs ? "cooking" : !s.bills.length ? "no bills" : s.bills.every((b) => b.idle) ? "idle" : "stuck";
    const crew = s.crew.length ? `<div class="small muted">${s.key === "canteen" ? "Cooks" : "Tended by"}: ${s.crew.map((x) => `${esc(first(x.name))} (Cooking ${x.lvl})`).join(", ")}</div>` : "";
    const bills = s.bills.map((b) => `<div class="small fc-bill"${tip(`${b.name}, ${b.mode}.${b.last ? ` Last night: ${b.last}.` : ""}`)}>${FOODS[b.out].icon} ${esc(b.name)} ${b.can ? `<span class="good">✓ can go</span>` : `<span class="${b.idle ? "muted" : "warn"}">· ${esc(b.why)}</span>`}</div>`).join("");
    return `<div class="fc-station"><div class="spread"><b>${esc(s.name)}</b>${badge(word, tone)}</div>${s.why ? `<div class="small danger">${esc(s.why)}</div>` : crew}${bills || `<div class="small muted">No bills: add one in the Farming tab.</div>`}</div>`;
  }).join("");
  const warn = k.warn.map((w) => `<div class="small danger">${esc(w)}</div>`).join("");
  const fire = f.parts.length
    ? `${sub("🔥 Fire and wood", "The woodpile and what burns it a day: a camp's or shelter's fire, a cook fire while it cooks, the Kitchen's stove, the water boiler, the heating below 0°C")}${rows([
      row("Wood", `${n0(f.wood)} <span class="muted">· ${n1(f.perDay)}/d</span>`, `${n1(f.wood)} wood in store, burning ${n1(f.perDay)} a day (${n1(f.perHour)} an hour)`),
      ...f.parts.map((p) => row(`${esc(p.name)}${p.lit ? "" : ` <span class="danger">out</span>`}`, `${n1(p.perDay)}/d`, `${p.name}: ${p.note}.${p.lit ? "" : " Out now."}`)),
      row("Lasts", `<b class="${f.hours < 12 ? "danger" : f.hours < 48 ? "warn" : ""}">${hoursText(f.hours)}</b>`, "The wood in store at today's burn. No fire, nothing cooks."),
    ])}`
    : `${sub("🔥 Fire and wood")}<div class="muted small">Nothing burns wood here (${n0(f.wood)} in store).</div>`;
  const pots = k.used > 0.05 || k.made > 0.05 ? row("Cooked, last week", `${n1(k.used)} → ${n1(k.made)}`, `Days of food of ingredients that went into the pots (and on the drying racks, the smokehouse, the preserving room) and what came out: ${k.made >= k.used ? `+${n1(k.made - k.used)} (meals are more filling than their makings)` : `${n1(k.made - k.used)} (preserving keeps food but loses some)`}`) : "";
  const body = `${warn}${st}${rows([pots, row("Purified water", `${n0(k.water.pure)} <span class="muted">· raw ${n0(k.water.raw)}</span>`, "Every recipe takes purified water; un-purified water is boiled for the pot when the purified runs out (wood)")])}${fire}
    <div class="small"><a class="link" data-action="basetab" data-tab="farming"${tip("The bills: add, reorder, pause, the ingredient filter (the Farming tab's Cooking section)")}>Edit bills → Farming tab</a></div>`;
  const head = k.stations.length ? `${k.stations.filter((s) => s.runs).length}/${k.stations.length} <span class="fc-unit">cooking</span>` : `<span class="danger">nothing cooks</span>`;
  return col(3, "Kitchen", head, body, "The cooking stations, their bills (whether each can go now: a cook, the ingredients, purified water, wood) and the fires");
}

function eatingCol(c) {
  const e = c.eating;
  const head = `${n1(e.eaten || e.need)} <span class="fc-unit">a day</span>`;
  const cols = { meal: "var(--good)", survival: "#7fb0e0", preserved: "#c9a35a", plain: "#8d939c", raw: "var(--danger)" };
  const mix = e.mix.filter((m) => m.share > 0.005);
  const bar = mix.length ? `<div class="fc-mix"${tip("What was eaten from the stores this week, by kind")}>${mix.map((m) => `<i style="width:${(m.share * 100).toFixed(1)}%;background:${cols[m.key]}"${tip(`${m.name}: ${Math.round(m.share * 100)}% (${n1(m.units)} days of food)`)}></i>`).join("")}</div>
    <div class="fc-legend small">${mix.map((m) => `<span><i style="background:${cols[m.key]}"></i>${esc(m.name)} ${Math.round(m.share * 100)}%</span>`).join("")}</div>` : `<div class="muted small">Nothing eaten from the stores yet.</div>`;
  const ration = e.ration === "normal" ? badge(e.rationName, "muted") : e.ration === "feast" ? badge(e.rationName, "good") : badge(e.rationName, e.ration === "short" ? "bad" : "warn");
  const hot = e.heads ? row("Hot food", e.hot.max >= EAT.cold[0] ? `<span class="danger">none in ${e.hot.max} days</span>` : e.hot.max >= 1 ? `<span class="warn">${e.hot.max} day${e.hot.max === 1 ? "" : "s"} ago</span>` : `<span class="good">today</span>`, `Days since the people here last ate hot food (a cooked meal, the Kitchen's service, or anything eaten where a cook fire, a lit stove or a lit camp fire cooks it). After ${EAT.cold[0]} days without: "No hot food" (mood ${EAT.coldV[0]} a day, ${EAT.coldV[1]} after ${EAT.cold[1]}).${e.hot.cold ? ` ${e.hot.cold} have it now.` : ""}`) : "";
  const body = `<div class="muted small">${e.heads} living here${e.fed > e.heads ? ` · ${e.fed} fed in all` : ""}</div>${rows([
    row("Need a day", n1(e.need), "Everyone fed here a day at the ration level (per head × heads: the cold, a Kitchen's saving, a Quartermaster)"),
    row("Ration", ration, "The base's ration level (Overview): Normal, Lean (food lasts a quarter longer, mood −1 a day), Feast; under a week of food it goes on short rations by itself"),
    hot,
    e.raw >= 0.05 ? row("Eaten raw", `<span class="danger">${n1(e.raw)}/d</span>`, "Raw meat or fish eaten where nothing cooks it: food poisoning, Ate raw food −7") : "",
  ])}${sub("What they ate")}${bar}`;
  return col(4, "Eating", head, body, "What the people here eat: the measured week, the ration level and the kind of food");
}

function lossesCol(c) {
  const l = c.losses, d = Math.max(c.days, 1e-6);
  const per = (v) => (c.days > 0 ? ` <span class="muted">· ${n1(v / d)}/d</span>` : "");
  const head = `${n1(l.spoiled)} <span class="fc-unit">spoiled</span>`;
  const body = `<div class="muted small">${spanText(c.days)} · in days of food</div>${rows([
    row("🗑 Spoiled", `<span class="${l.spoiled >= 1 ? "danger" : ""}">${n1(l.spoiled)}</span>${per(l.spoiled)}`, "Food whose shelf ran out, thrown out (the log says what)"),
    row("🥩 Eaten raw", `${n1(l.raw)}${per(l.raw)}`, "Raw meat and fish eaten where nothing cooks it"),
    row("🚶 Sent out", `${n1(l.sent)}${per(l.sent)}`, "Packed for teams, supply runs and trades (what a team brings back counts under Sources)"),
    l.pack >= 0.05 || l.back >= 0.05 ? row("🎒 Into packs", `${n1(l.pack)}${l.back >= 0.05 ? ` <span class="muted">· ${n1(l.back)} back</span>` : ""}`, "Everyone carries a pack of about 1.5 days of food: it is filled from the stores, topped up when they eat at home with it under half, and emptied back after an errand. It is still theirs, so the verdict's rate leaves it out.") : "",
    l.ship >= 0.05 ? row("🚚 Shipped", `${n1(l.ship)}${per(l.ship)}`, "To your other bases (the outposts' surplus run)") : "",
    l.other >= 0.05 ? row("📦 Used or taken", `${n1(l.other)}${per(l.other)}`, "Seed for the plots, the still, raids and thieves, anything else") : "",
    l.kitchen >= 0.05 ? row("🍳 Preserving", n1(l.kitchen), "Lost turning food into food that keeps (drying racks, the smokehouse, jars)") : "",
  ])}`;
  return col(5, "Losses", head, body, "Where food went other than into people at the table");
}

// Help: The food chain (ui/help.js, after Meals and rations): the Food tab, spoilage, fires, the lunch break and hot food.
export function foodChainHelp() {
  return `A base's window has a <b>Food</b> tab that reads left to right, so you can see why food runs out. <b>Sources</b>: what came in over the last ${FOODLOG.window} days (farms and harvests with a pen's eggs and milk, hunting and snares, fishing, foraging, scavenging and teams home, trade and gifts, your other bases) and the crops ripening, with when. <b>Stores</b>: days of food on hand for everyone fed there (2000 kcal is a day), fresh and what keeps, each food room with how fast it ages today and the days until its next lot spoils, and what spoils within the week (and how much of it will not be eaten in time). <b>Kitchen</b>: each cooking station, its bills and whether each can go now (a cook, the ingredients, purified water, wood), and the fire: the wood in store, what burns it a day and the hours it lasts. <b>Eating</b>: the people, what they eat a day, the ration level, what kind of food it was, and when they last had hot food. <b>Losses</b>: spoiled, eaten raw, sent out with teams, filled into the packs everyone carries. Last, the verdict: how long the food lasts at this rate, the biggest drain, and one or two things to do.<br><br><b>Spoilage.</b> Every food keeps its own time (bread days, raw meat two or three, potatoes a month, cans years). Fresh food fills the food rooms, the fastest to spoil in the coldest room first; what does not fit sits outside, where it spoils fastest (more in heat and rain, hardly at all frozen). A lot whose time runs out is thrown out, with a line in the log. A root cellar about triples the life of what is in it; canned, dry and preserved food needs no room. The soonest to spoil is eaten first, so a big hunt or harvest can still rot before it is eaten: dry it, cook it or eat it.<br><br><b>Fires.</b> A camp's or shelter's fire burns wood by the hour and goes out when the woodpile runs dry; a cook fire burns wood while it cooks, the Kitchen's stove every day. No fire, nothing cooks: raw meat and fish are eaten raw (food poisoning, Ate raw food −7).<br><br><b>Lunch and hot food.</b> Lunch (12:00, or the hour the Work tab sets) is an hour's break from work for everyone (the guards stay on the walls) and lifts the mood a little. After ${EAT.cold[0]} days without hot food (a cooked meal, the Kitchen's service, or anything eaten where a fire or a lit stove cooks it) everyone minds it: No hot food ${EAT.coldV[0]} a day, ${EAT.coldV[1]} after ${EAT.cold[1]} days.`;
}

// The Food tab.
export function foodChainTab(state, b) {
  const c = foodChain(state, b);
  const v = c.verdict;
  const tone = isFinite(v.lasts) && v.lasts < 7 ? "danger" : isFinite(v.lasts) && v.lasts < 21 ? "warn" : "good";
  const tips = v.tips.length ? `<ul class="fc-tips">${v.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  const note = c.days < 1 ? `<div class="small muted">The week's record starts ${c.days > 0 ? "today" : "this hour"}: the rates fill in over the next days.</div>` : "";
  return `<div class="fc-chain">${sourcesCol(c)}${storesCol(c)}${kitchenCol(c)}${eatingCol(c)}${lossesCol(c)}</div>
    <div class="card fc-verdict fc-${tone}"><b>${esc(v.text)}.</b>${tips}${note}</div>`;
}
