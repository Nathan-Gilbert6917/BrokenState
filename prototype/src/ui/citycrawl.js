// The city crawl window (sim/citycrawl.js): the block card (places, street events, go deeper, leave), an encounter's
// answers, and the crawl's HUD (depth, the city's Alert, the clock, the team's health, ammo and load, what this run found).
import { keyWord } from "../sim/water.js"; // supplies as words: "9mm FMJ", "rounds"
import { partyMembers, carried } from "../sim/parties.js";
import { hourOfDay, day, isNight } from "../sim/world.js";
import { buildingHint } from "../sim/buildingmaps.js";
import {
  CRAWL, EVENTS, activeCrawl, blockOf, placeLooks, placeRichness, moveRisk, exitRisk, crawlLoad, encounterOptions, alertName,
  threatOf, enterPlace, quickSearch, nextBlock, leaveCity, lieLow, resolveEncounter, resolveEvent, eventChoices, continueLeaving, specialChance, placeStoreys, STOREY_BONUS,
  lookAround, lookChance,
} from "../sim/citycrawl.js";
import { folkHint, FOLK } from "../sim/floorfolk.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
import { teamAmmoBreakdown, breakdownText } from "../sim/ammo.js"; // the Ammo figure: every round and arrow, by calibre on hover
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pct = (v) => `${Math.round(v * 100)}%`;
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const DEPTH = ["", "The city's edge", "Outer streets", "Inner streets", "Downtown", "Deep downtown", "The heart of the city"];
const LOOK_COLOR = ["", "var(--good)", "#c9c26a", "#e0a050", "var(--danger)", "#ff5a5a"];

// The window (ui.js pickModal), or "" when no crawl is open.
export function crawlModal(state, ui) {
  const p = activeCrawl(state);
  if (!p) return "";
  const c = p.crawl;
  const msg = ui.crawlMsg && ui.crawlMsgKey === `${p.id}:${c.started}` ? `<div class="result" style="margin:0.4rem 0">${esc(ui.crawlMsg)}</div>` : "";
  return `<div class="box wide crawl"><h1>${esc(c.city)} · Block ${c.block}<span class="muted small" style="font-weight:normal"> — ${esc(DEPTH[Math.min(c.block, DEPTH.length - 1)])}</span></h1>
    ${hud(state, p, c)}${msg}
    ${c.enc ? encounterCard(state, p, c) : c.leaving ? leavingCard(state, p, c) : blockCard(state, p, c)}
    <h3 style="margin-top:0.8rem">This crawl</h3><div class="elog" id="elog" style="height:7rem">${c.log.slice(-20).map((l) => `<div class="k-${l.k}">${esc(l.text)}</div>`).join("")}</div>
  </div>`;
}

function hud(state, p, c) {
  const members = partyMembers(state, p);
  const ld = crawlLoad(state, p);
  const found = [...Object.entries(c.tally.supplies).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${keyWord(k)}`), ...c.tally.gear];
  const depth = Array.from({ length: CRAWL.MAX_BLOCK }, (_, i) => `<span style="display:inline-block;width:0.8rem;height:0.8rem;margin-right:2px;border-radius:2px;background:${i < c.block ? (i < 2 ? "#5d8a5e" : i < 4 ? "#b48a3c" : "#a8443c") : "#2c3139"}"></span>`).join("");
  const clockTxt = `Day ${day(state)} ${String(hourOfDay(state)).padStart(2, "0")}:00${isNight(state) ? " · night" : ""}`;
  return `<div class="grid2" style="gap:0.6rem;margin-bottom:0.5rem">
    <div>
      <div class="spread small"><span${tip(`Block ${c.block} of at most ${CRAWL.MAX_BLOCK}; deepest this run: ${c.deepest}. Deeper: more and tougher dead, raiders holed up, the special dead from block ${CRAWL.SPECIAL.from}; richer, rarer places.`)}>Depth ${depth}</span><span${tip("The shared clock keeps running: moving, searching and waiting take hours. At night the dead see less, and so do you.")}>${clockTxt}</span></div>
      <div class="small" style="margin-top:0.3rem"${tip(`The city's Alert: the noise you have made (a building's Heat when you come out, fights, alarms), rising ${CRAWL.ALERT.creep} an hour while you stay (the dead drift toward the living; lie low to bring it down). It raises the Heat you start each building with and the odds of trouble on the street. ${CRAWL.EXIT.fightAlert}+ from block ${CRAWL.EXIT.fightFrom} or deeper: the way out is a fight.`)}>Alert: <b>${alertName(c.alert)}</b> (${Math.round(c.alert)})</div>
      <div class="heat" style="margin:0.25rem 0 0.2rem"><i style="left:${Math.min(99, c.alert)}%"></i></div>
      <div class="small muted">${c.kills} killed this run${c.lost.length ? ` · <span class="danger">lost ${esc(c.lost.join(", "))}</span>` : ""}</div>
    </div>
    <div>
      ${members.map((m) => `<div class="row small" style="gap:0.4rem"><span style="width:6.5rem;overflow:hidden;white-space:nowrap">${esc(m.name.split(" ")[0])}</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : m.health < 70 ? "#c9a24a" : "var(--good)")}</div><span class="muted" style="width:2rem;text-align:right">${Math.round(m.health)}</span></div>`).join("")}
      <div class="small" style="margin-top:0.25rem"><span${tip(`Every round and arrow the team has, by calibre: ${breakdownText(teamAmmoBreakdown(state, p), "; ")}`)}>Ammo ${teamAmmoBreakdown(state, p).total}</span> · Meds ${Math.floor(carried(p, "meds"))} · <span class="${ld.over > 0 ? "danger" : ""}"${tip(`What the team carries against what its people can carry on foot (the vehicle${c.hadVehicle ? " waits at the city's edge" : ""}). Over it: slower to hide and run, and the way out is riskier.`)}>Load ${Math.round(ld.load)}/${Math.round(ld.cap)} kg on foot</span></div>
      <div class="small" style="margin-top:0.2rem">${found.length ? found.slice(0, 14).map((f) => `<span class="chip">${esc(f)}</span>`).join("") + (found.length > 14 ? ` <span class="muted">+${found.length - 14} more</span>` : "") : "<span class='muted'>Nothing found yet this run.</span>"}</div>
    </div>
  </div>`;
}

function blockCard(state, p, c) {
  const blk = blockOf(c);
  const nextRisk = c.block < CRAWL.MAX_BLOCK ? moveRisk(state, c, c.block + 1, 1) : 0; // its activity unknown till you are there
  const th = threatOf(state, c, c.block);
  const heatHere = Math.round((c.trail || {})[c.block] || 0);
  const out = exitRisk(state, p, c, "back");
  const newWay = exitRisk(state, p, c, "new");
  const wall = blk.events.find((e) => !e.done && EVENTS[e.key].blocking);
  const sp = specialChance(state, c.block + 1);
  const places = blk.places.map((pl) => placeCard(state, p, c, pl)).join("");
  const events = blk.events.map((ev) => eventCard(state, p, c, ev)).join("");
  const thColor = ["", "#6f9f6a", "#9fae5a", "#c9a24a", "#c9773f", "#c0443a"][th.level];
  return `<div class="small muted" style="margin-bottom:0.4rem">${esc(blk.street)}. ${c.block === 1 ? "You can still see the way you came in." : ""}</div>
    <div class="small" style="margin-bottom:0.4rem"><span style="color:${thColor}"${tip(`How many of the dead move on this block's streets (the city's own: the same every visit). It scales the block's danger and multiplies the heat here (the city's Alert and the noise you have made on this block): ×${th.mult}. A little noise on a crawling block is worse than a lot on a quiet one.`)}>Zombie activity: <b>${esc(th.name)}</b> (×${th.mult})</span> · <span${tip("The noise you have made on this block (fights, shots, searches, walking in), still on its streets: it fades slowly, and it is what you walk back through if you leave the way you came. A bigger team leaves more, a stealthy one less.")}>Heat on this block: <b>${heatHere}</b></span></div>
    <h3>Places</h3><div class="crawl-places" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:0.5rem">${places}</div>
    ${events ? `<h3 style="margin-top:0.6rem">On the street</h3>${events}` : `<div class="small muted" style="margin-top:0.4rem">The street is quiet.</div>`}
    <div class="row" style="margin-top:0.8rem;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">
      <button data-action="cc-look" data-id="${p.id}" ${blk.looked ? "disabled" : ""}${tip(blk.looked ? "You have looked this block over already." : `${FOLK.LOOK.hours} h watching the block's places from a doorway: what stirs on the upper floors of each (lights, voices and a watcher on the stairs, something nesting), about ${pct(lookChance(state, p))} a place by your best Scouting. Nobody makes a noise, but the hour passes (the Alert creeps up).`)}>Look around (${FOLK.LOOK.hours} h)</button>
      <button data-action="cc-low" data-id="${p.id}"${tip(`An hour off the street: the Alert falls by ${Math.round(CRAWL.ALERT.lieLow - CRAWL.ALERT.creep * CRAWL.LIE_LOW_HOURS)} (not below the city's own). Something may still find you (about ${pct(moveRisk(state, c, c.block) * 0.4)}).`)}>Lie low (1 h)</button>
      <button data-action="cc-next" data-id="${p.id}" ${c.block >= CRAWL.MAX_BLOCK || wall ? "disabled" : ""}${tip(c.block >= CRAWL.MAX_BLOCK ? "This is the heart of the city." : wall ? `${EVENTS[wall.key].title}: deal with it first.` : `Deeper: ${CRAWL.MOVE_HOURS} h on foot; about ${pct(nextRisk)} chance of trouble on the way (its zombie activity unknown till you are there). Block ${c.block + 1}: more and tougher dead, richer places${sp > 0 ? `, the special dead (${pct(sp)} of them)` : ""}.`)}>Go to the next block ▸</button>
      ${c.block === 1 ? `<button class="primary" data-action="cc-leave" data-id="${p.id}"${tip("You are at the edge: out straight away.")}>Leave the city</button>` : `
      <button data-action="cc-leave" data-id="${p.id}"${tip(`${out.breakout ? "The city is roused: the first block on the way out is a fight (or a hard sneak). " : ""}Back the way you came: about ${out.hours} h through ${c.block - 1} block${c.block === 2 ? "" : "s"} you know, safer nearer the edge, but the noise you made on each is still on its streets (a bigger team leaves more, a stealthy one less; it fades slowly). About ${pct(out.any)} chance of trouble on the way (${out.steps.map((st) => `block ${st.block} (${CRAWL.THREAT.names[st.threat].toLowerCase()}${st.trail ? `, heat ${st.trail}` : ""}): ${pct(st.p)}`).join("; ")}). Die on the way and what you carry stays where you fall.`)}>Back the way you came (${pct(out.any)})</button>
      <button class="primary" data-action="cc-leavenew" data-id="${p.id}"${tip(`${newWay.breakout ? "The city is roused: the first block on the way out is a fight (or a hard sneak). " : ""}Another way out: streets you have not walked, none of your noise on them and their zombie activity unknown (each street its own), as deep as block ${c.block} all the way; ${newWay.lo}–${newWay.hi} of them (you find out on the way), ${CRAWL.NEWWAY.hours} h each. About ${pct(newWay.per)} chance of trouble a street: ${pct(newWay.anyLo)} if the way out is one street, ${pct(newWay.anyHi)} if it is ${newWay.hi}.`)}>Find another way out (${pct(newWay.anyLo)}–${pct(newWay.anyHi)})</button>`}
    </div>`;
}

function placeCard(state, p, c, pl) {
  const looks = placeLooks(state, p, c, pl);
  const hint = buildingHint(pl.key);
  const snap = c.buildings[pl.id];
  const rich = placeRichness(state, c, pl);
  const status = pl.blocked ? `<div class="small danger">${esc(pl.blocked)}</div>` :
    snap ? `<div class="small">Searched ${snap.searched}/${snap.total} · ${snap.units.filter((u) => !u.dead && u.side === "enemy").length} still inside</div>` :
    pl.quick ? `<div class="small muted">Searched by the numbers</div>` : "";
  const picked = pl.looted > 0.05 ? ` · <span class="muted"${tip("Searched on an earlier visit: less is left.")}>picked over (${pct(pl.looted)})</span>` : "";
  const storeys = placeStoreys(state, c, pl);
  const storeyTip = storeys > 1 ? `${storeys} storeys: the stairs are on every floor; upper floors are less picked over (richer), the dead mostly below. Deeper blocks (${STOREY_BONUS.from1}+, ${STOREY_BONUS.from2}+) have taller offices and apartment blocks.` : "One storey.";
  // What the team knows of the upper floors (sim/floorfolk.js): after a Look around on this block, or having been inside.
  const up = folkHint(pl);
  const upstairs = storeys > 1 ? `<div class="small ${up && up !== "nothing stirs upstairs" ? "" : "muted"}"${tip(up ? "What the team saw or heard of the upper floors: lights (survivors barricaded in: talk, trade, recruit, or they shoot), voices and a watcher on the stairs (raiders holed up above, their stash with them), something nesting (the special dead on the top floor, still until woken; richer pickings there)." : "Unknown until you look around this block (an hour) or go in.")}>Upstairs: ${esc(up || "unknown")}</div>` : "";
  return `<div class="card" style="margin:0">
    <div class="spread"><b>${esc(pl.name)}</b>${pl.rare ? `<span class="chip on"${tip("A rare find in a city: worth a look.")}>rare</span>` : ""}</div>
    <div class="small muted">${esc(pl.kind)} · ${esc(hint.size)}, ${hint.rooms} rooms · <span${tip(storeyTip)}>${storeys} ${storeys === 1 ? "storey" : "storeys"}</span>${picked}</div>
    ${upstairs}
    <div class="small" style="margin:0.2rem 0">${esc(hint.hint)}</div>
    <div class="small"><span style="color:${LOOK_COLOR[looks.level]}"${tip(looks.sure ? "Your scout reads it right (Scouting 5+)." : "A guess from the street; a scout with Scouting 5+ would know.")}>Looks: ${esc(looks.text)}</span>${looks.people ? ` · <span class="danger"${tip("Someone moved behind the windows: people inside, likely armed.")}>movement inside</span>` : ""} · <span class="muted"${tip("How well stocked its shelves are likely to be (the depth, the place, how picked over it is).")}>richness ${rich.toFixed(2)}</span></div>
    ${status}
    <div class="row" style="margin-top:0.35rem;gap:0.35rem">
      <button class="${snap ? "" : "primary"}" data-action="cc-enter" data-id="${p.id}" data-place="${pl.id}" ${pl.blocked ? "disabled" : ""}${tip(snap ? "The building as you left it: what you searched stays searched, the doors you opened open, the dead you killed dead and the ones you lured where they went." : "Go in: the building's own map. Extract at any exit to come back out to this block.")}>${snap ? "Go back in" : "Go in"}</button>
      <button data-action="cc-quick" data-id="${p.id}" data-place="${pl.id}" ${pl.blocked || pl.quick ? "disabled" : ""}${tip(`Search it by the numbers: ${CRAWL.QUICK.hours} h, a chance of a fight, no map.`)}>Search quickly</button>
    </div>
  </div>`;
}

function eventCard(state, p, c, ev) {
  const E = EVENTS[ev.key];
  if (ev.done) return `<div class="card" style="opacity:0.7"><b>${esc(E.title)}</b><div class="small muted">${esc(ev.result || "Done.")}</div></div>`;
  return `<div class="card"><b>${esc(E.title)}</b>${E.blocking ? ` <span class="chip off">blocks the way deeper</span>` : ""}<div class="small" style="margin:0.2rem 0 0.35rem">${esc(E.text)}</div>
    <div class="row" style="gap:0.35rem;flex-wrap:wrap">${eventChoices(state, p, ev).map((ch) => `<button data-action="cc-event" data-id="${p.id}" data-ev="${ev.id}" data-ch="${ch.id}"${tip(ch.tip)}>${esc(ch.label)}</button>`).join("")}</div></div>`;
}

function encounterCard(state, p, c) {
  const e = c.enc;
  if (e.fighting) return `<div class="card attn"><b>Fighting</b><div class="small">${esc(e.text)}</div></div>`;
  const opts = encounterOptions(state, p);
  const title = e.kind === "patrol" ? "Raiders" : e.kind === "breakout" ? "Fight your way out" : e.kind === "turned" ? "One of you turned" : "The dead";
  return `<div class="card attn"><b>${esc(title)}${e.spotted ? " — they have seen you" : ""}</b>
    <div class="small" style="margin:0.25rem 0 0.5rem">${esc(e.text)}${e.exit ? " You are on your way out." : e.move ? ` You were on your way to block ${e.move}.` : ""}</div>
    <div class="choices">${opts.map((o) => `<button data-action="cc-enc" data-id="${p.id}" data-ch="${o.id}" ${o.disabled ? "disabled" : ""}>${esc(o.label)}<span class="hint">${esc(o.tip)}</span></button>`).join("")}</div></div>`;
}

function leavingCard(state, p, c) {
  const L = c.leaving;
  return `<div class="card"><b>On the way out</b><div class="small">${L.way === "new" ? `Another way out, from block ${c.block}: ${L.total - L.left} street${L.total - L.left === 1 ? "" : "s"} behind you; how many more, the city has not told you.` : `Back the way you came: block ${L.at}.`}</div>
    <div class="row" style="margin-top:0.4rem"><button class="primary" data-action="cc-go" data-id="${p.id}">Keep going</button></div></div>`;
}

// Actions (main.js wires them like the other panels'): d.id is the team.
const partyOf = (state, d) => state.parties.find((x) => x.id === Number(d.id));
const run = (fn) => (state, ui, d) => {
  const p = partyOf(state, d);
  if (!p || !p.crawl) return;
  const key = `${p.id}:${p.crawl.started}`;
  const msg = fn(state, p, d, ui);
  ui.crawlMsg = typeof msg === "string" ? msg : "";
  ui.crawlMsgKey = key;
};
export const CRAWL_ACTIONS = {
  "cc-enter": run((state, p, d) => enterPlace(state, p, d.place, { map: true })),
  "cc-quick": run((state, p, d) => { const pl = blockOf(p.crawl).places.find((x) => x.id === d.place); return pl && !pl.blocked && !pl.quick ? quickSearch(state, p, pl) : ""; }),
  "cc-event": run((state, p, d) => resolveEvent(state, p, d.ev, d.ch, { map: true })),
  "cc-enc": run((state, p, d) => resolveEncounter(state, p, d.ch, { map: true })),
  "cc-next": run((state, p) => nextBlock(state, p)),
  "cc-leave": run((state, p) => leaveCity(state, p, "back")),
  "cc-leavenew": run((state, p) => leaveCity(state, p, "new")),
  "cc-low": run((state, p) => lieLow(state, p)),
  "cc-look": run((state, p) => lookAround(state, p)),
  "cc-go": run((state, p) => continueLeaving(state, p)),
};
