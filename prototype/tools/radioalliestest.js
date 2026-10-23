// The Radio coverage layer with your allies' radios (src/sim/radioallies.js, src/ui/render.js, src/ui/ui.js
// renderLegend; the user's request 2026-10-23: "Radio layer shows your radio distance and when allied you can see
// their radio distance"):
// - yours: "Your radio: 12 tiles" on your station's ring, in your colour;
// - a coalition member with a radio station: its network (radio.js groupNetwork, your rules) in the map's list, its
//   ring drawn in its colour with "<Group> radio: 12 tiles", the legend's line and tooltip ("Allied: <Group> radio,
//   12 tiles", linked or by envoy), the tile tooltip over its coverage;
// - a group with a station that is not in the coalition: none of it, on the map, the legend or the tooltip;
// - an ally with no station has no ring (it broadcasts nothing); one that leaves the coalition drops off; layer off:
//   no rings at all.
// Usage: node tools/radioalliestest.js [seed]
import { createWorld, hub, RADIO_RANGE } from "../src/sim/world.js";
import { worksAt } from "../src/sim/groupworks.js";
import { groupNetwork, canRadioGroup, MIL_RADIO_RANGE } from "../src/sim/radio.js";
import { admitToAlliance, ensureAlliance } from "../src/sim/alliance.js";
import { alliedRadioNetworks, radioLegend, radioLegendTip, radioTipLines, yourRadioRings, radioAlly } from "../src/sim/radioallies.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();

// A world with the groups' ai-locks rules (stations only), your hub on the air, two non-military groups with a radio
// station at their first base: `ally` joins the coalition, `other` does not.
const st = createWorld({ seed, factionCount: 7 });
st.started = true; st.visitorsOff = true; st.noWanderers = true;
const h = hub(st);
h.radio = true;
const groups = st.factions.filter((f) => f.alive && f.bases.length && f.type !== "military" && !f.hcSplinter && !f.hcMilitary);
const [ally, other, quiet] = groups;
for (const f of st.factions) if (f.works) for (const t of f.bases) if (f.works[t]) f.works[t].radio = 0;
worksAt(ally, ally.bases[0]).radio = 1;
worksAt(other, other.bases[0]).radio = 1;
admitToAlliance(st, ally, "test", true);
admitToAlliance(st, quiet, "test", true); // a member with no station of its own

console.log("Your radio");
{
  const mine = yourRadioRings(st).find((n) => n.base === h);
  check(mine && mine.range === RADIO_RANGE && mine.label === `Your radio: ${RADIO_RANGE} tiles`, `your station's ring: "${mine && mine.label}"`);
  const L = radioLegend(st);
  check(L.mine && L.mine.text === `Your radio: ${RADIO_RANGE} tiles`, `the legend: "${L.mine && L.mine.text}"`);
}

console.log("An allied group's radio");
{
  check(radioAlly(st, ally) && !radioAlly(st, other), "the coalition member is an ally, the other group is not");
  const nets = alliedRadioNetworks(st);
  const a = nets.find((n) => n.id === ally.id);
  const want = groupNetwork(st, ally);
  check(!!a && !!want && a.nodes.length === want.nodes.length && a.nodes.every((n, i) => n.tile === want.nodes[i].tile && n.range === want.nodes[i].range), "its network by your rules (radio.js groupNetwork: its station)");
  check(a && a.nodes[0].range === RADIO_RANGE && a.nodes[0].label === `${ally.name} radio: ${RADIO_RANGE} tiles` && a.color === ally.color, `drawn in its colour, labelled "${a && a.nodes[0].label}"`);
  check(a && a.linked === canRadioGroup(st, ally), `linked to yours: ${a && a.linked} (canRadioGroup)`);
  const L = radioLegend(st), la = L.allies.find((x) => x.id === ally.id);
  check(la && la.text.startsWith(`Allied: ${ally.name} radio, ${RADIO_RANGE} tiles (`) && la.color === ally.color, `the legend: "${la && la.text}"`);
  const tipText = radioLegendTip(st);
  check(tipText.includes(`Your radio: ${RADIO_RANGE} tiles`) && tipText.includes(`Allied: ${ally.name} radio`), "the Layers tooltip names your radio and the ally's");
  const lines = radioTipLines(st, ally.bases[0]).map((o) => o.text);
  check(lines.some((t) => t.startsWith(`📻 Allied: ${ally.name} radio, ${RADIO_RANGE} tiles`)), `the tile tooltip over its base: ${JSON.stringify(lines)}`);
  check(!nets.some((n) => n.id === quiet.id), "an ally with no radio station has no ring (it broadcasts nothing)");
  // A military ally: its army sets at every base, MIL_RADIO_RANGE, as a Military encrypted radio makes your base a station.
  const mil = st.factions.find((f) => f.alive && f.bases.length && f.type === "military");
  if (mil) {
    admitToAlliance(st, mil, "test", true);
    const m = alliedRadioNetworks(st).find((n) => n.id === mil.id);
    const sets = m ? m.nodes.filter((n) => n.kind === "station") : [];
    check(sets.length >= 1 && sets.every((n) => n.range === MIL_RADIO_RANGE && n.label === `${mil.name} radio: ${MIL_RADIO_RANGE} tiles`), `a military ally: ${MIL_RADIO_RANGE} tiles from its army sets (${sets.length} bases)`);
    ensureAlliance(st).members = st.alliance.members.filter((id) => id !== mil.id);
  }
}

console.log("A group that is not allied");
{
  check(!!groupNetwork(st, other), "it has a network of its own (a station)");
  check(!alliedRadioNetworks(st).some((n) => n.id === other.id), "not in the map's allied radios");
  const L = radioLegend(st);
  check(!L.allies.some((x) => x.id === other.id) && !radioLegendTip(st).includes(other.name), "not in the legend or its tooltip");
  const lines = radioTipLines(st, other.bases[0]).map((o) => o.text);
  check(!lines.some((t) => t.includes(other.name)), "not in the tile tooltip over its own base");
}

console.log("On the map (ui/render.js) and the Layers box (ui/ui.js)");
{
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const R = await import("../src/ui/render.js");
  const { renderLegend } = await import("../src/ui/ui.js");
  // A stub context that keeps each ring (arc stroked in a colour) and each text written.
  let arcs = [], texts = [], path = [];
  const o = { measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) };
  o.beginPath = () => { path = []; };
  o.arc = (x, y, r) => { path.push(r); };
  o.stroke = () => { for (const r of path) arcs.push({ r, color: String(o.strokeStyle) }); };
  o.fillText = (t) => { texts.push(String(t)); };
  const ctx = new Proxy(o, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  R.initRenderer({ getContext: () => ctx, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
  R.setMapAnim(false);
  const draw = (layers) => { R.view.layers = new Set(layers); R.view.devReveal = true; R.camera.zoom = 0.25; R.centerOn(st, h.tile); R.redrawMap(true); arcs = []; texts = []; R.render(st); };
  draw(["pois", "territory", "radio"]);
  const ringR = (range) => range * 26 * Math.sqrt(3);
  check(arcs.some((a) => a.color === ally.color && Math.abs(a.r - ringR(RADIO_RANGE)) < 0.01), "the ally's ring is stroked in its colour");
  check(!arcs.some((a) => a.color === other.color && Math.abs(a.r - ringR(RADIO_RANGE)) < 0.01), "no ring in the other group's colour");
  check(texts.includes(`Your radio: ${RADIO_RANGE} tiles`), "your ring's label is written");
  check(texts.includes(`${ally.name} radio: ${RADIO_RANGE} tiles`), "the ally's ring's label is written");
  check(!texts.some((t) => t.startsWith(`${other.name} radio`)), "nothing written for the other group");
  const tt = R.tileTooltip(st, ally.bases[0]);
  check(tt.includes(`Allied: ${ally.name} radio`), "the map's tile tooltip names the ally's radio over its base");
  check(!R.tileTooltip(st, other.bases[0]).includes(`${other.name} radio`), "and not the other group's over its base");
  const lg = renderLegend(R.view, { legendCollapsed: false }, st);
  check(/data-k="radio"/.test(lg) && lg.includes(`Allied: ${ally.name} radio`) && !lg.includes(`${other.name} radio`) && /data-tip-pre/.test(lg), "the Layers box: the radio line's tooltip names the ally, not the other group");
  check(lg.includes(`color:${ally.color}">●${RADIO_RANGE}`), "the Layers box's radio line shows the ally's reach in its colour");
  check(/<input type="checkbox" data-action="layer" data-k="radio"/.test(lg), "the toggle stays a plain checkbox (focusable)");
  draw(["pois", "territory"]);
  check(!arcs.some((a) => a.color === ally.color && Math.abs(a.r - ringR(RADIO_RANGE)) < 0.01) && !texts.some((t) => t.includes(" radio: ")), "layer off: no rings, no labels");
  // The ally leaves: gone from the map.
  st.alliance.members = st.alliance.members.filter((id) => id !== ally.id);
  draw(["pois", "territory", "radio"]);
  check(!texts.includes(`${ally.name} radio: ${RADIO_RANGE} tiles`) && !alliedRadioNetworks(st).length, "a group that leaves the coalition drops off the layer");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
