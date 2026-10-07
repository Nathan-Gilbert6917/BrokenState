// Outsiders in the UI (sim/visitors.js): the Groups tab's "Outsiders" section, their alerts, the trade window's
// buttons for merchants, and the handlers (VISITOR_ACTIONS, registered by main.js).
import { hub, baseById, log } from "../sim/world.js";
import { SUPPLIES } from "../sim/data.js";
import {
  knownVisitors, visitorView, visitorById, radioPayRaiders, inviteMerchants, radioNewsFrom, reopenGate, openVisitorTrade, attackMerchants,
  visitorAlertsData, goodsText, VISITOR_COLORS, merchantRep,
} from "../sim/visitors.js";
import { wormOthersAt } from "../sim/worm.js"; // sick guests sheltering at a base
import { otherWormRow } from "./health.js";
import { ask } from "./confirm.js"; // robbing merchants asks first (one confirmation style)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const ICON = { raiders: "☠", merchants: "🐂", explorers: "🎒" };
const ATT_COLOR = { Hostile: "var(--danger)", Neutral: "var(--muted)", Friendly: "var(--good)", Allied: "var(--accent)", Wary: "var(--muted)", "Paid off": "var(--muted)" };
const planText = (plan) => Object.entries(plan || {}).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${SUPPLIES[k] ? k : k}`).join(", ");
const ago = (h) => (h == null ? "" : h < 1 ? "now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`);

// ---------- Groups tab ----------
export function outsidersSection(state) {
  const list = knownVisitors(state);
  const rep = merchantRep(state);
  const head = `<h3${tip("Raiders, merchants and travellers from beyond the State of Calder. They come in over the border, cross the map and leave again. You see them when your bases or teams in radio contact can see them, and hear of them when they are in your radio coverage.")}>Outsiders</h3>`;
  const repLine = rep < -1 ? `<div class="small danger"${tip("Merchants from outside heard you attack their kind. They come with less goodwill (hostile from −40: no trade) and skip your bases from −30. It fades by 0.25 a day.")}>Merchant reputation ${Math.round(rep)}</div>` : "";
  if (!list.length) return `${head}${repLine}<div class="muted small">No outsiders seen on the map right now.</div>`;
  return `${head}${repLine}${list.map((v) => card(state, visitorView(state, v))).join("")}`;
}

function card(state, w) {
  const v = w.v;
  const status = w.live ? `<span class="good">in sight</span>` : w.heard ? `<span${tip("In your radio coverage: you hear of them, the map shows them faded")}>heard on the radio</span>` : `<span class="muted">last seen ${ago(w.age)}</span>`;
  const btns = [];
  if (w.tile != null) btns.push(`<button data-action="center" data-tile="${w.tile}"${tip(w.live || w.heard ? "Center the map on them" : "Center the map where they were last seen")}>Locate</button>`);
  if (w.tradeHere) btns.push(`<button data-action="vis-trade" data-id="${v.id}" data-base="${w.tradeHere.id}"${tip(`Open the trade window at ${w.tradeHere.name}`)}>Trade</button>`);
  if (w.gate) btns.push(`<button data-action="vis-gate" data-id="${v.id}"${tip("Talk to them at the gate again")}>At the gate…</button>`);
  if (w.canInvite) btns.push(`<button data-action="vis-invite" data-id="${v.id}"${tip("Over the radio: ask them to come to your hub (or the nearest base they can reach) next")}>Invite to trade</button>`);
  if (w.canNews) btns.push(`<button data-action="vis-news" data-id="${v.id}"${tip("Over the radio: news of other states, and the roads they took marked on your map")}>Ask for news</button>`);
  if (w.canPay) btns.push(`<button data-action="vis-pay" data-id="${v.id}" ${w.payPlan ? "" : "disabled"}${tip(w.payPlan ? `Over the radio: they leave the state for ${planText(w.payPlan)} from ${hub(state) ? hub(state).name : "the hub"} (Speech at the hub makes it cheaper)` : "The hub does not have enough to offer them")}>Pay them to leave${w.payPlan ? ` (${esc(planText(w.payPlan))})` : ""}</button>`);
  // Guests sheltering at your base with the worm (once spotted): treat them here; it wins their goodwill (sim/worm.js).
  const sb = v.phase === "sheltered" ? baseById(state, v.shelterBase) : null;
  const sick = sb ? wormOthersAt(state, sb).filter((o) => o.kind === "guest" && o.v === v && o.w.seen != null) : [];
  const worm = sick.length ? `<div class="small" style="margin-top:0.25rem">Sick with the worm at ${esc(sb.name)}: ${sick.length} of them.</div>${sick.map((o) => otherWormRow(state, sb, o)).join("")}` : "";
  const extra = v.kind === "merchants" ? `<div class="small muted">Carrying ${esc(goodsText(v))}</div>` : v.kind === "raiders" ? `<div class="small muted">Armed with ${esc(w.gear)} · strength about ${w.strength}</div>` : "";
  return `<div class="card">
    <div class="spread"><b><span class="swatch" style="background:${VISITOR_COLORS[v.kind]}"></span>${ICON[v.kind]} ${esc(w.name)}</b><span style="color:${ATT_COLOR[w.attitude] || "var(--muted)"}">${esc(w.attitude)}</span></div>
    <div class="small muted">${esc(w.label)}${w.sub ? ` (${esc(w.sub)})` : ""} · ${w.size} ${w.size === 1 ? "person" : "people"} · from ${esc(w.home)} (came in from the ${esc(w.from)})</div>
    <div class="small">${esc(w.act)} · ${esc(w.where)} · ${status}</div>
    ${extra}
    ${worm}
    ${btns.length ? `<div class="row" style="margin-top:0.35rem;flex-wrap:wrap">${btns.join("")}</div>` : ""}
  </div>`;
}

// ---------- alerts (ui/alerts.js) ----------
export function visitorAlerts(state) {
  return visitorAlertsData(state).map((a) => {
    const v = a.v;
    if (a.kind === "raiders") {
      const text = a.siege ? `Raiders at the walls of ${a.base.name}` : a.heading ? `Raiders ${a.dist} tile${a.dist === 1 ? "" : "s"} from ${a.base.name}` : `Raiders from outside near ${a.base.name}`;
      return { key: `outsider:${v.id}:${a.heading ? 1 : 0}`, kind: "outsiders", icon: "☠", tone: a.heading ? "danger" : "warn", text, tip: `${v.name}: about ${v.size} raiders from ${v.home}, ${v.act}. Prepare the defences, pay them off or fight (the warning card), or pay them to leave over the radio (Groups tab). Click to see them.`, go: { tile: v.tile } };
    }
    return { key: `merchants:${v.id}`, kind: "caravan", icon: "🐂", tone: "good", text: `Merchants from outside at ${a.base ? a.base.name : "your base"}`, tip: `${v.name} from ${v.home}: ${goodsText(v)}. Open the trade window from the Groups tab (Outsiders). Click to see them.`, go: { tile: v.tile } };
  });
}

// ---------- the trade window (ui/tradewindow.js) ----------
export function visitorTradeHead(state, ctx) {
  const v = ctx.visitor;
  return `${v.kind === "merchants" ? "Merchants" : "Travellers"} from ${esc(v.home)}, from outside the state`;
}
export function visitorTradeButtons(state, ui, ctx) {
  const v = ctx.visitor;
  if (v.kind !== "merchants") return "";
  const where = ctx.base ? `data-base="${ctx.base.id}"` : `data-party="${ctx.p.id}"`;
  return `<button data-action="vis-attack" data-id="${v.id}" ${where}${tip(`Fight their ${v.guards || 1} guards for everything they carry. Merchant reputation −45; traders −15 and communes and fortresses −8 goodwill. Asks first.`)}>Rob the merchants…</button>`;
}

// ---------- handlers ----------
export const VISITOR_ACTIONS = {
  "vis-trade": (state, ui, d) => { const v = visitorById(state, d.id); if (v && baseById(state, Number(d.base))) openVisitorTrade(state, v, { baseId: Number(d.base) }); },
  "vis-gate": (state, ui, d) => { const v = visitorById(state, d.id); if (v) reopenGate(state, v); },
  // Radio calls: the answer goes to the log (radioNewsFrom and a payment log their own line).
  "vis-invite": (state, ui, d) => { const v = visitorById(state, d.id); if (v) log(state, `Radio: ${inviteMerchants(state, v)}`, "info"); },
  "vis-news": (state, ui, d) => { const v = visitorById(state, d.id); if (v) { const t = radioNewsFrom(state, v); if (!/^.+ on the radio:/.test(t)) log(state, `Radio: ${t}`, "info"); } },
  "vis-pay": (state, ui, d) => { const v = visitorById(state, d.id); if (v) { const t = radioPayRaiders(state, v); if (!/are leaving the state\.$/.test(t)) log(state, `Radio: ${t}`, "info"); } },
  // Rob the merchants: asks first (ui/confirm.js), then a battle against their guards.
  "vis-attack": (state, ui, d) => VISITOR_ACTIONS["vis-attack-yes"](state, ui, d),
  "vis-attack-no": (state, ui) => { ui.visitorAttack = null; },
  "vis-attack-yes": (state, ui, d) => {
    const v = visitorById(state, d.id);
    if (v && ask(ui, d, "vis-attack-yes", { kind: "rob", title: `Rob the merchants from ${v.home}?`, text: `A battle against their ${v.guards || 1} guards; win and their goods are yours. Every trading group hears of it (merchant reputation −45; traders −15, communes and fortresses −8 goodwill) and merchants from outside shun you.`, yes: "Rob them" })) return;
    ui.visitorAttack = null;
    ui.tradeMsg = "";
    if (!v) return;
    const msg = attackMerchants(state, v, d.party != null ? { partyId: Number(d.party) } : { baseId: Number(d.base) });
    if (msg) ui.tradeMsg = msg;
  },
};
