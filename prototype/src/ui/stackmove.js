// The stack mover: one panel for moving part of a stack of supplies (food, water, firewood, scrap, rounds...) from
// one place to another, used by every screen that moves stacks (ui/inventory.js: the search window of a raid, Loot
// the bodies, the inventory window). It shows the stack (icon, name, how many, the weight of one), where it comes
// from and where it goes (in words, with a pick of destinations when there are several), a slider, a number box and
// quick chips (1, half, All, What fits), the weight of the amount chosen, how many fit at the destination (a warning
// past that) and one primary button ("Move 12 food → Carried"). Enter moves, Esc cancels.
//
// Two ways it shows:
//   docked   a stack is clicked: the panel docks at the bottom of the window (sticky, so it stays in sight) until
//            the stack is moved or Cancel / Esc. Clicking a destination list in the window still moves the chosen
//            amount there straight away (the fast path; the screen does that with chosenQty).
//   popover  a stack is dragged and dropped (ui.stack.pop = { x, y } from dropPoint): a small card at the drop with
//            the one destination it was dropped on, defaulting to what fits.
//
// ---------- the API (for a new screen: ux-carry's quantity box, the team inventory's load / drop off, ground items) ----------
//   registerStackScreen(ns, provider)  once, at module load. provider = {
//     spec(state, ui) → null (nothing picked: the panel closes) or {
//       key,                 supply key (data.js SUPPLIES; its name, weight and icon come from there)
//       have,                units in the stack (whole units)
//       from,                where it is, in words ("Kitchen cupboard", "Carried by Ana")
//       dests: [{ id, label, fit, err }]   where it can go: id (the screen's own), label (short: "Carried", "Vehicle"),
//                            fit (units that go there now: weight, room, time all counted), err (why none fit)
//       to,                  the default destination id (else the first)
//       hint,                optional muted line under the panel (the haul time of a raid turn)
//       verb,                optional ("Move", "Take", "Load")
//     }
//     move(state, ui, toId, qty) → does the move through the sim (and sets the screen's message)
//     cancel(state, ui)      optional: also drop the screen's selection (ui.invSel)
//   }
//   openStack(ui, ns, { to, pop, qty })   the screen picked a stack (click: no pop; drop: pop and to)
//   closeStack(ui)                        ui.stack = null
//   stackPanel(state, ui, ns)             the panel's HTML ("" unless this screen's stack is open)
//   chosenQty(state, ui, ns)              the amount chosen (for the fast path), or Infinity when none is open
//   STACK_ACTIONS / STACK_CHANGE          sm-qty (chips, − +), sm-to (pick a destination), sm-go, sm-cancel /
//                                         sm-qtyset (the slider and the number box); ui/inventory.js merges them
//                                         into INV_ACTIONS / INV_CHANGE, a new screen can register them the same way
//   stackKey(state, ui, e)                main.js keydown, before the text-input guard: Enter moves, Esc cancels
//   stackInput(el)                        main.js "input" listener: the slider and the box update the panel live
//   dropPoint(ev)                         { x, y } of a drop event (main.js passes it to invDrop)
// State: ui.stack = { ns, qty (null: the default), to (null: the default), pop ({ x, y } or null) }.
// The sim does the moving and the limits (sim/raidloot.js raidMove / supplyFit, sim/inventory.js takeSupply,
// sim/stacks.js lootFit); this file only asks how many and where.
import { SUPPLIES } from "../sim/data.js";
import { isRoundKey } from "../sim/rounds.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const kg = (x) => `${Math.round(x * 10) / 10}`;
export const SUPPLY_ICON = { food: "🥫", preserved: "🫙", water: "💧", rawwater: "🪣", wood: "🪵", fuel: "⛽", meds: "✚", ammo: "⁍", arrows: "➶", parts: "⚙", scrap: "🔩", carparts: "🛞", gunparts: "🔧", electronics: "🔌", jars: "🫙" };
export const supplyIcon = (k) => SUPPLY_ICON[k] || (isRoundKey(k) ? "⁍" : "▪");

const PROVIDERS = {};
export function registerStackScreen(ns, provider) { PROVIDERS[ns] = provider; }
export function openStack(ui, ns, { to = null, pop = null, qty = null } = {}) { ui.stack = { ns, to, pop, qty }; }
export function closeStack(ui) { ui.stack = null; }

// The open stack worked out: { ns, P, m (the spec), dest, to, have, fit, qty, unit, name } or null.
function resolve(state, ui, ns = null) {
  const st = ui.stack;
  if (!st || (ns && st.ns !== ns)) return null;
  const P = PROVIDERS[st.ns];
  const m = P ? P.spec(state, ui) : null;
  const sup = m && SUPPLIES[m.key];
  if (!m || !sup || !(m.have >= 1) || !m.dests || !m.dests.length) return null;
  const want = st.to != null ? st.to : m.to;
  const dest = m.dests.find((d) => d.id === want) || m.dests[0];
  const have = Math.floor(m.have);
  const fit = Math.max(0, Math.min(have, Math.floor(dest.fit || 0)));
  const def = fit > 0 ? fit : have; // what fits (all of it when it all fits)
  const qty = Math.max(1, Math.min(have, Math.floor(st.qty == null ? def : st.qty)));
  return { ns: st.ns, P, m, dest, to: dest.id, have, fit, qty, unit: sup.weight, name: sup.name.toLowerCase(), title: sup.name };
}
export const chosenQty = (state, ui, ns) => { const r = resolve(state, ui, ns); return r ? r.qty : Infinity; };
export const stackOpen = (state, ui, ns) => !!resolve(state, ui, ns);

// The slider's track: chosen (accent) up to what fits, chosen past it (danger), room left (line), no room (faint danger).
function trackBg(q, f, have) {
  const pc = (n) => `${Math.round((have > 1 ? (n - 1) / (have - 1) : 1) * 1000) / 10}%`;
  const a = Math.min(q, f), Q = pc(q), A = pc(Math.max(1, a)), F = pc(Math.max(1, f)), M = pc(Math.max(q, f));
  const parts = [`var(--accent) 0 ${f >= 1 ? A : "0%"}`];
  if (q > f) parts.push(`var(--danger) ${f >= 1 ? A : "0%"} ${Q}`);
  if (f > q) parts.push(`var(--line) ${Q} ${F}`);
  parts.push(`var(--danger-soft) ${f >= 1 || q > f ? M : "0%"} 100%`);
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
const goLabel = (verb, n, name, to) => (n > 0 ? `${verb} ${n} ${name} → ${to}` : "Nothing fits there");
const fitLine = (q, f, to, unit) => (f <= 0 ? null : q > f ? `Only ${f} fit in ${to} now: ${q - f} stay` : `${f} fit in ${to} now${f > q ? ` (${kg((f - q) * unit)} kg of room after)` : ""}`);

export function stackPanel(state, ui, ns) {
  const r = resolve(state, ui, ns);
  if (!r) return "";
  const { m, dest, have, fit, qty, unit, name } = r;
  const pop = ui.stack.pop;
  const verb = m.verb || "Move";
  const n = Math.min(qty, fit);
  const to = esc(dest.label);
  const chip = (v, label, t, on = false, off = false) => `<button class="mini smchip${on ? " active" : ""}" data-action="sm-qty" data-v="${v}" ${off ? "disabled" : ""}${tip(t)}>${label}</button>`;
  const half = Math.max(1, Math.floor(have / 2));
  const chips = have > 1 ? `<div class="smchips">${chip("one", "1", "Just one", qty === 1)}${have > 3 ? chip("half", `½ <small>${half}</small>`, `Half the stack (${half})`, qty === half) : ""}${chip("all", `All <small>${have}</small>`, "The whole stack (only what fits moves)", qty === have)}${fit > 0 && fit < have ? chip("fit", `What fits <small>${fit}</small>`, `As many as fit in ${dest.label} now`, qty === fit) : ""}</div>` : "";
  const amount = have > 1 ? `<div class="smamt">
      <button class="mini smstep" data-action="sm-qty" data-v="dec" ${qty <= 1 ? "disabled" : ""}${tip("One fewer")}>−</button>
      <input type="range" class="smrange" min="1" max="${have}" step="1" value="${qty}" data-action="sm-qtyset" style="background:${trackBg(qty, fit, have)}"${tip(`How many of the ${have} to move. The bright part of the track is what fits in ${dest.label}.`)}>
      <button class="mini smstep" data-action="sm-qty" data-v="inc" ${qty >= have ? "disabled" : ""}${tip("One more")}>+</button>
      <input type="number" class="smnum" min="1" max="${have}" step="1" value="${qty}" data-action="sm-qtyset"${tip(`Type how many (1 to ${have}); Enter moves them`)}>
    </div>` : "";
  const dests = !pop && m.dests.length > 1 ? `<div class="smdests" role="radiogroup">${m.dests.map((d) => {
    const f = Math.max(0, Math.min(have, Math.floor(d.fit || 0)));
    return `<button class="smdest${d.id === dest.id ? " active" : ""}" data-action="sm-to" data-to="${esc(d.id)}" role="radio" aria-checked="${d.id === dest.id}"${tip(f ? `${f} of the ${have} fit in ${d.label} now` : d.err || `None fit in ${d.label} now`)}><span>${esc(d.label)}</span><small class="${f ? "" : "danger"}">${f ? (f >= have ? "all fit" : `${f} fit`) : "full"}</small></button>`;
  }).join("")}</div>` : "";
  const fl = fitLine(qty, fit, dest.label, unit);
  const facts = `<div class="smfacts"><span class="smweight"${tip(`${unit} kg each`)}>⚖ <b class="smkg">${kg(qty * unit)}</b> kg</span><span class="smfit ${fit <= 0 ? "danger" : qty > fit ? "warn" : "good"}">${esc(fl || dest.err || `None fit in ${dest.label} now`)}</span></div>`;
  const style = pop ? ` style="left:min(${Math.round(pop.x || 0)}px, calc(100vw - 20rem));top:min(${Math.round(pop.y || 0)}px, calc(100vh - 17rem))"` : "";
  return `<div class="smove ${pop ? "pop" : "dock"}" data-smove data-have="${have}" data-fit="${fit}" data-unit="${unit}" data-name="${esc(name)}" data-to="${to}" data-verb="${esc(verb)}" role="dialog" aria-label="How many to move"${style}>
    <div class="smhead">
      <span class="smico">${supplyIcon(m.key)}</span>
      <div class="smtitle"><b>${esc(r.title)}</b><span class="muted">${have} in the stack · ${unit} kg each</span></div>
      <button class="mini smx" data-action="sm-cancel"${tip("Cancel (Esc)")}>✕</button>
    </div>
    <div class="smroute"><span class="smfrom"${tip("Where the stack is now")}>${esc(m.from)}</span><span class="smarrow">→</span><span class="smto"${tip("Where it goes")}>${to}</span></div>
    ${dests}
    <div class="smbody">${amount}${chips}</div>
    ${facts}
    <div class="smgo"><button class="primary smbtn" data-action="sm-go" ${n > 0 ? "" : "disabled"}${tip(n > 0 ? "Enter" : dest.err || "Nothing fits there now")}>${esc(goLabel(verb, n, name, dest.label))}</button><span class="smkeys muted">Enter ↵ · Esc</span></div>
    ${m.hint ? `<div class="smhint small muted">${m.hint}</div>` : ""}
  </div>`;
}

// ---------- actions ----------
function setQty(state, ui, v) {
  const r = resolve(state, ui);
  if (!r) return;
  const q = { one: 1, dec: r.qty - 1, inc: r.qty + 1, half: Math.floor(r.have / 2), all: r.have, fit: r.fit || r.qty }[v];
  ui.stack.qty = Math.max(1, Math.min(r.have, Math.floor(q ?? (Number(v) || r.qty))));
}
function go(state, ui) {
  const r = resolve(state, ui);
  if (!r) { closeStack(ui); return; }
  const n = Math.min(r.qty, r.fit);
  if (n > 0) r.P.move(state, ui, r.to, n);
  else r.P.move(state, ui, r.to, r.qty); // nothing fits: the sim says why
  closeStack(ui);
  if (r.P.cancel) r.P.cancel(state, ui);
}
function cancel(state, ui) {
  const P = ui.stack && PROVIDERS[ui.stack.ns];
  closeStack(ui);
  if (P && P.cancel) P.cancel(state, ui);
}
export const STACK_ACTIONS = {
  "sm-qty": (state, ui, d) => setQty(state, ui, d.v),
  "sm-to": (state, ui, d) => { if (ui.stack) { ui.stack.to = d.to; ui.stack.qty = null; } }, // a new destination: what fits there
  "sm-go": (state, ui) => go(state, ui),
  "sm-cancel": (state, ui) => cancel(state, ui),
};
export const STACK_CHANGE = {
  "sm-qtyset": (state, ui, el) => { if (ui.stack) setQty(state, ui, Math.floor(Number(el.value) || 1)); },
};

// Enter moves, Esc cancels while a stack is open (true: the key was taken). The number box typed into first counts.
export function stackKey(state, ui, e) {
  if (!ui.stack || !resolve(state, ui)) return false;
  const t = e.target || {};
  if (e.code === "Escape") { cancel(state, ui); return true; }
  if (e.code === "Enter" || e.code === "NumpadEnter") {
    if (t.dataset && t.dataset.action === "sm-qtyset") setQty(state, ui, Math.floor(Number(t.value) || 1));
    go(state, ui);
    return true;
  }
  return false;
}

// The slider or the number box moved: the panel follows at once (the state is set on "change").
export function stackInput(el) {
  if (!el || !el.dataset || el.dataset.action !== "sm-qtyset" || !el.closest) return false;
  const root = el.closest("[data-smove]");
  if (!root) return false;
  const D = root.dataset, have = Number(D.have), fit = Number(D.fit), unit = Number(D.unit);
  const q = Math.max(1, Math.min(have, Math.floor(Number(el.value) || 1)));
  for (const x of root.querySelectorAll('[data-action="sm-qtyset"]')) if (x !== el) x.value = String(q);
  const range = root.querySelector(".smrange");
  if (range) range.style.background = trackBg(q, fit, have);
  const k = root.querySelector(".smkg");
  if (k) k.textContent = kg(q * unit);
  const f = root.querySelector(".smfit");
  const fl = fitLine(q, fit, D.to, unit);
  if (f && fl) { f.textContent = fl; f.className = `smfit ${q > fit ? "warn" : "good"}`; }
  const b = root.querySelector(".smbtn");
  if (b && fit > 0) b.textContent = goLabel(D.verb || "Move", Math.min(q, fit), D.name, D.to);
  for (const c of root.querySelectorAll(".smchip")) c.classList.remove("active");
  return true;
}

// Where a drop landed (the popover opens there).
export const dropPoint = (ev) => ({ x: ev.clientX + 8, y: ev.clientY + 8 });
