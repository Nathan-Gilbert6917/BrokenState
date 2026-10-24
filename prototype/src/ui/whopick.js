// Who does it (the user's request 2026-10-24: "When you have a team selected and click an order that can be split to
// have one or more people do the task make it so you can select which survivors will do the task"). Clicking such an
// order of a team of two or more standing on its tile (the map's right-click menu, the team panel's orders) asks who:
// a chip a survivor free on the team, all of them lit to start (the team does it), the ones out on a job of their own
// listed apart. Picking some sends them off to do it on their own while the rest stay (sim/detach.js). The land jobs
// (Forage, Hunt, Fish, Cut wood, Gather stone) ask it in their hours box instead (ui/landorder.js whoRow), one box.
// One survivor, a team busy or on the move, and the orders only a whole team gives (sim/detach.js splittable: Enter
// the base, set up a camp, found an outpost …) never ask.
//   ui.whoAsk  { via ("xp" | "tc": the action it runs again), d (its data), label (the order), who (ids, null: all) }
// The action runs again with d.who ("" for the whole team) and d.whoAsked = "1" (main.js "xp-order", "tc-do").
// main.js: WHO_ACTIONS are registered like the land box's; whoHtml is drawn with it; whoKey takes Enter / Esc.
// tools/detachtest.js.
import { partyMembers } from "../sim/parties.js";
import { commandable } from "../sim/plans.js";
import { standProblem } from "../sim/teammeet.js";
import { detachments, detachText, isSome } from "../sim/detach.js";
import { teamTileMenu } from "./teamctx.js"; // call-time only (it imports this module)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];
export const whoIds = (v) => (v == null || v === "" ? null : Array.isArray(v) ? v.map(Number) : String(v).split(",").filter(Boolean).map(Number));

// Who can be picked: the people free on a team of two or more standing on its tile, and the ones out; null: no choice.
export function whoChoices(state, p) {
  if (!p || p.owner !== "player" || !commandable(state, p)) return null;
  const people = partyMembers(state, p);
  if (people.length < 2 || standProblem(state, p)) return null;
  return { people, out: detachments(state, p) };
}
// A survivor in or out (never nobody); sid null: the whole team. Returns the ids picked, or null for the whole team.
export function toggleWho(state, p, who, sid) {
  const all = partyMembers(state, p).map((s) => s.id);
  if (sid == null || sid === "") return null;
  const was = whoIds(who) || all;
  const id = Number(sid);
  const ids = was.includes(id) ? was.filter((x) => x !== id) : [...was, id];
  return ids.length && ids.length < all.length ? ids : ids.length ? null : was;
}
// The row of chips (the who box, the land order box): action is the data-action a chip sends (data-sid; "" = all).
export function whoRow(state, p, who, action) {
  const c = whoChoices(state, p);
  if (!c) return "";
  const ids = whoIds(who);
  const on = new Set(ids && isSome(state, p, ids) ? ids : c.people.map((s) => s.id));
  const some = on.size < c.people.length;
  const chips = c.people.map((s) => `<button class="mini${on.has(s.id) ? " active" : ""}" data-action="${action}" data-sid="${s.id}"${tip(`${on.has(s.id) ? "Leave out" : "Add"} ${s.name}`)}>${on.has(s.id) ? "✓ " : ""}${esc(first(s))}</button>`).join("");
  const all = `<button class="mini${some ? "" : " active"}" data-action="${action}" data-sid=""${tip("The whole team does it")}>Whole team</button>`;
  const note = some
    ? `${c.people.filter((s) => on.has(s.id)).map(first).join(", ")} go${on.size === 1 ? "es" : ""} off and do${on.size === 1 ? "es" : ""} it; the rest stay. The team cannot move until they are back.`
    : "The whole team does it. Leave some out to send only the others.";
  const out = c.out.map((q) => `<div class="small muted">Out: ${esc(detachText(state, q))}</div>`).join("");
  return `<div class="whorow" style="margin:0.4rem 0"${tip("Who does it: pick some of the team and they go off and do it on their own while the rest stay; all of them, and the team does it.")}><div class="row" style="gap:0.25rem;flex-wrap:wrap;align-items:center"><span class="small muted">Who:</span> ${chips}${all}</div><div class="small muted" style="margin-top:0.2rem">${esc(note)}</div>${out}</div>`;
}

// Opens the box for an order of a team that has a choice, not yet asked (d.whoAsked). o: { via, label }.
export function askWho(state, ui, d, o) {
  if ((d && d.whoAsked === "1") || state.autopilot) return false;
  const p = state.parties.find((x) => x.id === Number(d.id));
  if (!whoChoices(state, p)) return false;
  const data = {};
  for (const k of Object.keys(d || {})) if (k !== "whoAsked" && k !== "who") data[k] = d[k];
  ui.whoAsk = { via: o.via, d: data, label: o.label, who: null };
  return true;
}
// Why the people picked cannot do it (the right-click menu's own reason for them), "" when they can.
function whyNot(state, ui, a, p) {
  if (a.via !== "tc" || !a.who) return "";
  const m = teamTileMenu(state, ui, p, Number(a.d.tile), { append: a.d.mode === "append", who: a.who });
  const it = m.items.find((x) => x.key === a.d.key);
  return it ? it.disabled || "" : "Not possible for them.";
}
function whoBox(state, ui) {
  const a = ui.whoAsk;
  const p = state.parties.find((x) => x.id === Number(a.d.id));
  if (!p || !whoChoices(state, p)) { ui.whoAsk = null; return ""; }
  const why = whyNot(state, ui, a, p);
  return `<div class="askwrap"><div class="askbox" role="dialog" style="max-width:30rem">
    <div class="asktitle">${esc(a.label)}: who does it?</div>
    ${whoRow(state, p, a.who, "who-pick")}
    ${why ? `<div class="small danger">They cannot: ${esc(why)}</div>` : ""}
    <div class="askbtns"><button class="primary" data-action="who-go" data-tip="Enter"${why ? " disabled" : ""}>${a.who ? `Send ${a.who.length}` : "The whole team"}</button><button data-action="who-close" data-tip="Esc">Cancel</button></div>
  </div></div>`;
}
export const whoHtml = (state, ui) => (ui.whoAsk ? whoBox(state, ui) : "");
export function whoKey(state, ui, e, actions) {
  if (!ui.whoAsk) return false;
  if (e.code === "Escape") ui.whoAsk = null;
  else if (e.code === "Enter" || e.code === "NumpadEnter") WHO_ACTIONS["who-go"](state, ui, {}, null, actions);
  return true;
}
const VIA = { xp: "xp-order", tc: "tc-do" };
export const WHO_ACTIONS = {
  "who-pick": (state, ui, d) => {
    const a = ui.whoAsk;
    const p = a && state.parties.find((x) => x.id === Number(a.d.id));
    if (p) a.who = toggleWho(state, p, a.who, d.sid);
  },
  "who-go": (state, ui, d, ev, actions) => {
    const a = ui.whoAsk;
    if (!a) return;
    const p = state.parties.find((x) => x.id === Number(a.d.id));
    if (p && whyNot(state, ui, a, p)) return;
    ui.whoAsk = null;
    const fn = actions && actions[VIA[a.via]];
    if (fn) fn({ ...a.d, who: a.who ? a.who.join(",") : "", whoAsked: "1" });
  },
  "who-close": (state, ui) => { ui.whoAsk = null; },
};
