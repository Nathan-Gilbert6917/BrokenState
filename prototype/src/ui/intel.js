// Hidden bases and radio intel (sim/hiding.js, sim/intel.js): the Defence tab's Concealment card (how well hidden the
// base is, why, and Run silent) and the Groups tab radio header's Radio security block (discipline, encryption,
// decoys). Handlers: INTEL_ACTIONS (registered by main.js).
import { keyWord } from "../sim/water.js"; // supplies as words: "9mm FMJ", "rounds"
import { baseById } from "../sim/world.js";
import { BUILDINGS, count } from "../sim/buildings.js";
import { concealOf, concealWord, setSilent, HIDE, SILENT } from "../sim/hiding.js";
import { INTEL, DISCIPLINES, discipline, setDiscipline, playerEncrypted, decoyProblem, broadcastDecoy } from "../sim/intel.js";
import { hasNetwork } from "../sim/radio.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v) => `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;

export const CONCEAL_TIP = `How hard this base is for the other groups to find. Their parties passing within sight miss it this share of the time, their scouts who come looking ${pct(HIDE.SCOUT)} of it, and a base they know but have not seen for ${HIDE.FORGET_AFTER} days may slip out of what they know (from ${pct(HIDE.FORGET_MIN)}). Your radio traffic, prisoners they question and their friends can still give it away.`;
export const SILENT_TIP = `Run silent: nothing about this base or its teams goes on the radio (the groups cannot overhear it or trace a call to it), no lights at night, small fires and quiet workshops (Heat × ${SILENT.HEAT}). Concealment +${pct(HIDE.SILENT)}. Costs: each station here sits idle ${pct(SILENT.WORK_SKIP)} of its days.`;

// The Defence tab's card.
export function concealCard(state, b) {
  const c = concealOf(state, b);
  const camo = count(b, "camo") ? "" : ` Camouflage netting (Construction: ${Object.entries(BUILDINGS.camo.cost).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ")}) adds ${pct(HIDE.CAMO)}.`;
  return `<h3${tip(CONCEAL_TIP)}>Concealment</h3>
    <div class="card small">
      <div class="spread"><span${tip(CONCEAL_TIP)}><b>${pct(c.value)}</b> · ${esc(concealWord(c.value))}</span>
        <button class="mini ${b.silent ? "on" : ""}" data-action="hide-silent" data-base="${b.id}" data-v="${b.silent ? "0" : "1"}"${tip(SILENT_TIP)}>${b.silent ? "Running silent ✓" : "Run silent"}</button></div>
      <div class="kv" style="margin-top:0.3rem">${c.parts.map(([label, v]) => `<div>${esc(label)}</div><div class="${v >= 0 ? "good" : "warn"}">${signed(v)}</div>`).join("") || `<div class="muted">Nothing hides it</div><div></div>`}</div>
      <div class="muted" style="margin-top:0.3rem">Fewer teams coming and going, less noise and no floodlights keep it hidden.${camo}</div>
    </div>`;
}

// The Groups tab's radio header: what the groups may overhear of yours, and what you can do about it.
export function radioSecurity(state) {
  if (!hasNetwork(state)) return "";
  const disc = discipline(state);
  const enc = playerEncrypted(state);
  const why = decoyProblem(state);
  const sel = `<select data-action="intel-discipline"${tip(Object.values(DISCIPLINES).map((x) => `${x.name}: ${x.desc}`).join(" "))}>${Object.entries(DISCIPLINES).map(([k, x]) => `<option value="${k}" ${k === disc ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
  const silent = state.bases.filter((b) => b.silent).map((b) => b.name);
  const dtip = (what) => `${what} Groups listening in on your network may believe it. Once every ${INTEL.DECOY.EVERY} days; a group that finds out it was fooled trusts nothing it hears of yours for ${INTEL.DECOY.DISTRUST} days.`;
  return `<div style="margin-top:0.4rem"><div class="spread"><b${tip("The groups listen in on your network as you listen to theirs: calls, radio deals, your caravans reporting in, the coalition's chatter. What they catch can show them your bases, your stores and your caravans' roads.")}>Radio security</b>
      <span class="muted">${enc ? "Encrypted (a Military encrypted radio on the network)" : "In the clear"}${silent.length ? ` · silent: ${esc(silent.join(", "))}` : ""}</span></div>
    <div class="row" style="flex-wrap:wrap;margin-top:0.25rem"><span class="small muted">Discipline:</span> ${sel}
      <button class="mini" data-action="intel-decoy" data-v="caravan" ${why ? "disabled" : ""}${tip(why || dtip("Put out talk of a rich caravan on the road that does not exist: a gang that bites waits for it and loses days of raiding."))}>Decoy caravan</button>
      <button class="mini" data-action="intel-decoy" data-v="base" ${why ? "disabled" : ""}${tip(why || dtip("Talk up an outpost that is not there, rich and lightly held: a group that bites may send its next raid there and find empty ground."))}>Decoy outpost</button></div>
  </div>`;
}

export const INTEL_ACTIONS = {
  "hide-silent": (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) { const t = setSilent(state, b, d.v === "1"); ui.defence = ui.defence || {}; ui.defence.msg = t; } },
  "intel-decoy": (state, ui, d) => { ui.radioMsg = broadcastDecoy(state, d.v); },
};
export const INTEL_CHANGE = {
  "intel-discipline": (state, ui, el) => { ui.radioMsg = setDiscipline(state, el.value); },
};
