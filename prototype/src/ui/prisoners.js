// The Prisoners tab of a base (sim/prisoners.js): who is held here, in a cell or a shed, what they cost, and what
// to do with each: question, ransom, trade back, release, win over, execute.
import { SKILL_NAMES, TRAITS, FACTION_TYPES } from "../sim/data.js";
import { atBase, day } from "../sim/world.js";
import { teamName } from "../sim/parties.js";
import { thirstAt } from "../sim/weather.js";
import {
  PRISON, prisonersAt, cellCap, guarded, prisonerView, questionPrisoner, askRansom, tradeBack, releasePrisoner,
  setMode, executePrisoner,
} from "../sim/prisoners.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => ` data-tip="${esc(t)}"`;
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const KIND = { raiders: "Raider", soldiers: "Soldier", zealots: "Zealot", fighters: "Fighter", guards: "Guard", militia: "Militia" };

export function prisonTab(state, base, ui) {
  const list = prisonersAt(state, base.id);
  const cap = cellCap(base);
  const guard = atBase(state, base.id).find((s) => s.role === "guard" && !s.inBed);
  const shed = Math.max(0, list.length - cap);
  const out = (state.prisoners || []).filter((p) => p.at.kind === "party" && (() => { const t = state.parties.find((x) => x.id === p.at.partyId); return t && t.homeBaseId === base.id; })());
  let html = `<h3>Prisoners at ${esc(base.name)}</h3>
    <div class="small muted">Holding cells: ${list.length - shed} of ${cap} used${shed ? `, <span class="warn">${shed} in a shed (${pctTxt(PRISON.ESCAPE.shed)} a day to escape)</span>` : ""}${cap ? "" : " (build Holding cells: 3 prisoners each)"}.
      On guard: ${guard ? esc(guard.name) : `<span class="warn">nobody</span> (escapes ${pctTxt(PRISON.ESCAPE.unguarded)} a day instead of ${pctTxt(PRISON.ESCAPE.guarded)}; set someone's role to Guard)`}.
      ${list.length ? `Feeding them: ${list.length * PRISON.FOOD} food and ${Math.round(list.length * PRISON.WATER * thirstAt(state) * 10) / 10} water a day${thirstAt(state) !== 1 ? " (water by the season's thirst)" : ""}.` : ""}</div>`;
  if (out.length) html += `<div class="small" style="margin-top:0.3rem">On the way here: ${esc(out.map((p) => `${p.name} (with ${teamName(state, state.parties.find((x) => x.id === p.at.partyId))})`).join(", "))}.</div>`;
  if (!list.length) return html + `<div class="card small muted" style="margin-top:0.5rem">Nobody is held here. In battle, Subdue (C) knocks an enemy out instead of killing them (a takedown from behind on the unaware is best); after a won fight the knocked out come home as prisoners.</div>`;
  for (const p of list) html += prisonerCard(state, p, ui);
  return html;
}

function prisonerCard(state, p, ui) {
  const v = prisonerView(state, p);
  const f = v.faction;
  const s = p.s;
  const top = Object.entries(s.skills).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k, n]) => `${SKILL_NAMES[k]} ${n}`).join(", ");
  const traits = (s.traits || []).map((t) => (TRAITS[t] ? TRAITS[t].name : t)).join(", ");
  const kind = KIND[p.kit] || "Fighter";
  const where = v.cell ? (v.guarded ? "In a cell, guarded" : "In a cell, unguarded") : "In a shed (no free cell)";
  const opinion = Math.max(0, Math.min(100, Math.round(p.opinion)));
  const ransom = p.ransom ? `Ransom asked: ${p.ransom.qty} ${p.ransom.key}, answer due on day ${p.ransom.due}.` : "";
  const confirm = ui.prisonConfirm === p.id;
  const qTip = v.question.ok ? `Question ${p.name}: ${pctTxt(v.question.odds)} to get answers (the best talker's Speech; zealots and soldiers say less; hunger loosens tongues). ${p.intelDone ? "Again: where their parties and the hives near them are now." : "First answers: their bases, people and stock, their parties out, hives near them (onto your map)."} Sours them (${PRISON.QUESTION.sour}).` : `Questioned on day ${p.questioned}: again from day ${p.questioned + PRISON.QUESTION.every}.`;
  const rTip = v.ransom ? `Ask ${f ? f.name : p.group} for ${v.ransom.qty} ${v.ransom.key} (worth about ${v.ransom.value}). They answer in ${PRISON.RANSOM.days[0]}–${PRISON.RANSOM.days[1]} days: pay (goodwill ${PRISON.RANSOM.goodwillPaid}) or refuse (goodwill ${PRISON.RANSOM.goodwillRefused}, and a rescue raid becomes twice as likely for ${PRISON.RANSOM.angryDays} days).` : "Their group is gone: nobody to pay.";
  const rateTxt = p.mode === "recruit" ? `Winning them over: ${opinion}/100, about +${v.rate.toFixed(1)} a day${v.rate > 0 ? ` (≈${Math.ceil((100 - p.opinion) / Math.max(0.1, v.rate))} days)` : ""}.` : `Opinion of you: ${opinion}/100.`;
  return `<div class="card" style="margin-top:0.5rem">
    <div class="spread"><b>${esc(p.name)}</b><span class="small muted">${esc(kind)} of ${esc(p.group)}${f ? ` (${esc(FACTION_TYPES[f.type].label)})` : ""} · held ${v.days} day${v.days === 1 ? "" : "s"}</span></div>
    <div class="small">${esc(where)} · health ${Math.round(s.health)} · ${esc(top)}${traits ? ` · ${esc(traits)}` : ""}${p.unfed ? ` · <span class="danger">unfed ${p.unfed} day${p.unfed === 1 ? "" : "s"}</span>` : ""}</div>
    <div class="small muted">${esc(rateTxt)}${v.rescue ? ` Their group may come for them: about ${pctTxt(v.rescue)} a day.` : ""}${ransom ? ` ${esc(ransom)}` : ""}</div>
    ${p.report ? `<div class="small" style="margin-top:0.2rem">Last answers: ${esc(p.report)}</div>` : ""}
    <div class="row" style="margin-top:0.35rem;flex-wrap:wrap;gap:0.3rem">
      <button class="mini" data-action="pr-question" data-id="${p.id}" ${v.question.ok ? "" : "disabled"}${tip(qTip)}>Question (${pctTxt(v.question.odds)})</button>
      <button class="mini" data-action="pr-ransom" data-id="${p.id}" ${v.ransom && !p.ransom ? "" : "disabled"}${tip(rTip)}>Ask a ransom${v.ransom ? ` (${v.ransom.qty} ${esc(v.ransom.key)})` : ""}</button>
      <button class="mini" data-action="pr-tradeback" data-id="${p.id}" ${f ? "" : "disabled"}${tip(f ? `Send ${p.name} back to ${f.name} unharmed: goodwill +${PRISON.TRADE_BACK}.` : "Their group is gone.")}>Trade back (+${PRISON.TRADE_BACK})</button>
      <button class="mini ${p.mode === "recruit" ? "active" : ""}" data-action="pr-mode" data-id="${p.id}" data-mode="${p.mode === "recruit" ? "hold" : "recruit"}"${tip(p.mode === "recruit" ? "Stop trying to win them over: just hold them." : `Treat them well and talk: they come round slowly (1 a day × Speech, Leadership, the base's mood and who they were; zealots barely). At 100 they ask to join. Months, not days.`)}>${p.mode === "recruit" ? "Winning over ✔" : "Win them over"}</button>
      <button class="mini" data-action="pr-release" data-id="${p.id}"${tip(`Let ${p.name} go${f ? `: they head back to ${f.name} (goodwill +${PRISON.RELEASE})` : ""}.`)}>Release</button>
      <button class="mini ${confirm ? "danger" : ""}" data-action="pr-execute" data-id="${p.id}"${tip(`Everyone here takes it hard (mood ${PRISON.EXECUTE.mood}, Brave or Tough ${PRISON.EXECUTE.hardened}); goodwill ${PRISON.EXECUTE.goodwill} with ${f ? f.name : "their group"} and ${PRISON.EXECUTE.others} with every group you know.${confirm ? " Click again to do it." : ""}`)}>${confirm ? "Really execute?" : "Execute"}</button>
    </div>
  </div>`;
}

const done = (ui, text) => { ui.baseMsg = text || ""; ui.prisonConfirm = null; };
export const PRISON_ACTIONS = {
  "pr-question": (state, ui, d) => done(ui, questionPrisoner(state, d.id)),
  "pr-ransom": (state, ui, d) => done(ui, askRansom(state, d.id)),
  "pr-tradeback": (state, ui, d) => done(ui, tradeBack(state, d.id)),
  "pr-release": (state, ui, d) => done(ui, releasePrisoner(state, d.id)),
  "pr-mode": (state, ui, d) => done(ui, setMode(state, d.id, d.mode)),
  "pr-execute": (state, ui, d) => {
    const id = Number(d.id);
    if (ui.prisonConfirm !== id) { ui.prisonConfirm = id; ui.baseMsg = "Click Execute again to confirm."; return; }
    done(ui, executePrisoner(state, id));
  },
};

// One line for a team panel: prisoners walking with the team.
export function teamPrisonersLine(state, p) {
  const list = (state.prisoners || []).filter((x) => x.at.kind === "party" && x.at.partyId === p.id);
  if (!list.length) return "";
  return `${list.length} prisoner${list.length === 1 ? "" : "s"} (${list.map((x) => x.name).join(", ")})${p.prisonSpeed ? `, the team walks at ${Math.round(p.prisonSpeed * 100)}%` : ""}; caught on day ${Math.min(...list.map((x) => x.caught))}, today is day ${day(state)}`;
}
