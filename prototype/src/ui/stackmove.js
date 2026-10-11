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
// The mouse wheel over a stack tile (data-stack), the slider or the number box: one more or fewer (Shift: 10), held to
// 1 and the stack; over a tile not picked yet, the first tick picks it and opens the mover (stackWheel).
// Split (✂): a stack is cut in two where it lies (24 food → 16 + 8) so one part can be moved and the other left. The
// places that hold supplies are plain { key: count } maps (a container's contents, a body's supplies, a person's haul,
// the trunk, the team's cargo, a base's stores; the AI's too), so the split is the window's, not the sim's: the
// screen keeps a little note per stack (spec.splits[at] = { n: the part cut off, total: the stack when last seen,
// pick: "a" | "b", the part the mover moves }), the tile shows "16 + 8", the mover moves only the part picked, and
// what left the stack since (a move, a fast click, a Shift+drag, someone eating) comes off the picked part first; a
// part that empties joins the other. Nothing in the world or the save changes, so nothing can be lost or doubled.
// Join puts the parts back together.
// Fit bars (a wide panel, 34rem and up: a container query): with several destinations, one thin bar under the slider
// for each, as long as what fits there, in the colour of its chip; bright when it takes the amount chosen.
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
//       at, splits           optional: the stack's own id (the tile's data-stack) and the object where the screen keeps
//                            its splits (its lifetime: the window's); without them there is no Split
//     }
//     move(state, ui, toId, qty) → does the move through the sim (and sets the screen's message)
//     cancel(state, ui)      optional: also drop the screen's selection (ui.invSel)
//     pick(state, ui, at)    optional: select the stack at (the wheel over a tile not picked yet), then the mover opens
//   }
//   openStack(ui, ns, { to, pop, qty })   the screen picked a stack (click: no pop; drop: pop and to)
//   closeStack(ui)                        ui.stack = null
//   stackPanel(state, ui, ns)             the panel's HTML ("" unless this screen's stack is open)
//   chosenQty(state, ui, ns)              the amount chosen (for the fast path), or Infinity when none is open
//   STACK_ACTIONS / STACK_CHANGE          sm-qty (chips, − +), sm-to (pick a destination), sm-go, sm-cancel, sm-split,
//                                         sm-part (which part moves), sm-join /
//                                         sm-qtyset (the slider and the number box); ui/inventory.js merges them
//                                         into INV_ACTIONS / INV_CHANGE, a new screen can register them the same way
//   stackKey(state, ui, e)                main.js keydown, before the text-input guard: Enter moves, Esc cancels
//   stackInput(el)                        main.js "input" listener: the slider and the box update the panel live
//   stackWheel(state, ui, e)              main.js "wheel" listener: 0 (not ours: let it scroll), 1 (taken), 2 (changed:
//                                         redraw); preventDefault on 1 and 2
//   splitParts(store, at, have) / splitCount(store, at, have)   a stack's parts ({ a, b, pick } or null) / its count
//                                         as tile HTML ("16 + <b>8</b>", or "24")
//   dropPoint(ev)                         { x, y } of a drop event (main.js passes it to invDrop)
// State: ui.stack = { ns, qty (null: the default), to (null: the default), pop ({ x, y } or null) }.
// The sim does the moving and the limits (sim/raidloot.js raidMove / supplyFit, sim/inventory.js takeSupply,
// sim/stacks.js lootFit); this file only asks how many and where.
import { SUPPLIES } from "../sim/data.js";
import { isRoundKey } from "../sim/rounds.js";
import { supplyName } from "../sim/itemnames.js"; // the stack's title: rounds say "— loose"

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const kg = (x) => `${Math.round(x * 10) / 10}`;
export const SUPPLY_ICON = { food: "🥫", preserved: "🫙", water: "💧", rawwater: "🪣", wood: "🪵", fuel: "⛽", meds: "✚", ammo: "⁍", arrows: "➶", parts: "⚙", scrap: "🔩", carparts: "🛞", gunparts: "🔧", electronics: "🔌", jars: "🫙" };
export const supplyIcon = (k) => SUPPLY_ICON[k] || (isRoundKey(k) ? "⁍" : "▪");

const PROVIDERS = {};
export function registerStackScreen(ns, provider) { PROVIDERS[ns] = provider; }
export function openStack(ui, ns, { to = null, pop = null, qty = null } = {}) { ui.stack = { ns, to, pop, qty }; }
export function closeStack(ui) { ui.stack = null; }

// ---------- splits (the window's note of a stack cut in two; the sim keeps one count) ----------
// The parts of the stack at `at` now ({ a, b, pick } or null), squared with how many there are: what left the stack
// since it was last seen comes off the picked part first, what came in joins part a; a part that empties ends it.
export function splitParts(store, at, have) {
  const s = store && at != null ? store[at] : null;
  if (!s) return null;
  have = Math.floor(Math.max(0, have || 0));
  const d = s.total - have;
  if (d > 0) {
    if (s.pick === "b") s.n -= d; // (more than part b: the rest came off part a, which the next line sees)
    else s.n -= Math.max(0, d - (s.total - s.n)); // part a first, then b
  }
  s.total = have;
  if (!(s.n >= 1) || s.n >= have) { delete store[at]; return null; }
  return { a: have - s.n, b: s.n, pick: s.pick === "a" ? "a" : "b" };
}
// The count on a stack tile: "16 + <b>8</b>" (the picked part bold) when it is split, else the count.
export function splitCount(store, at, have) {
  const sp = splitParts(store, at, have);
  const n = Math.floor(have || 0);
  return sp ? `<span class="smsplit"${tip(`Split in two (${sp.a} + ${sp.b} of ${n}): the mover moves the part in bold, the other stays. Join puts them back together.`)}>${sp.pick === "a" ? `<b>${sp.a}</b>` : sp.a} + ${sp.pick === "b" ? `<b>${sp.b}</b>` : sp.b}</span>` : `${n}`;
}

// The open stack worked out: { ns, P, m (the spec), dest, to, have (the part that moves: the stack, or the picked part
// of a split one), stack (all of it), sp (its parts or null), fit, qty, unit, name } or null.
function resolve(state, ui, ns = null) {
  const st = ui.stack;
  if (!st || (ns && st.ns !== ns)) return null;
  const P = PROVIDERS[st.ns];
  const m = P ? P.spec(state, ui) : null;
  const sup = m && SUPPLIES[m.key];
  if (!m || !sup || !(m.have >= 1) || !m.dests || !m.dests.length) return null;
  const want = st.to != null ? st.to : m.to;
  const dest = m.dests.find((d) => d.id === want) || m.dests[0];
  const stack = Math.floor(m.have);
  const store = m.at != null && m.splits ? m.splits : null;
  const sp = store ? splitParts(store, m.at, stack) : null;
  const have = sp ? sp[sp.pick] : stack;
  const fit = Math.max(0, Math.min(have, Math.floor(dest.fit || 0)));
  const def = fit > 0 ? fit : have; // what fits (all of it when it all fits)
  const qty = Math.max(1, Math.min(have, Math.floor(st.qty == null ? def : st.qty)));
  return { ns: st.ns, P, m, dest, to: dest.id, have, stack, sp, store, fit, qty, unit: sup.weight, name: sup.name.toLowerCase(), title: supplyName(m.key) };
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
// Fit bars (wide panels: styles.css shows them from 34rem): one thin bar under the slider per destination, as long as
// what fits there on the slider's own scale, in the colour of its chip (k0..k3); "ok" when it takes the amount chosen.
const barPc = (f, have) => (f < 1 ? 0 : have > 1 ? Math.round(((Math.min(f, have) - 1) / (have - 1)) * 1000) / 10 : 100);
export function fitBars(dests, have, qty) {
  if (!dests || dests.length < 2 || have < 2) return "";
  return `<div class="smfits" aria-hidden="true"><i class="smqline" style="left:${barPc(qty, have)}%"></i>${dests.map((d, i) => {
    const f = Math.max(0, Math.min(have, Math.floor(d.fit || 0)));
    const w = barPc(f, have);
    return `<div class="smfitrow k${i % 4}${f >= qty ? " ok" : ""}" data-fit="${f}"><i style="width:${w}%"></i><span class="${w > 62 ? "end" : ""}" style="${w > 62 ? `right:${Math.round((100 - w) * 10) / 10}%` : `left:${w}%`}">${esc(d.label)} <b>${f >= have ? "all" : f || "full"}</b></span></div>`;
  }).join("")}</div>`;
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
  const bars = !pop ? fitBars(m.dests, have, qty) : ""; // several destinations: how many fit at each, on the slider's scale
  const amount = have > 1 ? `<div class="smamt${bars ? " barred" : ""}">
      <button class="mini smstep" data-action="sm-qty" data-v="dec" ${qty <= 1 ? "disabled" : ""}${tip("One fewer")}>−</button>
      <div class="smtrack"><input type="range" class="smrange" min="1" max="${have}" step="1" value="${qty}" data-action="sm-qtyset" style="background:${trackBg(qty, fit, have)}"${tip(`How many of the ${have} to move (the mouse wheel: one at a time, Shift: ten). The bright part of the track is what fits in ${dest.label}.${bars ? " The bars under it: how many fit at each place, in the colour of its button." : ""}`)}>${bars}</div>
      <button class="mini smstep" data-action="sm-qty" data-v="inc" ${qty >= have ? "disabled" : ""}${tip("One more")}>+</button>
      <input type="number" class="smnum" min="1" max="${have}" step="1" value="${qty}" data-action="sm-qtyset"${tip(`Type how many (1 to ${have}); Enter moves them`)}>
    </div>` : "";
  const dests = !pop && m.dests.length > 1 ? `<div class="smdests" role="radiogroup" aria-label="Where it goes">${m.dests.map((d, i) => {
    const f = Math.max(0, Math.min(have, Math.floor(d.fit || 0)));
    return `<button class="smdest${d.id === dest.id ? " active smto" : ""}" data-action="sm-to" data-to="${esc(d.id)}" role="radio" aria-checked="${d.id === dest.id}"${tip(f ? `${f} of the ${have} fit in ${d.label} now` : d.err || `None fit in ${d.label} now`)}>${bars ? `<i class="smsw k${i % 4}"></i>` : ""}<span>${esc(d.label)}</span><small class="${f ? "" : "danger"}">${f ? (f >= have ? "all fit" : `${f} fit`) : "full"}</small></button>`;
  }).join("")}</div>` : "";
  // Split: cut the stack in two where it lies (the screen keeps the note, spec.splits), or pick the part / join them.
  const sp = r.sp;
  const split = !r.store || r.stack < 2 ? "" : sp
    ? `<div class="smparts" role="radiogroup" aria-label="Which part moves"><span class="muted">Split</span>${["a", "b"].map((p) => `<button class="mini smpart${sp.pick === p ? " active" : ""}" data-action="sm-part" data-part="${p}" role="radio" aria-checked="${sp.pick === p}"${tip(`Move from this part (${sp[p]}); the other ${sp[p === "a" ? "b" : "a"]} stay where they are`)}>${sp[p]}</button>`).join(`<span class="muted">+</span>`)}<button class="mini smjoin" data-action="sm-join"${tip(`Put the two parts back together: one stack of ${r.stack}`)}>Join</button></div>`
    : `<button class="mini smsplitbtn" data-action="sm-split" ${qty < have ? "" : "disabled"}${tip(qty < have ? `Cut the stack in two where it lies: ${have - qty} + ${qty}. The ${qty} is the part the mover moves; the other ${have - qty} stay. Join puts them back.` : "Pick fewer than the whole stack, then split it in two (the part picked is the one that moves)")}>✂ Split <small>${have - qty} + ${qty}</small></button>`;
  const fl = fitLine(qty, fit, dest.label, unit);
  const facts = `<div class="smfacts"><span class="smweight"${tip(`What moves weighs (${unit} kg each)`)}><b class="smkg">${kg((fit > 0 ? n : qty) * unit)}</b> kg</span><span class="smfit ${fit <= 0 ? "danger" : qty > fit ? "warn" : "good"}">${esc(fl || dest.err || `None fit in ${dest.label} now`)}</span></div>`;
  const style = pop ? ` style="left:clamp(0.5rem, ${Math.round(pop.x || 0)}px, calc(100vw - 20.5rem));top:clamp(0.5rem, ${Math.round(pop.y || 0)}px, calc(100vh - 16rem))"` : ""; // kept on screen
  return `<div class="smove ${pop ? "pop" : "dock"}" data-smove data-have="${have}" data-fit="${fit}" data-unit="${unit}" data-name="${esc(name)}" data-to="${to}" data-verb="${esc(verb)}" role="dialog" aria-label="How many to move"${style}>
    <div class="smtop"><div class="smhead">
      <span class="smico">${supplyIcon(m.key)}</span>
      <div class="smtitle"><b>${esc(r.title)}</b><span class="muted">${r.stack} in the stack${sp ? ` (${sp.a} + ${sp.b})` : ""} · ${unit} kg each</span></div>
    </div>
    <div class="smroute"><span class="smfrom"${tip("Where the stack is now")}>${esc(m.from)}</span><span class="smarrow">→</span>${dests || `<span class="smto"${tip("Where it goes")}>${to}</span>`}</div></div>
    <button class="mini smx" data-action="sm-cancel"${tip("Cancel (Esc)")}>✕</button>
    <div class="smbody">${amount}${chips}${split}</div>
    <div class="smfoot">${facts}<div class="smgo"><button class="primary smbtn" data-action="sm-go" ${n > 0 ? "" : "disabled"}${tip(n > 0 ? "Enter" : dest.err || "Nothing fits there now")}>${esc(goLabel(verb, n, name, dest.label))}</button><span class="smkeys muted">Enter ↵ · Esc</span></div></div>
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
  if (r.sp) { const m = r.P.spec(state, ui); splitParts(r.store, r.m.at, m && m.at === r.m.at ? m.have : 0); } // the parts left (or one stack again)
  closeStack(ui);
  if (r.P.cancel) r.P.cancel(state, ui);
}
function cancel(state, ui) {
  const P = ui.stack && PROVIDERS[ui.stack.ns];
  closeStack(ui);
  if (P && P.cancel) P.cancel(state, ui);
}
// Split: the amount chosen is cut off as part b (the part that moves); the rest, part a, stays. Only the window's note
// changes (spec.splits), never the stack.
function split(state, ui) {
  const r = resolve(state, ui);
  if (!r || !r.store || r.sp || !(r.qty < r.stack)) return;
  r.store[r.m.at] = { n: r.qty, total: r.stack, pick: "b" };
  ui.stack.qty = null; // what fits of the part
}
function pickPart(state, ui, part) {
  const r = resolve(state, ui);
  if (!r || !r.sp || (part !== "a" && part !== "b")) return;
  r.store[r.m.at].pick = part;
  ui.stack.qty = null;
}
function join(state, ui) {
  const r = resolve(state, ui);
  if (!r || !r.sp) return;
  delete r.store[r.m.at];
  ui.stack.qty = null;
}
export const STACK_ACTIONS = {
  "sm-qty": (state, ui, d) => setQty(state, ui, d.v),
  "sm-to": (state, ui, d) => { if (ui.stack) { ui.stack.to = d.to; ui.stack.qty = null; } }, // a new destination: what fits there
  "sm-go": (state, ui) => go(state, ui),
  "sm-cancel": (state, ui) => cancel(state, ui),
  "sm-split": (state, ui) => split(state, ui),
  "sm-part": (state, ui, d) => pickPart(state, ui, d.part),
  "sm-join": (state, ui) => join(state, ui),
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
  if (k) k.textContent = kg((fit > 0 ? Math.min(q, fit) : q) * unit); // what moves
  const f = root.querySelector(".smfit");
  const fl = fitLine(q, fit, D.to, unit);
  if (f && fl) { f.textContent = fl; f.className = `smfit ${q > fit ? "warn" : "good"}`; }
  const b = root.querySelector(".smbtn");
  if (b && fit > 0) b.textContent = goLabel(D.verb || "Move", Math.min(q, fit), D.name, D.to);
  for (const c of root.querySelectorAll(".smchip")) c.classList.remove("active");
  const sb = root.querySelector(".smsplitbtn"); // ✂ Split: where the cut falls
  if (sb) { sb.disabled = q >= have; const n = sb.querySelector("small"); if (n) n.textContent = `${have - q} + ${q}`; }
  const ql = root.querySelector(".smqline"); // the fit bars: the line at the amount, bright where it fits
  if (ql) ql.style.left = `${barPc(q, have)}%`;
  for (const x of root.querySelectorAll(".smfitrow")) x.classList.toggle("ok", Number(x.dataset.fit) >= q);
  return true;
}

// The mouse wheel (main.js, a non-passive "wheel" listener): over a stack tile (data-stack, data-smns: its screen),
// the slider or the number box, a tick up is one more, down one fewer (Shift: ten), held to 1 and the stack (the
// picked part of a split one); past what fits is allowed and warned about, as with the slider. Over a tile not picked
// yet, the first tick picks it (provider.pick) and the mover opens. Returns 0 (not taken: the page and the window
// scroll as usual, also at either end of the slider), 1 (taken, nothing changed: a trackpad's small steps adding up),
// 2 (changed: redraw). main.js calls preventDefault on 1 and 2.
const WHEEL_TICK = 50; // px of a trackpad's small steps that make one tick (a mouse notch is ~100: one tick at once)
let wheelAcc = 0;
export function stackWheel(state, ui, e) {
  const t = e && e.target;
  if (!t || !t.closest) return 0;
  const dy = e.deltaY || e.deltaX || 0; // Shift+wheel scrolls sideways in most browsers: the same tick
  if (!dy) return 0;
  const ctl = t.closest(".smrange, .smnum");
  const tile = ctl ? null : t.closest("[data-stack]");
  if (ctl ? !ctl.closest("[data-smove]") : !tile) return 0;
  let r = resolve(state, ui);
  if (tile) {
    const at = tile.dataset.stack, ns = tile.dataset.smns;
    if (!r || r.ns !== ns || r.m.at !== at) {
      const P = PROVIDERS[ns];
      if (!P || !P.pick) return 0;
      const was = ui.stack;
      P.pick(state, ui, at);
      openStack(ui, ns);
      if (!resolve(state, ui, ns)) { ui.stack = was; return 0; } // nowhere to move it: as before
      wheelAcc = 0;
      return 2;
    }
  }
  if (!r) return 0;
  const dir = dy < 0 ? 1 : -1; // up: more
  const room = dir > 0 ? r.qty < r.have : r.qty > 1;
  if (!room) { wheelAcc = 0; return 0; } // at the end: let it scroll
  if (e.deltaMode === 0 && Math.abs(dy) < WHEEL_TICK) {
    wheelAcc = Math.sign(wheelAcc) === Math.sign(dy) ? wheelAcc + dy : dy;
    if (Math.abs(wheelAcc) < WHEEL_TICK) return 1;
  }
  wheelAcc = 0;
  const q = Math.max(1, Math.min(r.have, r.qty + dir * (e.shiftKey ? 10 : 1)));
  ui.stack.qty = q;
  return 2;
}

// Where a drop landed (the popover opens there).
export const dropPoint = (ev) => ({ x: ev.clientX + 8, y: ev.clientY + 8 });
