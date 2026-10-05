// Raid screen pieces for locks (sim/locks.js): the Open buttons with odds next to a locked container or door, the
// key line in the raid header, the hover text, and the doors and padlocks drawn on the raid map. ui/combat.js calls
// these; the "lk-open" handler is registered in main.js (LOCK_ACTIONS).
import { combatAct } from "../sim/combat.js";
import { LOCKS, PICK, lockedNear, lockAt, openOdds, hasKey, keyName } from "../sim/locks.js";
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
  if (!near.length) return "";
  const can = b.phase === "player" && !b.over && u.ap > 0;
  return near.slice(0, 3).map((t) => {
    const o = openOdds(state, b, u, t.lock);
    const def = LOCKS[t.lock.kind];
    const button = (m, label, tipText) => {
      const x = o[m];
      const ok = can && x.ok && u.ap >= x.ap;
      return `<button class="mini" data-action="lk-open" data-u="${u.id}" data-t="${t.ref}" data-m="${m}" ${ok ? "" : "disabled"} data-tip="${esc(x.ok ? tipText : x.why)}">${label}</button>`;
    };
    const force = o.force.label === "Smash" ? `Smash ${pct(o.force.chance)} (2 actions, loud)` : `Force ${pct(o.force.chance)} (loud)`;
    // How the pick odds come about (sim/locks.js PICK): the picker's Stealth against the lock's difficulty.
    const s = survivorById(state, u.sid);
    const st = s ? skill(s, "stealth") : 0, quiet = !!(u.quiet || (s && hasPerk(s, "quiethands")));
    const why = `${pct(PICK.base)} + ${pct(PICK.perStealth)} a Stealth point (Stealth ${st}: +${pct(PICK.perStealth * st)})${def.diff > 1 ? ` − ${pct(PICK.perDiff)} a difficulty step above 1 (−${pct(PICK.perDiff * (def.diff - 1))})` : ""}${quiet ? ` + ${pct(PICK.quiet)} Quiet Hands` : ""}, 5–95%`;
    return `<div class="small" style="margin-top:0.3rem">🔒 <b>${esc(t.name)}</b> <span class="muted">difficulty ${def.diff}${t.lock.tries ? ` · ${t.lock.tries} tr${t.lock.tries === 1 ? "y" : "ies"}` : ""}${t.door ? " · a locked room behind it" : ""}</span>
      <div class="row" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.15rem">
        ${button("key", hasKey(state, b.tileId) ? "Key ✓" : "Key ✗", `Unlock it with the ${keyName(state, b.tileId)} (1 action, silent).`)}
        ${button("pick", `Pick ${pct(o.pick.chance)} a try (1 action)`, `Pick the lock: 1 action a try, ${pct(o.pick.chance)} each try (${why}). Heat +1 a try, the lockpicks lose a use, Stealth XP. Once it is open, searching it takes 1 action.`)}
        ${button("force", force, o.force.label === "Smash" ? `No crowbar: kick it in or smash it (both actions, Heat +10, wakes everything within 11 tiles). ${pct(o.force.chance)}.` : `Crowbar it open (1 action, Heat +6, wakes everything within 8 tiles). ${pct(o.force.chance)}.`)}
      </div></div>`;
  }).join("");
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
  const def = LOCKS[t.lock.kind];
  const near = u && Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) <= 1;
  let odds = "";
  if (lastState && u && u.side === "player") {
    const o = openOdds(lastState, b, u, t.lock);
    odds = `<br>${o.key.ok ? "Key: sure · " : ""}Pick ${o.pick.ok ? pct(o.pick.chance) : "(no lockpicks)"} · ${o.force.ok || o.force.chance ? `${o.force.label} ${pct(o.force.chance)}` : "cannot be forced"}`;
  }
  return `<b>🔒 ${esc(t.name)}</b> · difficulty ${def.diff}${t.door ? " · a locked room" : ""}${t.box && t.box.searched ? " · searched" : ""}<br><span class="muted">Locked things hold more: supplies, gear, keys and blueprints.</span>${odds}<br>${near ? "Open it from the panel: key, pick or force." : "Move next to it to open it."}`;
}

// Doors and padlocks on the raid map (ui/combat.js drawRaidOverlay).
export function drawLocks(ctx, b, ox, oy, cs) {
  if (!b.raid) return;
  for (const d of b.raid.doors || []) {
    const px = ox + d.x * cs, py = oy + d.y * cs;
    if (d.lock.open) {
      ctx.strokeStyle = d.lock.how === "force" || d.lock.how === "smash" ? "rgba(224,138,79,0.8)" : "rgba(200,170,120,0.6)";
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 3, py + 3, cs - 6, cs - 6);
      continue;
    }
    ctx.fillStyle = d.lock.kind === "vault" ? "#5c636b" : "#6a4a2c";
    ctx.fillRect(px + 2, py + 1, cs - 4, cs - 2);
    ctx.strokeStyle = "#20160c";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 2, py + 1, cs - 4, cs - 2);
    ctx.fillStyle = d.lock.kind === "vault" ? "#8a939c" : "#8a643c";
    ctx.fillRect(px + cs * 0.2, py + cs * 0.15, cs * 0.6, cs * 0.25);
    ctx.fillRect(px + cs * 0.2, py + cs * 0.55, cs * 0.6, cs * 0.25);
    padlock(ctx, px + cs * 0.72, py + cs * 0.5, cs * 0.16, "#ffd166");
  }
  for (const c of b.raid.containers) {
    if (!c.lock || c.searched) continue;
    const px = ox + c.x * cs, py = oy + c.y * cs;
    padlock(ctx, px + cs * 0.24, py + cs * 0.24, cs * 0.15, c.lock.open ? "#6cc48a" : "#ff9f43");
  }
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
