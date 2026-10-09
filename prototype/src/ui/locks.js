// Raid screen pieces for locks (sim/locks.js): the Open buttons with odds next to a locked container or door, the
// key line in the raid header and the hover text (the iso view draws the padlocks: ui/isoview.js). ui/combat.js calls
// these; the "lk-open" handler is registered in main.js (LOCK_ACTIONS).
import { combatAct } from "../sim/combat.js";
import { LOCKS, PICK, lockedNear, lockAt, openOdds, hasKey, keyName } from "../sim/locks.js";
import { SAFE, safeLine, caseTargets, caseOdds } from "../sim/locks.js"; // gun safes and gun cases (sim/locks.js, sim/gunsafes.js)
import { caseText } from "../sim/gunsafes.js";
import { survivorById, skill } from "../sim/world.js";
import { hasPerk } from "../sim/skills.js";
import { cui } from "./combat.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
let lastState = null; // the hover text has no state of its own (ui/combat.js previewHtml)

// Under the unit's action buttons: one row per locked thing next to it.
export function lockPanel(state, b, u) {
  lastState = state;
  if (!b.raid || !u) return "";
  const near = lockedNear(b, u);
  if (!near.length) return casePanel(state, b, u);
  const can = b.phase === "player" && !b.over && u.ap > 0;
  return near.slice(0, 3).map((t) => {
    if (LOCKS[t.lock.kind] && LOCKS[t.lock.kind].tier) return safeRow(state, b, u, t, can); // a gun safe: its own buttons
    const o = openOdds(state, b, u, t.lock);
    const def = LOCKS[t.lock.kind];
    const button = (m, label, tipText) => {
      const x = o[m];
      const ok = can && x.ok && u.ap >= x.ap;
      return `<button class="mini" data-action="lk-open" data-u="${u.id}" data-t="${t.ref}" data-m="${m}" ${ok ? "" : "disabled"} data-tip="${esc(x.ok ? tipText : x.why)}">${label}</button>`;
    };
    const force = o.force.glass ? `Break glass ${pct(o.force.chance)} (2 actions, loud)` : o.force.label === "Smash" ? `Smash ${pct(o.force.chance)} (2 actions, loud)` : `Force ${pct(o.force.chance)} (loud)`;
    // How the pick odds come about (sim/locks.js PICK): the picker's Stealth against the lock's difficulty.
    const s = survivorById(state, u.sid);
    const st = s ? skill(s, "stealth") : 0, quiet = !!(u.quiet || (s && hasPerk(s, "quiethands")));
    const why = `${pct(PICK.base)} + ${pct(PICK.perStealth)} a Stealth point (Stealth ${st}: +${pct(PICK.perStealth * st)})${def.diff > 1 ? ` − ${pct(PICK.perDiff)} a difficulty step above 1 (−${pct(PICK.perDiff * (def.diff - 1))})` : ""}${quiet ? ` + ${pct(PICK.quiet)} Quiet Hands` : ""}, 5–95%`;
    return `<div class="small" style="margin-top:0.3rem">🔒 <b>${esc(t.name)}</b> <span class="muted">difficulty ${def.diff}${t.lock.tries ? ` · ${t.lock.tries} tr${t.lock.tries === 1 ? "y" : "ies"}` : ""}${t.door ? " · a locked room behind it" : ""}</span>
      <div class="row" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.15rem">
        ${button("key", hasKey(state, b.tileId) ? "Key ✓" : "Key ✗", `Unlock it with the ${keyName(state, b.tileId)} (1 action, silent).`)}
        ${button("pick", `Pick ${pct(o.pick.chance)} a try (1 action)`, `Pick the lock: 1 action a try, ${pct(o.pick.chance)} each try (${why}). Heat +1 a try, the lockpicks lose a use, Stealth XP. Once it is open, searching it takes 1 action.`)}
        ${button("force", force, o.force.glass ? `No crowbar: shatter a window and reach in (both actions, Heat +10, breaking glass wakes everything within 11 tiles). ${pct(o.force.chance)}.` : o.force.label === "Smash" ? `No crowbar: kick it in or smash it (both actions, Heat +10, wakes everything within 11 tiles). ${pct(o.force.chance)}.` : `Crowbar it open (1 action, Heat +6, wakes everything within 8 tiles). ${pct(o.force.chance)}.`)}
      </div></div>`;
  }).join("") + casePanel(state, b, u);
}

// Raid header: whether you hold this site's key.
export function raidKeyLine(state, b) {
  lastState = state;
  if (!b.raid) return "";
  const locked = b.raid.containers.filter((c) => c.lock && !c.lock.open).length + (b.raid.doors || []).filter((d) => !d.lock.open).length;
  if (hasKey(state, b.tileId)) return `<div class="small good" style="margin-top:0.25rem" data-tip="Opens every lock here: 1 action, silent.">🔑 You have the ${esc(keyName(state, b.tileId))}.</div>`;
  return locked ? `<div class="small muted" style="margin-top:0.25rem" data-tip="Locked containers and doors (padlock markers). Stand next to one: key, lockpicks (crowbar and lockpicks item) or force.">🔒 ${locked} locked here.</div>` : "";
}

// Hover text for a locked container or door ("" when there is none at that cell).
export function lockPreview(b, u, x, y) {
  const t = lockAt(b, x, y);
  if (!t || t.lock.open) return "";
  if (LOCKS[t.lock.kind] && LOCKS[t.lock.kind].tier) return safePreview(b, u, t); // a gun safe
  const def = LOCKS[t.lock.kind];
  const near = u && Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) <= 1;
  let odds = "";
  if (lastState && u && u.side === "player") {
    const o = openOdds(lastState, b, u, t.lock);
    odds = `<br>${o.key.ok ? "Key: sure · " : ""}Pick ${o.pick.ok ? pct(o.pick.chance) : "(no lockpicks)"} · ${o.force.ok || o.force.chance ? `${o.force.label} ${pct(o.force.chance)}` : "cannot be forced"}`;
  }
  return `<b>🔒 ${esc(t.name)}</b> · difficulty ${def.diff}${t.door ? " · a locked room" : ""}${t.box && t.box.searched ? " · searched" : ""}<br><span class="muted">Locked things hold more: supplies, gear, keys and blueprints.</span>${odds}<br>${near ? "Open it from the panel: key, pick or force." : "Move next to it to open it."}`;
}

function padlock(ctx, x, y, r, color) {
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = Math.max(1, r * 0.35);
  ctx.beginPath();
  ctx.arc(x, y - r * 0.4, r * 0.6, Math.PI, 0);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x - r, y - r * 0.4, r * 2, r * 1.5);
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - r, y - r * 0.4, r * 2, r * 1.5);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x - r * 0.15, y, r * 0.3, r * 0.6);
}

export const LOCK_ACTIONS = {
  "lk-open": (state, ui, d) => {
    if (!state.combat) return;
    const err = combatAct(state, { type: "open", unit: Number(d.u), target: d.t, method: d.m });
    cui.msg = err || "";
  },
};

// ---------- gun safes (sim/locks.js SAFE) ----------
// One row of buttons a gun safe: each way in with its odds, actions, turns, Heat and how far it carries; the drilling
// progress as a bar.
function safeRow(state, b, u, t, can) {
  const o = openOdds(state, b, u, t.lock);
  const def = LOCKS[t.lock.kind];
  const L = t.lock;
  const btn = (m, label, tipText) => {
    const x = o[m];
    if (!x) return "";
    const ok = can && x.ok && u.ap >= x.ap;
    return `<button class="mini" data-action="lk-open" data-u="${u.id}" data-t="${t.ref}" data-m="${m}" ${ok ? "" : "disabled"} data-tip="${esc(x.ok ? tipText : x.why)}">${label}</button>`;
  };
  const cost = (x) => `${x.ap === 2 ? "both actions" : `${x.ap} action`}${x.heat ? `, Heat +${x.heat}` : ", silent"}${x.wake ? `, wakes within ${x.wake}` : ""}`;
  const d = o.drill, g = o.grind;
  const bar = L.prog ? `<div class="small" style="margin-top:0.15rem" data-tip="Drilling or cutting adds up across turns and people: a grinder counts double.">Drilling ${L.prog}/${d.need} <span style="display:inline-block;vertical-align:middle;width:6rem;height:0.45rem;background:#2a2a2a;border:1px solid #555"><span style="display:block;height:100%;width:${Math.min(100, Math.round((L.prog / d.need) * 100))}%;background:#e0a040"></span></span></div>` : "";
  const turns = (x) => `${x.actions} action${x.actions === 1 ? "" : "s"}, about ${x.turns} turn${x.turns === 1 ? "" : "s"}`;
  const r2 = (v) => Math.round(v * 100) / 100;
  return `<div class="small" style="margin-top:0.3rem">🔒 <b>${esc(t.name)}</b> <span class="muted">${esc(safeLine(L).replace(`${def.name}, `, ""))}${L.tries ? ` · ${L.tries} tr${L.tries === 1 ? "y" : "ies"}` : ""}${L.armed ? " · a charge is set: get clear" : ""}</span>
      <div class="row" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.15rem">
        ${o.combo.ok ? btn("combo", o.combo.label, `Open it ${def.tier === 1 ? "with its own key" : "with the combination from the note"} (1 action, silent, sure).`) : ""}
        ${def.tier < 3 ? btn("key", hasKey(state, b.tileId) ? "Key ✓" : "Key ✗", `Unlock it with the ${keyName(state, b.tileId)} (1 action, silent).`) : ""}
        ${def.tier === 1 ? btn("pick", `Pick ${pct(o.pick.chance)}`, `Pick the key lock: ${pct(o.pick.chance)} a try (${cost(o.pick)}).`) : ""}
        ${def.tier === 1 ? btn("force", `Pry ${pct(o.force.chance || 0)} (loud)`, `Crowbar it open: ${pct(o.force.chance || 0)} (${o.force.ok ? cost(o.force) : "1 action"}).`) : ""}
        ${L.mech === "dial" ? btn("crack", `Crack ${pct(o.crack.chance)} (whole turn)`, `Feel the dial: ${pct(o.crack.chance)} a try (${pct(SAFE.crack.perStealth)} a Stealth point − ${pct(SAFE.crack.perTier)} a tier above a gun cabinet, ${pct(SAFE.crack.min)}–${pct(SAFE.crack.max)}; Stealth ${SAFE.crack.minStealth}+). ${cost(o.crack)}; Stealth XP.`) : ""}
        ${L.mech === "keypad" ? btn("bypass", `Bypass ${pct(o.bypass.chance)}`, `Short the keypad with a part: ${pct(o.bypass.chance)} (${pct(SAFE.bypass.base)} + ${pct(SAFE.bypass.perMech)} a Mechanics point${def.tier > 2 ? ` − ${pct(SAFE.bypass.perTier)} for an armoury safe` : ""}). ${cost(o.bypass)}. Uses 1 parts on a success, half the time on a miss.`) : ""}
        ${btn("drill", `Drill ${d.prog}/${d.need}`, `Drill out the lock: sure, ${turns(d)} (+${r2(d.rate)} an action). Heat about +${d.turnHeat} a turn of drilling, wakes everything within ${d.wake} each turn. The bits wear a use.`)}
        ${btn("grind", `Grind ${g.prog}/${g.need}`, `Cut it open: sure, ${turns(g)} (+${r2(g.rate)} an action, twice a drill). Heat about +${g.turnHeat} a turn, wakes everything within ${g.wake} each turn, and at night the sparks give the user away.`)}
        ${btn("blow", `Blow ${pct(o.blow.chance)}`, `Set ${o.blow.item === "frag" ? "a frag grenade" : "a pipe bomb"} on the door (1 action): it goes off at the start of next turn, ${pct(o.blow.chance)} to open it. Heat +${o.blow.heat || 10}, wakes everything within ${o.blow.wake || 14}, hurts anyone within a tile and a half. The guns inside are knocked about (−30% condition), 30% of the ammo and supplies lost, bottles smashed.`)}
      </div>${bar}</div>`;
}
function safePreview(b, u, t) {
  const L = t.lock, def = LOCKS[L.kind];
  const near = u && Math.max(Math.abs(u.x - t.x), Math.abs(u.y - t.y)) <= 1;
  let odds = "";
  if (lastState && u && u.side === "player") {
    const o = openOdds(lastState, b, u, L);
    const bits = [];
    if (o.combo.ok) bits.push(`${o.combo.label}: sure`);
    if (o.key.ok) bits.push("Key: sure");
    if (L.mech === "dial") bits.push(`Crack ${pct(o.crack.chance)}${o.crack.ok ? "" : " (Stealth 6 needed)"}`);
    if (L.mech === "keypad") bits.push(`Bypass ${pct(o.bypass.chance)}${o.bypass.ok ? "" : " (needs a part)"}`);
    bits.push(`Drill ${o.drill.ok ? `${o.drill.actions} actions` : "(no drill)"}`);
    if (o.grind.ok) bits.push(`Grind ${o.grind.actions} actions`);
    odds = `<br>${bits.join(" · ")}`;
  }
  return `<b>🔒 ${esc(safeLine(L))}</b>${L.prog ? ` · drilled ${L.prog}/${SAFE.drill.need[def.tier]}` : ""}${t.box && t.box.searched ? " · searched" : ""}<br><span class="muted">Guns inside: ${def.tier === 1 ? "a hunting gun or two" : def.tier === 2 ? "two to four guns and the owner's valuables" : "a rack of service guns and their ammo"}.</span>${odds}<br>${near ? "Open it from the panel." : "Move next to it to open it."}`;
}
// Gun cases within reach: carried, in a pocket or the pack, or in an opened container next to this person.
function casePanel(state, b, u) {
  const list = caseTargets(state, b, u).slice(0, 3);
  if (!list.length) return "";
  const can = b.phase === "player" && !b.over && u.ap > 0;
  return list.map((c) => {
    const o = caseOdds(state, b, u, c.item);
    const ok = can && o.ok;
    const label = `${c.item.locked ? "Prise open" : "Open"} ${c.item.name.toLowerCase()} (1 action${o.heat ? `, Heat +${o.heat}` : ""})`;
    return `<div class="small" style="margin-top:0.3rem">🧳 <b>${esc(c.item.name)}</b> <span class="muted">${esc(c.where)}${c.item.locked ? " · locked" : ""}</span>
      <div class="row" style="gap:0.25rem;margin-top:0.15rem"><button class="mini" data-action="lk-open" data-u="${u.id}" data-t="${c.ref}" data-m="case" ${ok ? "" : "disabled"} data-tip="${esc(ok ? `Inside: ${caseText(c.item)}. What is inside stays where the case is (in the container, or carried loose). At a base or a camp it opens for free.` : o.why)}">${label}</button></div></div>`;
  }).join("");
}
