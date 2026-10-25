// The city crawl window (sim/citycrawl.js): first the city's map to pick the block of its rim to go in at (every rim
// block a button; the blocks mapped on earlier visits show what is known), then the block card (places, street events,
// the four ways north / east / south / west with the way back marked, slip away, "Walk out here" on a rim block), an
// encounter's answers, the crawl's HUD (the level, the city's Alert, the clock, the team's health, ammo and load, what
// this run found) and the map of the city's round grid of blocks (the blocks you have been to, this visit and before,
// your path, where you stand and which way you face).
import { keyWord } from "../sim/water.js"; // supplies as words: "9mm FMJ", "rounds"
import { partyMembers, carried } from "../sim/parties.js";
import { hourOfDay, day, isNight } from "../sim/world.js";
import { buildingHint } from "../sim/buildingmaps.js";
import { GEAR } from "../sim/data.js"; // a piece left on a block: its name
import {
  CRAWL, EVENTS, activeCrawl, blockOf, placeLooks, placeRichness, moveRisk, crawlLoad, encounterOptions, alertName,
  threatOf, enterPlace, quickSearch, nextBlock, walkOut, pickStart, autoWayOut, lieLow, resolveEncounter, resolveEvent, eventChoices, specialChance, placeStoreys, STOREY_BONUS,
  carryLine, carryPace, takeLeft, placeHint,
  lookAround, lookChance, waysOn, onEdge, slipAway, slipChance, crawlMemOf,
} from "../sim/citycrawl.js";
import { cellsOf, isEdge, keyOf, DIR_NAMES } from "../sim/citygrid.js";
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
  if (c.choosing) return startCard(state, p, c, msg);
  const blk0 = blockOf(c);
  return `<div class="box wide crawl"><h1>${esc(c.city)} · ${esc(blk0 ? blk0.street : "")}<span class="muted small" style="font-weight:normal"> — ${esc(DEPTH[Math.min(c.block, DEPTH.length - 1)])} (level ${c.block})</span></h1>
    ${hud(state, p, c)}${msg}
    ${c.enc ? encounterCard(state, p, c) : blockCard(state, p, c)}
    <h3 style="margin-top:0.8rem">This crawl</h3><div class="elog" id="elog" style="height:7rem">${c.log.slice(-20).map((l) => `<div class="k-${l.k}">${esc(l.text)}</div>`).join("")}</div>
  </div>`;
}

function hud(state, p, c) {
  const members = partyMembers(state, p);
  const ld = crawlLoad(state, p);
  const found = [...Object.entries(c.tally.supplies).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${keyWord(k)}`), ...c.tally.gear];
  const depth = Array.from({ length: CRAWL.MAX_BLOCK }, (_, i) => `<span style="display:inline-block;width:0.8rem;height:0.8rem;margin-right:2px;border-radius:2px;background:${i < c.block ? (i < 2 ? "#5d8a5e" : i < 4 ? "#b48a3c" : "#a8443c") : "#2c3139"}"></span>`).join("");
  const map = cityMap(state, c);
  const clockTxt = `Day ${day(state)} ${String(hourOfDay(state)).padStart(2, "0")}:00${isNight(state) ? " · night" : ""}`;
  return `<div style="display:grid;grid-template-columns:minmax(12rem,1fr) auto minmax(14rem,1fr);gap:0.6rem;margin-bottom:0.5rem">
    <div>
      <div class="spread small"><span${tip(`Level ${c.block} of at most ${CRAWL.MAX_BLOCK} (the heart of a big city); deepest this run: ${c.deepest}. The level climbs as you go in toward the centre of the city: more and tougher dead, raiders holed up, the special dead from level ${CRAWL.SPECIAL.from}; richer, rarer places.`)}>Level ${depth}</span><span${tip("The shared clock keeps running: moving, searching and waiting take hours. At night the dead see less, and so do you.")}>${clockTxt}</span></div>
      <div class="small" style="margin-top:0.3rem"${tip(`The city's Alert: the noise you have made (a building's Heat when you come out, fights, alarms), rising ${CRAWL.ALERT.creep} an hour while you stay (the dead drift toward the living; lie low to bring it down). It raises the Heat you start each building with and the odds of trouble on the street. ${CRAWL.BREAKOUT.alert}+: walking out from the edge is a breakout (the dead fill the streets between you and safety).`)}>Alert: <b>${alertName(c.alert)}</b> (${Math.round(c.alert)})</div>
      <div class="heat" style="margin:0.25rem 0 0.2rem"><i style="left:${Math.min(99, c.alert)}%"></i></div>
      <div class="small muted">${c.kills} killed this run${c.lost.length ? ` · <span class="danger">lost ${esc(c.lost.join(", "))}</span>` : ""}</div>
    </div>
    <div>${map}</div>
    <div>
      ${members.map((m) => `<div class="row small" style="gap:0.4rem"><span style="width:6.5rem;overflow:hidden;white-space:nowrap">${esc(m.name.split(" ")[0])}</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : m.health < 70 ? "#c9a24a" : "var(--good)")}</div><span class="muted" style="width:2rem;text-align:right">${Math.round(m.health)}</span></div>`).join("")}
      <div class="small" style="margin-top:0.25rem"><span${tip(`Every round and arrow the team has, by calibre: ${breakdownText(teamAmmoBreakdown(state, p), "; ")}`)}>Ammo ${teamAmmoBreakdown(state, p).total}</span> · Meds ${Math.floor(carried(p, "meds"))} · <span class="${ld.over > 0 ? "danger" : ""}"${tip(`What the team carries against what its people can carry on foot (the vehicle${c.hadVehicle ? " waits at the city's edge" : ""}). Over it: slower to hide and run, and every block you walk is riskier.`)}>Load ${Math.round(ld.load)}/${Math.round(ld.cap)} kg on foot</span></div>
      ${carryLine(state, p) ? `<div class="small" style="margin-top:0.2rem"${tip(`A piece of furniture in the arms, block to block (one alone, or two side by side at half the weight each): a block's walk takes ${carryPace(state, p).hours} h at the slowest carrier's pace. Going into a place it stays in their arms at the door, set down there first when the dead or raiders are right inside. Out at the block you came in by, it goes into the vehicle; out at any other block of the rim it is dropped there from exhaustion (the block remembers it).`)}>${esc(carryLine(state, p))}</div>` : ""}
      <div class="small" style="margin-top:0.2rem">${found.length ? found.slice(0, 14).map((f) => `<span class="chip">${esc(f)}</span>`).join("") + (found.length > 14 ? ` <span class="muted">+${found.length - 14} more</span>` : "") : "<span class='muted'>Nothing found yet this run.</span>"}</div>
    </div>
  </div>`;
}

function blockCard(state, p, c) {
  const blk = blockOf(c);
  const th = threatOf(state, c, c.cell);
  const heatHere = Math.round((c.trail || {})[c.cell] || 0);
  const sp = specialChance(state, c.block + 1);
  const places = blk.places.map((pl) => placeCard(state, p, c, pl)).join("");
  const events = blk.events.map((ev) => eventCard(state, p, c, ev)).join("");
  const mem = crawlMemOf(state.tiles[c.tile]);
  const thColor = ["", "#6f9f6a", "#9fae5a", "#c9a24a", "#c9773f", "#c0443a"][th.level];
  const arrow = ["▲", "▶", "▼", "◀"];
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const moves = waysOn(c).map((w) => {
    if (!w.cell) return `<button disabled${tip(`${cap(w.way)}: the edge of the city that way. Walk out from here instead.`)}>${arrow[w.dir]} ${cap(w.way)}: the edge</button>`;
    if (w.wall) return `<button disabled${tip(`${EVENTS[w.wall.key].title}: the way ${w.way} is blocked until you deal with it (on the street above).`)}>${arrow[w.dir]} ${cap(w.way)}: blocked</button>`;
    const seen = c.blocks[w.cell] || mem.cells[w.cell];
    const known = seen ? threatOf(state, c, w.cell) : null;
    const r = moveRisk(state, c, w.cell, known ? known.mult : 1, crawlLoad(state, p).over);
    const deeper = w.level > c.block ? `deeper in (level ${w.level})` : w.level < c.block ? `back toward the edge (level ${w.level})` : `level ${w.level}`;
    const heat = Math.round((c.trail || {})[w.cell] || 0);
    return `<button data-action="cc-next" data-id="${p.id}" data-way="${w.way}"${tip(`${cap(w.way)}${w.back ? ", the way you came" : ""}, ${deeper}: ${carryPace(state, p).hours} h on foot; about ${pct(r)} chance of trouble on the way${known ? ` (you know it: ${known.name.toLowerCase()} streets${heat ? `, heat ${heat}: the noise you made there is still on its streets` : ""})` : " (its zombie activity unknown till you are there)"}.${w.level > c.block && sp > 0 ? ` The special dead there: ${pct(sp)} of them.` : ""}`)}>${arrow[w.dir]} ${cap(w.way)}${w.back ? " (back)" : w.level > c.block ? " (deeper)" : ""}</button>`;
  }).join("");
  const slip = c.fresh && c.prev ? `<button data-action="cc-slip" data-id="${p.id}"${tip(`Back out the way you came onto the block before, before anything here notices you: about ${pct(slipChance(state, p, c))} (Stealth against the dead here: its activity and heat; a bigger team is harder to hide). ${CRAWL.SLIP.hours} h. Fail and they have seen you.`)}>Slip away unseen</button>` : "";
  const edge = onEdge(c);
  const roused = c.alert >= CRAWL.BREAKOUT.alert;
  const near = edge ? null : autoWayOut(state, p, c, "nearest"), safe = edge ? null : autoWayOut(state, p, c, "safer");
  const exits = edge ? `<button class="primary" data-action="cc-out" data-id="${p.id}"${tip(roused ? `The city is roused (Alert ${CRAWL.BREAKOUT.alert}+): the dead fill the streets between you and safety. Walking out is a breakout: fight your way through, find a gap or run for it. Lie low first to bring the Alert down.` : "You are on the edge of the city: out from here, with what you carry.")}>Walk out here${roused ? " (a breakout)" : ""}</button>`
    : near ? `<span class="small muted"${tip("No way out is walked for you: walk block by block to any block on the rim (the lighter edge of the map) and walk out there. Every block is a roll: its activity, the city's Alert, the heat you left on it (going back the way you came, through your own noise), your load and the night.")}>The edge: ${near.path.length} block${near.path.length === 1 ? "" : "s"} away at the nearest${safe && safe.path.length !== near.path.length ? `; the quieter way as you know it ${safe.path.length}` : ""} (about ${pct((safe || near).risk)} chance of trouble on the way)</span>` : "";
  return `<div class="small muted" style="margin-bottom:0.4rem">${esc(blk.street)}.${edge ? " The edge of the city: you can walk out from here." : ""}</div>
    <div class="small" style="margin-bottom:0.4rem"><span style="color:${thColor}"${tip(`How many of the dead move on this block's streets (the city's own: the same every visit). It scales the block's danger and multiplies the heat here (the city's Alert and the noise you have made on this block): ×${th.mult}. A little noise on a crawling block is worse than a lot on a quiet one. Too much? Slip away unseen before you do anything here.`)}>Zombie activity: <b>${esc(th.name)}</b> (×${th.mult})</span> · <span${tip("The noise you have made on this block (fights, shots, searches, walking in), still on its streets: it fades slowly, and it is what you walk back through if you go out the way you came. A bigger team leaves more, a stealthy one less.")}>Heat on this block: <b>${heatHere}</b></span></div>
    ${(blk.left || []).length ? `<div class="small" style="margin-bottom:0.4rem">Left here: ${blk.left.map((o, i) => `<span class="chip">${esc(GEAR[o.key] ? GEAR[o.key].name : o.kind)}</span> <button data-action="cc-take" data-id="${p.id}" data-i="${i}"${tip("Take it up again: someone with free arms (two for a piece that takes two). It slows every block you walk.")}>Take up</button>`).join(" ")}</div>` : ""}
    <h3>Places</h3><div class="crawl-places" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:0.5rem">${places}</div>
    ${events ? `<h3 style="margin-top:0.6rem">On the street</h3>${events}` : `<div class="small muted" style="margin-top:0.4rem">The street is quiet.</div>`}
    <div class="row" style="margin-top:0.8rem;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">
      <button data-action="cc-look" data-id="${p.id}" ${blk.looked ? "disabled" : ""}${tip(blk.looked ? "You have looked this block over already." : `${FOLK.LOOK.hours} h watching the block's places from a doorway: what stirs on the upper floors of each (lights, voices and a watcher on the stairs, something nesting), about ${pct(lookChance(state, p))} a place by your best Scouting. Nobody makes a noise, but the hour passes (the Alert creeps up).`)}>Look around (${FOLK.LOOK.hours} h)</button>
      <button data-action="cc-low" data-id="${p.id}"${tip(`An hour off the street: the Alert falls by ${Math.round(CRAWL.ALERT.lieLow - CRAWL.ALERT.creep * CRAWL.LIE_LOW_HOURS)} (not below the city's own). Something may still find you (about ${pct(moveRisk(state, c, c.cell) * 0.4)}).`)}>Lie low (1 h)</button>
      ${slip}
    </div>
    <div class="row" style="margin-top:0.4rem;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">${moves}</div>
    <div class="row" style="margin-top:0.4rem;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">${exits}</div>`;
}

// The map of the city: its round grid of blocks, the ones you have been to (now or on an earlier visit) in their
// zombie activity's colour, those another group went through marked, your path this run, where you stand and which
// way you face; the rim (where you can walk out) a lighter edge. Unseen blocks dark. pick (the crawl still choosing
// where to go in): drawn bigger, every rim block a button (cc-start).
function cityMap(state, c, pick = null) {
  const g = c.grid, mem = crawlMemOf(state.tiles[c.tile]);
  const px = pick ? Math.max(9, Math.min(20, Math.floor(420 / g.size))) : Math.max(5, Math.min(11, Math.floor(200 / g.size)));
  const W = g.size * px;
  const col = ["#262a31", "#4f7a4c", "#7f8f45", "#9f8636", "#a8602e", "#a33a33"];
  const onPath = new Set(c.path);
  const rects = [];
  for (const [x, y] of cellsOf(g)) {
    const k = keyOf(x, y), seen = c.blocks[k] || mem.cells[k], rim = isEdge(g, x, y);
    const lv = seen ? (c.blocks[k] ? c.blocks[k].threat : mem.cells[k].threat) || 0 : 0;
    const fill = seen ? col[lv] : rim ? (pick ? "#4a525e" : "#30353d") : "#1d2026";
    const stroke = k === c.cell ? "#ffffff" : onPath.has(k) ? "#e8d27a" : pick && rim ? "#9aa4b2" : "";
    const what = `${seen ? CRAWL.THREAT.names[lv] || "" : "Not seen"}${mem.cells[k] && mem.cells[k].ai ? " · another group went through" : ""}${mem.cells[k] && mem.cells[k].day != null ? ` · you were here on day ${mem.cells[k].day}` : ""}`;
    const rect = `<rect x="${x * px}" y="${y * px}" width="${px - 1}" height="${px - 1}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${k === c.cell ? 1.5 : 1}"` : ""}>${seen || (pick && rim) ? `<title>${esc(what)}${pick && rim ? " — go in here" : ""}</title>` : ""}</rect>`;
    rects.push(pick && rim ? `<g data-action="cc-start" data-id="${pick.id}" data-cell="${k}" style="cursor:pointer">${rect}</g>` : rect);
    if (mem.cells[k] && mem.cells[k].ai) rects.push(`<circle cx="${x * px + px / 2 - 0.5}" cy="${y * px + px / 2 - 0.5}" r="${Math.max(1, px / 6)}" fill="#c9c9c9" pointer-events="none"/>`);
  }
  if (c.cell) {
    const at = /^c(-?\d+)_(-?\d+)$/.exec(c.cell) || [0, 0, 0];
    const ax = Number(at[1]) * px + px / 2, ay = Number(at[2]) * px + px / 2, d = [[0, -1], [1, 0], [0, 1], [-1, 0]][c.heading];
    rects.push(`<line x1="${ax}" y1="${ay}" x2="${ax + d[0] * px * 1.2}" y2="${ay + d[1] * px * 1.2}" stroke="#ffffff" stroke-width="1.5"/>`);
  }
  const help = pick ? `${c.city}: ${g.size} blocks across. Click a block on its rim (outlined) to go in there, heading in toward the centre. Blocks your teams have been to show their zombie activity (green quiet → red crawling); a dot: another group went through since. The centre is deepest: the most dangerous and the richest.`
    : `${c.city}: ${g.size} blocks across. Blocks you have been to show their zombie activity (green quiet → red crawling); a dot: another group went through since; the gold outline: your path this run (the way back); white: where you stand, the line the way you face. The lighter rim is the edge: you can walk out from any block on it.`;
  return `<div class="small"${tip(help)}><svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" style="display:block">${rects.join("")}</svg></div>`;
}
// Before going in: the city's map, every rim block a way in.
function startCard(state, p, c, msg) {
  const n = partyMembers(state, p).length;
  return `<div class="box wide crawl"><h1>${esc(c.city)}<span class="muted small" style="font-weight:normal"> — where to go in</span></h1>
    <div class="small" style="margin-bottom:0.5rem">Pick a block on the edge of ${esc(c.city)} to go in at: you start there, heading in toward the centre. The deeper in, the more dangerous and the richer; any block on the edge is a way out again. Alert: <b>${alertName(c.alert)}</b> (${Math.round(c.alert)}). ${n} ${n === 1 ? "person" : "people"} going in${c.hadVehicle ? "; the vehicle waits outside" : ""}.</div>${msg}
    <div class="row" style="justify-content:center">${cityMap(state, c, p)}</div>
    <div class="row" style="margin-top:0.6rem;justify-content:flex-end"><button data-action="cc-out" data-id="${p.id}"${tip("Do not go in after all: the team waits outside the city for orders.")}>Turn back</button></div>
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
    <div class="small muted"><span${tip(storeyTip)}>${esc(placeHint(state, c, pl))}</span> · ${esc(hint.size)}, ${hint.rooms} rooms${picked}</div>
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
  return `<div class="card"><b>${esc(E.title)}</b>${E.blocking ? ` <span class="chip off">blocks the way ${DIR_NAMES[ev.dir ?? c.heading]}</span>` : ""}<div class="small" style="margin:0.2rem 0 0.35rem">${esc(E.text)}</div>
    <div class="row" style="gap:0.35rem;flex-wrap:wrap">${eventChoices(state, p, ev).map((ch) => `<button data-action="cc-event" data-id="${p.id}" data-ev="${ev.id}" data-ch="${ch.id}"${tip(ch.tip)}>${esc(ch.label)}</button>`).join("")}</div></div>`;
}

function encounterCard(state, p, c) {
  const e = c.enc;
  if (e.fighting) return `<div class="card attn"><b>Fighting</b><div class="small">${esc(e.text)}</div></div>`;
  const opts = encounterOptions(state, p);
  const title = e.kind === "patrol" ? "Raiders" : e.kind === "breakout" ? "Fight your way out" : e.kind === "turned" ? "One of you turned" : "The dead";
  return `<div class="card attn"><b>${esc(title)}${e.spotted ? " — they have seen you" : ""}</b>
    <div class="small" style="margin:0.25rem 0 0.5rem">${esc(e.text)}${e.exit ? " They stand between you and the way out." : e.move ? ` You were on your way ${DIR_NAMES[e.heading ?? c.heading]}.` : ""}</div>
    <div class="choices">${opts.map((o) => `<button data-action="cc-enc" data-id="${p.id}" data-ch="${o.id}" ${o.disabled ? "disabled" : ""}>${esc(o.label)}<span class="hint">${esc(o.tip)}</span></button>`).join("")}</div></div>`;
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
  "cc-next": run((state, p, d) => nextBlock(state, p, d.way || "north")),
  "cc-out": run((state, p) => walkOut(state, p)),
  "cc-start": run((state, p, d) => pickStart(state, p, d.cell)),
  "cc-slip": run((state, p) => slipAway(state, p)),
  "cc-low": run((state, p) => lieLow(state, p)),
  "cc-look": run((state, p) => lookAround(state, p)),
  "cc-take": run((state, p, d) => takeLeft(state, p, Number(d.i) || 0)),
};
