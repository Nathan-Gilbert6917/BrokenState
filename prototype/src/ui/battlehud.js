// The battle HUD over the map (user requests 2026-10-09): the selected unit's weapon panel (drawn on the bottom bar,
// ui/battlebar.js), the squad strip (top left: a row per person of yours, always there, with who is off screen), big
// colour-coded hit chances over the enemies (and the breakdown of the one under the mouse), and markers at the edge of
// the view pointing at your people off screen. ui/combat.js calls hudPaint (canvas, every frame) and hudSync (DOM)
// from drawCombat.
//   - Numbers: every hit chance is the sim's own (sim/combat.js shotOdds / meleeOdds, through ui/combat.js odds): the
//     breakdown is shotOdds' own steps (opts.parts), so it cannot drift from the roll a shot makes.
//   - Cost: the DOM is written only when what it shows changed (a key per part, built from a few numbers each frame);
//     the canvas marks are a handful of rectangles and texts.
//   - The strip folds to a narrow column (its header, or ` : bview.hud); folded or not is kept in this browser.
import { WEAPONS, active, isRanged, hasMag, magShown, magMaxOf, magEmpty, arrowsLeft, shotOdds, meleeOdds, heightAt, sidearmOf, CRIT_MULT } from "../sim/combat.js";
import { tracksMags, isShellGun, shellsAt, shellKind, spareSplit, roundSplit, SHELLS, MAGS , isStacked, gunStackText } from "../sim/mags.js"; // roundSplit: the reserve rounds at hand, in the pack, the team's (a Reload from the pack takes both actions)
import { roundsOf, unitRound, loadOf } from "../sim/ammo.js";
import { CALIBERS, AMMO_TYPES } from "../sim/data-ammo.js";
import { gunQ, gunCond, jamChance, modesOf, modeOf, modeRolls, modeAim, FIRE_MODES } from "../sim/gunfire.js";
import { glLabel } from "../sim/launchers.js";
import { earStatus } from "../sim/hearing.js";
import { handsBusy, armsText, handsCount, HANDS_MAX } from "../sim/carry.js";
import { carriedPiece } from "../sim/furnicarry.js"; // a piece of furniture in the arms (issue #12): the HANDS chip names it (issue #17)
import { tiredLevel, TIRED_WORDS } from "../sim/sleep.js";
import { gunURL, isGunKey } from "./gunart.js";
import { project, LV, liftOf, onFloor, isoOnScreen, ISO_ZOOMS, iso } from "./isoview.js";
import { PAL, tier3 } from "./palette.js";
import { statusIcons } from "./status.js";
import { unitCanvas, canvasURL, spriteImg } from "./sprites.js";
import { keyLabel } from "./keymap.js";
import { concealChip } from "../sim/softcover.js"; // HIDDEN: in or beside a bush or a tent

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const first = (u) => String(u.name || "").split(" ")[0];
const signed = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`;
// A hit chance's colour: green 65 and up, amber 35–64, red under 35 (the panel's odds line, the map's labels).
export const hitTone = (c) => (c >= 65 ? "good" : c >= 35 ? "warn" : "danger");
export const hitColor = (c) => tier3(c, 65, 35);

// ---------- folded or open (kept in this browser) ----------
const HUD_KEY = "brokenstate.battleHud";
export const HUD = (() => { try { const v = typeof localStorage !== "undefined" ? localStorage.getItem(HUD_KEY) : null; return { open: v !== "folded" }; } catch { return { open: true }; } })();
export function toggleHud(on = !HUD.open) {
  HUD.open = !!on;
  try { localStorage.setItem(HUD_KEY, HUD.open ? "open" : "folded"); } catch { /* storage blocked: this session only */ }
  return HUD.open;
}

// ---------- the weapon ----------
// Short names of the round types (the chip on the magazine line).
export const AMMO_SHORT = { fmj: "FMJ", hp: "HP", ap: "AP", buck: "Buck", slug: "Slug", sp: "SP", plusp: "+P", subsonic: "Subsonic", match: "Match", tracer: "Tracer", ball: "Ball", birdshot: "Birdshot", rubber: "Rubber", beanbag: "Beanbag" };
const typeShort = (t) => AMMO_SHORT[t] || (AMMO_TYPES[t] ? AMMO_TYPES[t].name : t || "");
// What the weapon panel shows of a unit's weapon (pure data; tools/battlehudtest.js reads it):
// { name, key, ranged, bow, mag: { in, cap } | null, empty, cal, load, loadShort, reserve, rounds: roundSplit | null
//   (the reserve by where: hand, pack, mate, pool), spares: spareSplit | null, shells: { at, pack, kind } | null, clips,
//   modes, mode, rolls, jam, jamPct, cond, q, melee: { chance, dmg } | null, arrows, sidearm, launcher }
export function weaponInfo(state, b, u) {
  const w = WEAPONS[u.weapon] || {};
  const ranged = isRanged(u);
  const gun = ranged && !w.arrows && !w.acid;
  const info = { name: u.weaponName || w.name || u.weapon, key: u.weapon, ranged, gun, bow: !!w.arrows, mag: null, empty: false, cal: "", load: null, loadShort: "", reserve: null, rounds: null, spares: null, shells: null, clips: 0, modes: [], mode: null, rolls: 1, jam: null, jamPct: 0, cond: null, q: null, melee: null, arrows: null, sidearm: "", launcher: "" };
  if (gun) {
    const r = unitRound(u); // the round loaded: its own calibre (a 5.56 gun with .223 in it shows ".223 Rem")
    const c = CALIBERS[r ? r.cal : w.cal];
    info.cal = c ? c.name : "";
    info.calKey = r ? r.cal : w.cal || null;
    info.otherCal = !!(r && r.cal !== w.cal); // another calibre than the gun's own (.223 in a 5.56 gun, .38 in a .357)
    info.load = r ? r.type : c ? c.base : null;
    info.loadShort = typeShort(info.load);
    if (hasMag(u)) { info.mag = { in: magShown(b, u), cap: magMaxOf(u) }; info.empty = magEmpty(b, u); info.stack = gunStackText(b, u); } // stack: the rounds in the gun, the chamber first (mags.js: physical rounds)
    if (u.side === "player" && info.load) { info.reserve = Math.max(0, Math.floor(roundsOf(b, u, loadOf(u))) - (info.mag ? info.mag.in : 0)); info.rounds = roundSplit(b, u); } // every round of the type to hand, past the ones loaded; by where (mags.js: a pocket or the rig 1 action, the pack both)
    if (isShellGun(u)) { const s = shellsAt(b, u); info.shells = { at: s.at, pack: s.pack, kind: shellKind(u) }; }
    else if (tracksMags(u) && u.magMode !== "internal") info.spares = spareSplit(b, u);
    else if (tracksMags(u)) info.clips = (u.clips || []).filter((x) => !x.used).length;
    info.modes = modesOf(u);
    info.mode = info.modes.length > 1 ? modeOf(u) : null;
    info.rolls = modeRolls(u);
    info.jam = u.jam ? u.jam.kind || "jam" : null;
    info.jamPct = jamChance(b, u);
  }
  if (w.arrows) info.arrows = Math.floor(arrowsLeft(b));
  if (u.item || u.cond != null) { info.cond = gunCond(u); if (gun) info.q = gunQ(u); }
  if (!ranged) { const o = meleeOdds(b, u, { x: u.x, y: u.y, hunker: false }); info.melee = { chance: o.chance, dmg: o.dmg, crit: o.crit }; } // against someone level with them, not hunkered
  const s = u.side === "player" && u.sid != null && state && state.survivors ? state.survivors.find((x) => x.id === u.sid) : null;
  const sa = s ? sidearmOf(s) : null;
  if (sa && sa.key !== u.weapon) info.sidearm = (WEAPONS[sa.key] && WEAPONS[sa.key].name) || sa.name || sa.key;
  if (u.gl) info.launcher = glLabel(b, u);
  return info;
}

// The magazine drawn: a pip a round up to 15 (a pistol, a shotgun, a bolt rifle), else a bar.
function magBar(m, empty) {
  const f = m.cap ? Math.max(0, Math.min(1, m.in / m.cap)) : 0;
  const cls = empty || m.in === 0 ? "danger" : f <= 0.25 ? "warn" : "good";
  if (m.cap <= 15) return `<span class="bh-pips ${cls}">${"<i class=on></i>".repeat(m.in)}${"<i></i>".repeat(Math.max(0, m.cap - m.in))}</span>`;
  return `<span class="bh-magbar ${cls}"><i style="width:${(f * 100).toFixed(1)}%"></i></span>`;
}
const pctTxt = (f) => `${Math.round(f * 100)}%`;
function weaponIcon(u, info) {
  if (info.gun && isGunKey(u.weapon)) {
    const url = gunURL(u.item && u.item.key === u.weapon ? u.item : { key: u.weapon });
    if (url) return `<img class="bh-gunart" src="${url}" alt="">`;
  }
  return `<span class="bh-glyph">${info.bow ? "➶" : info.ranged ? "⁍" : "⚔"}</span>`;
}

// The weapon panel of the selected unit (HTML). "" when there is nothing to show.
export function weaponPanelHtml(state, b, u) {
  if (!u || u.side !== "player" || u.dead) return "";
  const info = weaponInfo(state, b, u);
  const k = (id, d) => keyLabel(id, 1) || d;
  const rows = [];
  const condCls = info.cond == null ? "" : info.cond < 0.35 ? "danger" : info.cond < 0.65 ? "warn" : "good";
  const cond = info.cond == null ? "" : `<span class="bh-cond ${condCls}" data-tip="${esc(`Condition ${pctTxt(info.cond)}: uses left of its full.${info.q != null ? ` Quality ${pctTxt(info.q)}.` : ""}${info.gun ? " A worn or poor gun jams more; a hard jam wears it." : ""}`)}">${pctTxt(info.cond)}</span>`;
  const mode = info.mode ? `<span class="bh-mode" data-tip="${esc(`Fire mode (${k("battle.firemode", "Shift+F")}, free): ${info.modes.map((m) => (FIRE_MODES[m] || {}).name || m).join(" → ")}.${info.rolls > 1 ? ` ${info.rolls} rounds a trigger pull, each its own roll.` : ""}`)}">${esc((FIRE_MODES[info.mode] || {}).name || info.mode)}${info.rolls > 1 ? ` ×${info.rolls}` : ""}</span>` : "";
  rows.push(`<div class="bh-wtop">${weaponIcon(u, info)}<b class="bh-wname">${esc(info.name)}</b>${mode}${cond}</div>`);
  if (info.mag) {
    const tip = `${info.mag.in} rounds in the ${info.shells ? "tube" : "magazine"}, ${info.mag.cap} it holds${info.cal ? `. ${info.cal}, ${info.stack ? `the chamber ${AMMO_TYPES[info.load] ? AMMO_TYPES[info.load].name : info.load} (in the gun, the chamber first: ${info.stack})` : `loaded with ${AMMO_TYPES[info.load] ? AMMO_TYPES[info.load].name : info.load}`}${info.otherCal ? ` (not its own ${CALIBERS[WEAPONS[u.weapon].cal] ? CALIBERS[WEAPONS[u.weapon].cal].name : ""}: a round it also takes)` : ""}` : ""}.${info.reserve != null ? ` ${info.reserve} more of these rounds on them, past the ones loaded.` : ""}`;
    rows.push(`<div class="bh-magline" data-tip="${esc(tip)}">${magBar(info.mag, info.empty)}<b class="bh-count ${info.empty ? "danger" : ""}">${info.mag.in}<span class="muted"> / ${info.mag.cap}</span></b>${info.cal ? `<span class="bh-cal${info.otherCal ? " warn" : ""}">${esc(info.cal)}</span>` : ""}${info.loadShort ? `<span class="bh-load">${esc(info.loadShort)}</span>` : ""}</div>`);
  } else if (info.arrows != null) rows.push(`<div class="bh-magline"><b class="bh-count ${info.arrows < 1 ? "danger" : ""}">${info.arrows}</b><span class="muted"> arrows and bolts carried</span></div>`);
  // Spares: a shotgun's shells at hand and in the pack, a rifle's magazines, clips and speedloaders.
  const spare = [];
  if (info.shells) {
    const s = info.shells, perLoad = isStacked(u) ? `up to ${MAGS.LOOSE}` : s.kind === "break" ? SHELLS.BREAK : s.kind === "single" ? 1 : `${SHELLS.MIN}–${SHELLS.MAX}`;
    spare.push(`<span class="${s.at < 1 ? "danger" : ""}" data-tip="${esc(`Shells at hand (pockets, rig): a Reload (1 action) loads ${perLoad} from these${isStacked(u) ? ", in the order picked (the first is in the chamber)" : ""}.`)}">${s.at} at hand</span>`);
    spare.push(`<span class="${s.at < 1 && s.pack > 0 ? "warn" : "muted"}" data-tip="${esc(isStacked(u) ? "Shells in the pack: a Reload from them takes both actions (the Inventory window moves a box to a pocket for 1 action). Only what they carry loads the gun: never a teammate's or the team's bags." : `Shells in the pack: a Reload straight from them takes both actions; Get shells (1 action) takes up to ${SHELLS.GRAB} out, loose at hand, for 1-action Reloads.`)}">${Number.isFinite(s.pack) ? s.pack : "∞"} in the pack</span>`);
  } else if (info.spares) {
    const h = info.spares.hand, p = info.spares.pack;
    if (!h.mags && !p.mags) spare.push(`<span class="warn" data-tip="${esc(isStacked(u) ? `No loaded spare magazine: a Reload puts up to ${MAGS.LOOSE} rounds by hand into the one in the gun, out of what they carry (${MAGS.SOURCE_AP.hand} action from a pocket or the rig, both from the pack).` : `No loaded spare magazine: a Reload tops up the one in the gun from the rounds to hand (${MAGS.SOURCE_AP.hand} action from a pocket or the rig, both from the pack, ${MAGS.TOPUP_AP} from a teammate's or the team's bags).`)}">no spare mags</span>`);
    else spare.push(`<span data-tip="${esc("Loaded spare magazines in rig pouches and pockets: a Reload from one is 1 action.")}">${h.mags} mag${h.mags === 1 ? "" : "s"} at hand${h.rounds ? ` <span class="muted">(${h.rounds})</span>` : ""}</span>`);
    if (h.mags || p.mags) spare.push(`<span class="muted" data-tip="${esc("Loaded spare magazines in the pack: a Reload from one is 2 actions. With no loaded spare left, a Reload tops up the one in the gun from the rounds to hand (1 action from a pocket or the rig, both from the pack).")}">${p.mags} in the pack${p.rounds ? ` (${p.rounds})` : ""}</span>`);
    if (h.empty + p.empty) spare.push(`<span class="muted">${h.empty + p.empty} empty</span>`);
  } else if (info.clips) spare.push(`<span data-tip="Clips or speedloaders: a Reload with one fills the gun at once.">${info.clips} ${info.clips === 1 ? "clip" : "clips"}</span>`);
  // The reserve rounds by where they are (mags.js roundSplit): at hand (a pocket or the rig: 1 action), in the pack (both actions), the team's (a teammate's boxes, the bags: both actions too).
  if (info.rounds && !info.shells) {
    const r = info.rounds, team = r.mate + r.pool;
    spare.push(`<span class="${r.hand > 0 ? "" : "muted"}" data-tip="${esc(isStacked(u) ? `Rounds of this calibre and type loose or boxed in the pockets and the rig: a Reload by hand from them (up to ${MAGS.LOOSE}) is 1 action. Only what they carry: never a teammate's or the team's bags.` : "Rounds of this calibre and type loose or boxed in the pockets and the rig, past the ones loaded: a top-up or an internal magazine's Reload from them is 1 action.")}">${r.hand} rds at hand</span>`);
    if (r.pack > 0) spare.push(`<span class="muted" data-tip="${esc("In the pack, past the ones loaded: a Reload from them takes both actions (the Inventory moves a box to a pocket for 1 action).")}">${r.pack} in the pack</span>`);
    if (team > 0) spare.push(`<span class="muted" data-tip="${esc(`A teammate's boxes and the team's bags, past the ones loaded: a top-up or an internal magazine's Reload from them takes both actions, like the pack.`)}">${team} the team's</span>`);
  }
  if (spare.length) rows.push(`<div class="bh-spare">${spare.join('<span class="bh-dot">·</span>')}</div>`);
  // The state of the gun: jammed, empty, the jam risk.
  const st = [];
  if (info.jam) st.push(`<b class="danger" data-tip="${esc(`Jammed (${info.jam}): Unjam (${k("battle.unjam", "Shift+J")}) clears it${info.jam === "double" ? "; a Reload does too" : ""}.`)}">JAMMED</b>`);
  else if (info.empty) st.push(`<b class="danger">EMPTY — Reload (${esc(k("battle.reload", "I"))})</b>`);
  if (info.gun && info.jamPct > 0.0005) { const pull = 1 - Math.pow(1 - info.jamPct, Math.max(1, info.rolls)); st.push(`<span class="${pull >= 0.05 ? "warn" : "muted"}" data-tip="${esc(`The chance a trigger pull jams or misfires now (${info.rolls} round${info.rolls === 1 ? "" : "s"}): the gun's quality and condition, the round, its parts, the weather and the fouling.`)}">jam ${pull < 0.01 ? "<1" : Math.round(pull * 100)}%</span>`); }
  if (info.melee) st.push(`<span data-tip="${esc(`A blow against someone level with ${first(u)}: ${info.melee.chance}% to hit, ${info.melee.dmg[0]}–${info.melee.dmg[1]} damage, ${info.melee.crit}% crit (×${CRIT_MULT}). Hover an enemy next to them for the real odds.`)}">Melee <b>${info.melee.chance}%</b> · ${info.melee.dmg[0]}–${info.melee.dmg[1]} dmg</span>`);
  if (info.launcher) st.push(`<span data-tip="The launcher beside the gun (Shift+L).">${esc(info.launcher)}</span>`);
  if (info.sidearm) st.push(`<span class="muted" data-tip="${esc(`A sidearm in the off hand or a pocket: what ${first(u)} fights with when the main weapon leaves the hands (a thrown spear).`)}">Sidearm: ${esc(info.sidearm)}</span>`);
  if (st.length) rows.push(`<div class="bh-wstate">${st.join('<span class="bh-dot">·</span>')}</div>`);
  return `<div class="bh-wpanel">${rows.join("")}</div>`;
}

// ---------- the hit chance and its breakdown ----------
// The breakdown of o (ui/combat.js odds, tagged kind "shot" or "melee") as lines: [[label, value]], the total and the
// clamp. The steps come from the sim's own function (opts.parts), with the same chance as o.
export function hitBreakdown(b, u, t, o) {
  if (!o || !o.ok || (o.kind !== "shot" && o.kind !== "melee")) return null;
  const r = o.kind === "shot" ? shotOdds(b, u, t, u.x, u.y, { parts: true }) : meleeOdds(b, u, t, { parts: true });
  if (!r || !r.parts || r.chance !== o.chance) return null;
  const lo = o.kind === "shot" ? 5 : 10;
  const out = { parts: r.parts, aim: r.aim, chance: r.chance, clamped: Math.round(r.aim) !== r.chance ? (r.aim < lo ? `at least ${lo}%` : "at most 95%") : "", follow: [] };
  // A burst or a stream: each later round's own roll (sim/combat.js fire: round k at the mode's aim for k).
  if (o.kind === "shot") {
    const w = WEAPONS[u.weapon], n = modeRolls(u);
    if (n > 1) for (let k = 1; k < Math.min(n, 6); k++) out.follow.push(shotOdds(b, u, t, u.x, u.y, { modeAim: modeAim(modeOf(u), k, w) }).chance);
  }
  return out;
}
export function breakdownHtml(bd) {
  if (!bd) return "";
  const rows = bd.parts.filter(([, v]) => Math.round(v)).map(([l, v]) => `<div class="bh-bdrow"><span>${esc(l)}</span><b class="${v >= 0 ? "good" : "danger"}">${signed(v)}</b></div>`).join("");
  return `<div class="bh-bd">${rows}<div class="bh-bdrow bh-bdsum"><span>${bd.clamped ? `Total ${Math.round(bd.aim)}, ${bd.clamped}` : "Chance to hit"}</span><b class="${hitTone(bd.chance)}">${bd.chance}%</b></div>${bd.follow.length ? `<div class="bh-bdrow muted"><span>Then round by round</span><span>${bd.follow.map((c) => `${c}%`).join(" · ")}</span></div>` : ""}</div>`;
}
// The cover's source when it is the height's (sim/combat.js coverAgainst high; the user's word 2026-10-23: "Half
// cover: hill"): ": hill", ": higher ground".
const highWord = (o) => (o && o.high ? `: ${o.high === "hill" ? "hill" : "higher ground"}` : "");
// The card over the weapon panel while an enemy is under the mouse: who, the chance big, damage and cover, the steps.
export function targetCardHtml(b, u, t, o) {
  if (!u || !t || !o) return "";
  if (!o.ok) return `<div class="bh-target"><div class="bh-thead"><b>${esc(t.name)}</b><span class="bh-big muted">—</span></div><div class="small muted">${esc(o.label)}</div></div>`;
  const bd = hitBreakdown(b, u, t, o);
  const what = o.kind === "melee" ? "melee" : o.kind === "shot" ? "to hit" : o.finish ? "finish" : "chance";
  const cover = o.kind === "shot" ? `${o.cover === 2 ? "full cover" : o.cover === 1 ? "half cover" : o.flanked ? "FLANKED" : "in the open"}${o.cover ? highWord(o) : ""}${o.conceal ? `, concealed ${o.conceal}` : ""}` : ""; // sim/softcover.js: a bush or a tent hides them, stops nothing
  const dmg = o.dmg ? `${o.dmg[0]}–${o.dmg[1]} dmg${o.crit != null ? ` · ${o.crit}% crit` : ""}` : "";
  return `<div class="bh-target"><div class="bh-thead"><span><b>${esc(t.name)}</b> <span class="muted small">${Math.round(t.hp)}/${t.maxHp} hp</span></span><span class="bh-big ${hitTone(o.chance)}">${o.chance}%<small> ${what}</small></span></div>
    <div class="small muted">${[dmg, cover, o.dist != null && o.kind === "shot" ? `${Math.round(o.dist)} tiles` : ""].filter(Boolean).join(" · ")}</div>${breakdownHtml(bd)}</div>`;
}

// ---------- the squad strip ----------
// Status chips of a unit of yours: [text, class, tip].
export function unitChips(state, b, p) {
  const c = [];
  if (p.dead) return [["DEAD", "danger", "Dead."]];
  if (p.left) return [["OUT", "good", "Got away."]];
  if (p.down) c.push(p.stab ? ["DOWN", "warn", "Down, stabilized: a medic can get them up."] : ["DOWN", "danger", `Down and bleeding out: ${p.bleed} turn${p.bleed === 1 ? "" : "s"} left. Stabilize them (Use meds) or carry them out.`]);
  if (p.bleeding > 0) c.push([`BLEED ${p.bleeding}`, "danger", `Bleeding from a blade: ${p.bleeding} more turn${p.bleeding === 1 ? "" : "s"} of damage at the start of their turn.`]);
  if (p.pinT === b.turn) c.push(["PINNED", "warn", "Pinned by a machine-gun burst: worse aim this turn."]);
  if (p.suppressed > 0) c.push(["SUPP", "warn", "Suppressed: −20 aim, no overwatch until their turn ends."]);
  if (p.ow) c.push(["OW", "info", "On overwatch: shoots at the first enemy that moves in range."]);
  if (p.hunker) c.push(["HUNK", "info", "Hunkered down: harder to hit in cover."]);
  const hid = !p.down ? concealChip(b, p) : null; // sim/softcover.js: in or beside a bush or a tent
  if (hid) c.push(hid);
  if (p.vaulted > 0 && !p.down) c.push(["WINDED", "info", `Winded from a vault: ${p.vaulted} tile${p.vaulted === 1 ? "" : "s"} less of movement for the rest of this turn.`]); // sim/combat.js VAULT
  if (p.shaken && !p.down) c.push(["SHAKEN", "warn", "Shaken from being revived: worse aim for the rest of the battle."]);
  if (p.stun && !p.down) c.push([p.stun.dazed ? "DAZED" : "STUN", "warn", "Dazed or stunned by a flash or a taser."]);
  for (const e of earStatus(p)) c.push([e.split(" ")[0].toUpperCase(), "warn", e]);
  if (p.jam) c.push(["JAM", "danger", "The gun is jammed: Unjam clears it."]);
  const piece = p.piece ? carriedPiece(b, p) : null;
  if (piece) c.push([`✋✋ ${piece.def.name}`, "warn", `Both hands on ${armsText(p) || `the ${piece.def.name.toLowerCase()}`}. No shooting, doors, searching, vaulting, sneaking or dashing until it is set down (Set down) or loaded into the vehicle.`]);
  else if (handsBusy(p)) c.push([handsCount(p) >= HANDS_MAX ? "HANDS ✋✋" : "HANDS ✋", "warn", `${handsCount(p) >= HANDS_MAX ? "Both hands" : "Hands"} full: ${armsText(p)}. No shooting, reloading, doors or windows until it is set down (Drop carried: free; Set over cover) or stowed in the pack, the pockets or the vehicle.${handsCount(p) >= HANDS_MAX ? " Two different things carried: nothing more can be taken." : ""}`]);
  if (p.dragging != null) c.push(["DRAG", "warn", "Dragging someone: half speed, no shooting."]);
  if (p.gunner) c.push(["TURRET", "info", "On the vehicle's turret."]);
  else if (p.aboard) c.push(["IN CAR", "info", "In the vehicle."]);
  const s = p.sid != null && state && state.survivors ? state.survivors.find((x) => x.id === p.sid) : null;
  const tl = s ? tiredLevel(s) : 0;
  if (tl) c.push([TIRED_WORDS[tl].toUpperCase(), tl > 1 ? "danger" : "warn", `${TIRED_WORDS[tl]} from the watch: worse aim.`]);
  return c;
}
// One row of the strip. n: its number key (1–9), off: off screen (its direction: "◀" etc.).
function rosterRow(state, b, p, n, sel, off, salt, folded) {
  const f = Math.max(0, Math.min(1, p.hp / p.maxHp));
  const out = p.dead || p.left || p.fled;
  const alive = !out && !p.down;
  const cls = ["bh-row", p.id === sel ? "on" : "", out ? "out" : p.down ? "downed" : p.ap === 0 && b.phase === "player" ? "done" : "", off ? "off" : ""].filter(Boolean).join(" ");
  const ap = alive && b.phase === "player" ? `<span class="bh-ap">${"<i class=on></i>".repeat(Math.max(0, p.ap))}${"<i></i>".repeat(Math.max(0, 2 - p.ap))}</span>` : "";
  const hp = `<div class="bh-hp${p.bleeding > 0 || (p.down && !p.stab) ? " bleed" : ""}"><i style="width:${(f * 100).toFixed(0)}%;background:${f > 0.6 ? PAL.good : f > 0.3 ? PAL.mid : PAL.bad}"></i></div>`;
  const offTag = off ? `<span class="bh-offtag" data-tip="Off screen: click to bring the view to them.">${off}</span>` : "";
  const chips = unitChips(state, b, p);
  const gun = hasMag(p) && !out ? ` <b class="${magEmpty(b, p) ? "danger" : ""}">${magShown(b, p)}/${magMaxOf(p)}</b>` : "";
  const tip = `${p.name}: ${Math.round(p.hp)}/${p.maxHp} hp${alive && b.phase === "player" ? `, ${p.ap} action${p.ap === 1 ? "" : "s"} left` : ""}. ${p.weaponName}${hasMag(p) ? ` ${magShown(b, p)}/${magMaxOf(p)}` : ""}.${chips.length ? ` ${chips.map((x) => x[2]).join(" ")}` : ""}${off ? " Off screen." : ""} Click (or press ${n || "Tab"}) to select and center on them.`;
  const attrs = `class="${cls}" data-action="cb-sel" data-id="${p.id}" data-center="1" data-tip="${esc(tip)}"`;
  if (folded) return `<div ${attrs}><span class="bh-num">${n || ""}</span>${hp}${ap}${offTag}</div>`;
  const s = p.sid != null && state && state.survivors ? state.survivors.find((x) => x.id === p.sid) : null;
  const icons = s && !out ? statusIcons(state, s, { skip: ["health"] }) : "";
  let img = "";
  try { img = spriteImg(canvasURL(unitCanvas(state, b, p, salt)), 1.6); } catch { img = ""; } // no canvas (a headless tool)
  return `<div ${attrs}><span class="bh-num">${n || ""}</span><span class="bh-face">${img}</span><div class="bh-main">
    <div class="bh-name"><b>${esc(p.name)}</b>${ap}${offTag}</div>${hp}
    <div class="bh-sub"><span class="bh-hpn">${Math.round(p.hp)}</span><span class="bh-gun">${esc(p.weaponName)}${gun}</span></div>
    ${chips.length || icons ? `<div class="bh-chips">${chips.map(([t, c]) => `<span class="bh-chip ${c}">${esc(t)}</span>`).join("")}${icons}</div>` : ""}</div></div>`;
}
// The strip: a row per person of yours (not the volunteers: their own orders). offMap: id -> direction arrow ("" on screen).
export function rosterHtml(state, b, list, { sel = null, offMap = null, salt = 0, open = true } = {}) {
  if (!list.length) return "";
  const rows = list.map((p, i) => rosterRow(state, b, p, i < 9 ? i + 1 : 0, sel, offMap ? offMap.get(p.id) || "" : "", salt, !open)).join("");
  const nOff = offMap ? [...offMap.values()].filter(Boolean).length : 0;
  return `<div class="bh-roster${open ? "" : " folded"}"><button class="bh-fold" data-action="cb-view" data-v="hud" data-tip="${esc(`${open ? "Fold" : "Open"} the squad strip (${keyLabel("bview.hud", 1) || "`"}).`)}">${open ? "Squad ▴" : "▾"}${nOff && open ? ` <span class="bh-offn">${nOff} off screen</span>` : ""}</button>${rows}</div>`;
}

// ---------- off screen ----------
// Which way a cell off screen lies (an arrow), "" on screen. After drawIso set the frame (isoview.js project).
const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
export function offDir(b, u, cw, ch) {
  if (!u || u.off || u.dead || u.left || u.fled || u.x < 0) return "";
  if (!onFloor(b, u)) return `F${(u.f || 0) + 1}`;
  if (isoOnScreen(b, u.x, u.y, 24)) return "";
  const [X, Y] = project(u.x + 0.5, u.y + 0.5, heightAt(b, u.x, u.y) * LV + liftOf(b));
  const a = Math.atan2(Y - ch / 2, X - cw / 2);
  return ARROWS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

// ---------- the canvas marks ----------
const uiScale = () => { try { return Number(document.documentElement.style.getPropertyValue("--ui-scale")) || 1; } catch { return 1; } };
function pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// A hit badge centred at (X, Y): the chance big, optional small second line.
function badge(ctx, X, Y, text, col, fs, sub = "", strong = false) {
  ctx.font = `800 ${fs}px Segoe UI, sans-serif`;
  const tw = ctx.measureText(text).width;
  let sw = 0;
  const sfs = Math.max(11, Math.round(fs * 0.55));
  if (sub) { ctx.font = `600 ${sfs}px Segoe UI, sans-serif`; sw = ctx.measureText(sub).width; }
  const w = Math.max(tw, sw) + fs * 0.6, h = fs * 1.12 + (sub ? sfs * 1.2 : 0), x = X - w / 2, y = Y - h;
  ctx.fillStyle = "rgba(12,14,17,0.92)"; pill(ctx, x, y, w, h, Math.min(8, fs * 0.35)); ctx.fill();
  ctx.lineWidth = strong ? 2.5 : 1.5; ctx.strokeStyle = col; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.font = `800 ${fs}px Segoe UI, sans-serif`; ctx.fillStyle = col;
  ctx.fillText(text, X, y + fs * 0.98);
  if (sub) { ctx.font = `600 ${sfs}px Segoe UI, sans-serif`; ctx.fillStyle = "#e6e2d8"; ctx.fillText(sub, X, y + fs * 1.05 + sfs); }
}
// Over each enemy the selected unit could hit: its chance (bigger while Shoot or Melee is armed); the one under the
// mouse a big card with damage and cover. hits: Map id -> odds (ui/combat.js hitLabels); hoverT/hoverO: the enemy
// under the mouse and its odds. Your people off screen: a blue arrow with their number at the edge of the view.
export function hudPaint(ctx, b, { cw, ch, hits, hoverT, hoverO, mode, list, sel, avoid, bottom = 0 }) {
  const S = ISO_ZOOMS[iso.zoom] || 2, ui = uiScale();
  const armed = mode === "shoot" || mode === "melee";
  const head = (t) => { const big = t.size === 2 ? 1.3 : t.boss ? 1.35 : t.ztype === "brute" ? 1.15 : 1, h = (t.size || 1) / 2; return project(t.x + h, t.y + h, heightAt(b, t.x, t.y) * LV + liftOf(b) + (t.down ? 10 : 30 * big)); }; // a 2 × 2 boss: over its footprint's centre
  const tagRoom = Math.max(10, Math.round(3.4 * S)) + 14; // the health bar and the tags over a head (isoview.js drawLabels)
  if (hits && hits.size) {
    const fs = Math.round(Math.min(26, Math.max(armed ? 17 : 13, (armed ? 4.6 : 3.8) * S)) * ui);
    for (const t of b.units) {
      const o = hits.get(t.id);
      if (!o || (hoverT && hoverT.id === t.id) || !onFloor(b, t)) continue;
      const [X, Y] = head(t);
      badge(ctx, X, Y - tagRoom, `${o.chance}%`, hitColor(o.chance), fs, "", armed);
    }
  }
  if (hoverT && hoverO) {
    const [X, Y] = head(hoverT);
    const fs = Math.round(Math.min(40, Math.max(22, 6.5 * S)) * ui);
    if (hoverO.ok) {
      const cover = hoverO.kind === "shot" ? (hoverO.cover === 2 ? `full cover${highWord(hoverO)}` : hoverO.cover === 1 ? `half cover${highWord(hoverO)}` : hoverO.flanked ? "FLANKED" : "") : "";
      const sub = [hoverO.kind === "melee" ? "melee" : hoverO.kind === "shot" ? "to hit" : "", hoverO.dmg ? `${hoverO.dmg[0]}–${hoverO.dmg[1]} dmg` : "", cover].filter(Boolean).join(" · ");
      badge(ctx, X, Y - tagRoom, `${hoverO.chance}%`, hitColor(hoverO.chance), fs, sub, true);
    } else {
      const why = String(hoverO.label || "").split(/[.:(]/)[0].slice(0, 40);
      badge(ctx, X, Y - tagRoom, "—", "#9aa0a8", Math.round(fs * 0.7), why, false);
    }
  }
  // Your people with their hands full (sim/carry.js): a mark over their heads, so it is seen on the map itself.
  if (list && list.length && !b.over) {
    const fs = Math.round(Math.min(18, Math.max(11, 3.2 * S)) * ui);
    for (const p of list) {
      if (!handsBusy(p) || p.dead || p.left || p.fled || p.off || p.down || !onFloor(b, p) || (hits && hits.get(p.id)) || (hoverT && hoverT.id === p.id)) continue;
      const [X, Y] = head(p);
      const piece = p.piece ? carriedPiece(b, p) : null; // a piece of furniture: its name (issue #17)
      badge(ctx, X, Y - tagRoom, piece ? `✋✋ ${piece.def.name}` : handsCount(p) >= HANDS_MAX ? "✋✋ hands full" : "✋ hands full", "#ffb347", fs, "", false);
    }
  }
  // Your people off screen: an arrow at the edge with their number, clear of the strip (avoid: its rect).
  if (list && list.length && !b.over) {
    const chA = Math.max(60, ch - bottom); // above the bottom bar (ui/battlebar.js)
    const m = 18, cx = cw / 2, cy = chA / 2;
    const fs = Math.round(11 * ui);
    const placed = [];
    list.forEach((p, i) => {
      if (p.dead || p.left || p.fled || p.off || p.down && p.dead || p.x < 0 || !onFloor(b, p)) return;
      const [X, Y] = project(p.x + 0.5, p.y + 0.5, heightAt(b, p.x, p.y) * LV + liftOf(b) + 15);
      if (X >= m && Y >= m && X <= cw - m && Y <= chA - m) return;
      const dx = X - cx, dy = Y - cy;
      const k = Math.min((cw / 2 - m) / Math.max(1e-6, Math.abs(dx)), (chA / 2 - m) / Math.max(1e-6, Math.abs(dy)));
      let ex = cx + dx * k, ey = cy + dy * k;
      if (avoid && ex < avoid.x1 + m && ey < avoid.y1 + m) { if (ex - avoid.x1 < ey - avoid.y1) ex = avoid.x1 + m; else ey = avoid.y1 + m; } // not under the strip
      if (ex < 80 && ey > chA - 80) { if (Math.abs(dx) * chA > Math.abs(dy) * cw) ey = chA - 80; else ex = 80; } // nor the compass (isoview.js drawCompass)
      const side = Math.abs(ex - m) < 2 || Math.abs(ex - (cw - m)) < 2 || ex === avoid?.x1 + m; // on a left or right edge: stack along it
      for (let g = 0; g < 12 && placed.some(([qx, qy]) => Math.hypot(qx - ex, qy - ey) < 20); g++) { if (side) ey += ey > chA / 2 ? -20 : 20; else ex += ex > cw / 2 ? -20 : 20; }
      placed.push([ex, ey]);
      const col = p.id === sel ? "#ffd166" : "#8fc1ff";
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = col; ctx.strokeStyle = "rgba(15,17,20,0.9)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-5, -8); ctx.lineTo(-2, 0); ctx.lineTo(-5, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (i < 9) {
        const lx = ex - Math.cos(Math.atan2(dy, dx)) * 16, ly = ey - Math.sin(Math.atan2(dy, dx)) * 16;
        ctx.font = `800 ${fs}px Segoe UI, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(15,17,20,0.9)"; ctx.strokeText(String(i + 1), lx, ly);
        ctx.fillStyle = col; ctx.fillText(String(i + 1), lx, ly);
        ctx.textBaseline = "alphabetic";
      }
    });
  }
}

// ---------- the DOM ----------
// Writes the strip and the target card into #cbhud, each only when its key changed. args: { state,
// b, list (your people, in number-key order), sel, salt, cw, ch, hoverT, hoverO, mode }. Returns the strip's rect
// (CSS px in the map) for the edge arrows, or null.
const shown = { roster: null, weapon: null, target: null, rect: null };
export function hudSync(el, { state, b, list, sel, salt, cw, ch, hoverT, hoverO, mode }) {
  if (!el) return null;
  if (!el.firstChild || !el.querySelector || !el.querySelector(".bh-rosterbox")) {
    el.innerHTML = `<div class="bh-rosterbox"></div><div class="bh-bottom"><div class="bh-targetbox"></div></div>`;
    shown.roster = shown.target = null;
  }
  const hide = !!b.over;
  el.classList.toggle("hidden", hide);
  if (hide) return null;
  const u = sel != null ? b.units.find((x) => x.id === sel) : null;
  // The strip: who is off screen (and which way), everyone's hp, actions, gun and state.
  const offMap = new Map();
  for (const p of list) offMap.set(p.id, offDir(b, p, cw, ch));
  const sig = list.map((p) => `${p.id}:${Math.round(p.hp)}:${p.ap}:${p.down ? 1 : 0}${p.dead ? 1 : 0}${p.left ? 1 : 0}${p.stab ? 1 : 0}:${p.bleeding || 0}:${p.mag}:${p.weapon}:${p.ow ? 1 : 0}${p.hunker ? 1 : 0}${p.suppressed > 0 ? 1 : 0}${p.jam ? 1 : 0}${p.stun ? 1 : 0}:${offMap.get(p.id)}`).join("|");
  const rk = `${b.rev}:${b.turn}:${b.phase}:${sel}:${HUD.open}:${b.log.length}:${sig}`;
  if (rk !== shown.roster) {
    shown.roster = rk;
    const box = el.querySelector(".bh-rosterbox");
    box.innerHTML = rosterHtml(state, b, list, { sel, offMap, salt, open: HUD.open });
    shown.rect = box.firstElementChild && box.firstElementChild.getBoundingClientRect && el.getBoundingClientRect ? (() => { const r = box.firstElementChild.getBoundingClientRect(), o = el.getBoundingClientRect(); return { x1: r.right - o.left, y1: r.bottom - o.top }; })() : null;
  }
  // The weapon panel (weaponPanelHtml) is on the bottom bar now, by the turn controls (ui/battlebar.js).
  // The target card: the enemy under the mouse.
  const tk = hoverT && u ? `${b.rev}:${u.id}:${hoverT.id}:${mode}:${hoverO ? hoverO.chance : "-"}:${HUD.open}` : "";
  if (tk !== shown.target) {
    shown.target = tk;
    el.querySelector(".bh-targetbox").innerHTML = tk && HUD.open ? targetCardHtml(b, u, hoverT, hoverO) : "";
  }
  return shown.rect;
}
export function hudReset() { shown.roster = shown.target = shown.rect = null; }
