// The battle view's side of the non-lethal kit (sim/nonlethal.js): the Taser, Pepper spray, Pull blows, Execute,
// Surrender and "Take them alive" buttons, the pepper cone preview, the status tags (stunned, blinded, knocked out,
// hands up) and the hover lines. ui/combat.js and ui/isoview.js call in here; cui is ui/combat.js's view state.
import { NL, taserOdds, coneCells, coneUnits, nlStatus, surrenderRefusal, nlEnsure, blinded, NL_STYLE } from "../sim/nonlethal.js";
import { active, adjacent } from "../sim/combat.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const first = (u) => u.name.split(" ")[0];

// Status tags over a unit (both views).
export function nlTags(t) {
  const out = [];
  if (t.dead) return out;
  if (t.surr) out.push([t.tied ? "TIED" : "HANDS", t.tied ? "#c9a74a" : "#f0e6a0"]);
  // A stun or daze (a taser, a stun baton, a flashbang): the STN / DZ tag of both views (u.stun).
  if (blinded(t)) out.push(["BLIND", "#ff9a4a"]);
  if (t.pull && active(t)) out.push(["PULL", "#b8e0a0"]);
  return out;
}

// Adjacent enemies who gave up or are out cold (Execute, Tie).
const helpless = (b, u) => b.units.filter((t) => t.side === "enemy" && (t.surr || t.ko || (t.wounded && t.down && t.tied)) && !t.dead && !t.fled && adjacent(u, t)); // a tied prisoner who went down (sim/medics.js) too

// The buttons, after the stealth kit's.
export function nlButtons(state, b, u, btn, cui) {
  nlEnsure(state, b, u);
  const ap = u.ap;
  let html = "";
  if (u.nlTaser != null) {
    const shots = u.nlTaser, carts = u.nlCarts || 0;
    html += btn("taser", `Taser (${shots})`, shots > 0 ? `1 action and the turn, up to ${NL.TASER.range} tiles, quiet: a person hit loses their next ${NL.TASER.stun} actions and aims −${NL.TASER.daze} the turn after; someone under ${Math.round(NL.TASER.ko * 100)}% health drops, knocked out. Nothing on the dead. Click a target (hover for the odds). ${shots} cartridge${shots === 1 ? "" : "s"} loaded, ${carts} spare pack${carts === 1 ? "" : "s"}.` : `The taser is spent.${carts ? " Reload it (1 action)." : " No spare cartridges."}`, ap > 0 && shots > 0);
    if (shots < NL.TASER.shots) html += btn("reloadTaser", "Reload taser", `1 action: a fresh pair of cartridges (${carts} spare pack${carts === 1 ? "" : "s"}).`, ap > 0 && carts > 0);
  }
  if (u.nlPepper != null) html += btn("pepper", `Pepper spray (${u.nlPepper})`, u.nlPepper > 0 ? `1 action: a cone up to ${NL.PEPPER.range} tiles toward the tile you click (the preview shows it). Everyone living in it, yours too, is blinded for ${NL.PEPPER.turns} turns: −${NL.PEPPER.blind} aim, no overwatch. Nothing on the dead.` : "The can is empty.", ap > 0 && u.nlPepper > 0);
  html += btn("pull", u.pull ? "Pull blows: on" : "Pull blows", u.pull ? `${first(u)} pulls their blows: melee (and gun-butt) hits on the living do ${Math.round(NL.PULL.dmg * 100)}% damage at ${NL.PULL.aim} to hit and knock out instead of killing. Click to strike to kill again.` : `Free: ${first(u)}'s melee and gun-butt blows on the living knock out instead of killing (${Math.round(NL.PULL.dmg * 100)}% damage, ${NL.PULL.aim} to hit). The dead take a plain blow.`, ap > 0);
  const hl = helpless(b, u);
  if (hl.length) html += btn("execute", "Execute", `1 action: kill ${hl[0].name}, who ${hl[0].surr ? "has surrendered" : hl[0].ko ? "is out cold" : "lies tied up"}, right next to ${first(u)}. Everyone of yours here takes it hard (mood), and their group hears of it. Asks first.`, ap > 0);
  const why = surrenderRefusal(b, u);
  const k = (b.setup.enemy || {}).kind;
  const kind = NL_STYLE[k] && NL_STYLE[k].alive >= 0.5;
  if (b.units.some((e) => e.side === "enemy" && e.kind === "human")) html += btn("surrender", "Surrender", why || `${first(u)} throws down their weapon and raises their hands: out of the fight, not a target. If the enemy holds the field, ${kind ? "they take them captive (a rescue, a ransom or goodwill brings them back)" : "they may take them prisoner, or may not bother keeping them alive"}. Asks first.`, ap > 0 && !why);
  html += btn("takeAlive", `Take them alive${b.takeAlive ? ": on" : ""}`, b.takeAlive ? "On: when the AI plays your side it goes for tasers, pepper spray and pulled blows, clubs down the weak and ties up whoever drops. Click to turn it off." : "When the AI plays your side (Auto), it takes people alive: tasers, pepper spray and pulled blows, clubbing down the weak and tying up whoever drops. For prisoners to question, ransom or recruit.", true, "", { on: !!b.takeAlive });
  return html;
}

// The confirmation for Execute and Surrender (under the buttons).
export function nlAskHtml(b, cui) {
  const a = cui.nlAsk;
  if (!a || a.turn !== b.turn) return "";
  const t = a.target != null ? b.units.find((x) => x.id === a.target) : null;
  const text = a.kind === "execute" ? `Execute ${t ? esc(t.name) : "them"}? Everyone of yours here will remember it.` : "Surrender? They will be out of the fight, and taken if the enemy holds the field.";
  return `<div class="small cbmsg cbconfirm"><b class="danger">${text}</b><div class="cbactions" style="margin-top:0.35rem"><button data-action="cb-act" data-v="nlyes">${a.kind === "execute" ? "Execute" : "Surrender"}</button><button data-action="cb-act" data-v="nlno">Cancel</button></div></div>`;
}

// A button of the panel (cb-act). True when it was one of these.
export function nlCbAct(state, b, u, v, cui, act) {
  if (v === "takeAlive") { act(state, { type: "takeAlive" }); return true; }
  if (v === "taser") {
    cui.mode = cui.mode === "taser" ? "move" : "taser";
    cui.msg = cui.mode === "taser" ? `Click someone within ${NL.TASER.range} tiles to tase them.` : "";
    return true;
  }
  if (v === "reloadTaser") { act(state, { type: "reloadTaser", unit: u.id }); return true; }
  if (v === "pepper") {
    cui.mode = cui.mode === "pepper" ? "move" : "pepper";
    cui.msg = cui.mode === "pepper" ? `Click a tile up to ${NL.PEPPER.range} away: the cone goes that way.` : "";
    return true;
  }
  if (v === "pull") { act(state, { type: "pull", unit: u.id }); return true; }
  if (v === "execute") { const t = helpless(b, u).sort((a, c) => (c.surr ? 1 : 0) - (a.surr ? 1 : 0))[0]; cui.nlAsk = t ? { kind: "execute", unit: u.id, target: t.id, turn: b.turn } : null; return true; }
  if (v === "surrender") { cui.nlAsk = { kind: "surrender", unit: u.id, turn: b.turn }; return true; }
  if (v === "nlno") { cui.nlAsk = null; return true; }
  if (v === "nlyes") {
    const a = cui.nlAsk;
    cui.nlAsk = null;
    if (a) act(state, { type: a.kind, unit: a.unit, target: a.target });
    return true;
  }
  return false;
}

// A click on the map in the pepper mode (the taser goes through ui/combat.js attack on a unit). True when handled.
export function nlMapClick(state, b, u, c, cui, act) {
  if (cui.mode !== "pepper") return false;
  act(state, { type: "pepper", unit: u.id, x: c.x, y: c.y });
  return true;
}
// The odds against a hovered or clicked target in the taser mode (ui/combat.js odds), else null.
export function nlOdds(b, u, t, cui) {
  if (cui.mode !== "taser") return null;
  const o = taserOdds(b, u, t);
  return { ...o, ok: o.ok, chance: o.chance, label: o.label };
}
// The cells of the pepper cone toward the hovered tile, as a set of cell indexes (both views), or null.
export function nlConeMask(b, u, cui) {
  const h = cui.hover;
  if (cui.mode !== "pepper" || !u || !h || (h.x === u.x && h.y === u.y)) return null;
  return new Set(coneCells(b, u, h.x, h.y).map(([x, y]) => y * b.w + x));
}
// The hover box: the pepper cone's catch, someone who gave up, one of yours knocked out. "" for none of these.
export function nlPreview(b, t, h, u, cui) {
  if (cui.mode === "pepper" && u && h && !(h.x === u.x && h.y === u.y)) {
    const c = coneUnits(b, u, h.x, h.y);
    const list = (arr) => arr.map((x) => esc(x.name)).join(", ");
    return `<b>Pepper spray</b> · ${c.foes.length ? `<span class="good">blinds ${list(c.foes)}</span>` : '<span class="muted">nobody of theirs in the cone</span>'}${c.friends.length ? ` · <span class="danger">and ${list(c.friends)} of yours</span>` : ""}${c.dead.length ? ` · <span class="muted">the dead in it do not care</span>` : ""}`;
  }
  if (t && t.side === "enemy" && t.surr && !t.dead) return `<b>${esc(t.name)}</b> · ${t.tied ? "surrendered and tied up: your prisoner if you win" : `surrendered, hands up. Tie them up (T) from next to them, or they walk off after ${3 - (t.surrAlone || 0)} more turn(s) alone (or take their weapon up again if their side rallies)`}. <span class="muted">Execute from next to them (asks first).</span>`;
  if (t && t.side === "player" && (t.ko || t.surr) && !t.dead) return `<b>${esc(t.name)}</b> · ${esc(nlStatus(b, t))}. ${t.tied ? "Tied up by them: only a win frees them." : t.ko ? "Drag them clear (Shift+D) or hold the field: if the enemy holds it, they are taken." : "Out of the fight; taken if the enemy holds the field."}`;
  return "";
}
export { nlStatus };
