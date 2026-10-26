// Radio coverage on the map: yours and your allies' (the user's request 2026-10-23: "Radio layer shows your radio
// distance and when allied you can see their radio distance"). What the Radio coverage layer (markers.js LAYERS.radio;
// ui/render.js draws it) shows, and the words for its legend line and the tile tooltip:
// - Yours: every station and relay at your bases (radio.js radioNodes), in your colour, "Your radio: 12 tiles" /
//   "Your relay: 6 tiles" on the ring's top (red, "not linked" or "off the air", for a relay off the net).
// - An ally's: a group in the Calder Coalition (alliance.js isMember: the game's alliance with you; a pact alone is not
//   one) with a radio network of its own (radio.js groupNetwork: its stations, the military's army sets at every base,
//   its relay masts while linked, by your rules: docs/adr/0001-ai-parity.md), in its colour, "<Group> radio: 12 tiles"
//   under each ring. A member with no station broadcasts nothing and has no ring. Groups outside the coalition are
//   never drawn here (a channel you listen in on still shows, dotted: radiolisten.js tunedNetworks).
// - Linked: an ally whose base lies within your coverage + 6 with a set of its own (radio.js canRadioGroup) talks to
//   you by radio; without that link its word comes by envoy (envoys.js). The legend's tooltip and the tile tooltip
//   say which.
import { radioNodes, groupNetwork, canRadioGroup, PLAYER_NET_COLOR } from "./radio.js";
import { isMember, allianceMembers } from "./alliance.js";

export const RADIO_YOU_COLOR = PLAYER_NET_COLOR; // your colour (render.js PLAYER_COLOR)

// A group you are allied with: a member of the coalition.
export const radioAlly = (state, f) => !!f && f.alive && isMember(state, f);

// Your transmitters at your bases: { base, tile, range, kind, linked, offline, label }. A relay mast out on the land
// (fieldworks.js: node.field) is drawn with the field works, not here.
export function yourRadioRings(state) {
  return radioNodes(state).filter((n) => !n.field).map((n) => ({ ...n, label: yourLabel(n) }));
}
export const yourLabel = (n) => `Your ${n.kind === "relay" ? "relay" : n.kind === "tower" ? "radio tower" : "radio"}: ${n.range} tiles${n.linked ? "" : n.offline ? " (off the air)" : " (not linked)"}`; // a tower: radiotower.js (issue #54)

// Each ally's network as the map draws it: { faction, id, name, color, linked, nodes: [{ tile, range, kind, label }] }.
// kind: "station" at one of its bases, "relay" for a mast out on its land. Allies with no network are left out.
export function alliedRadioNetworks(state) {
  const out = [];
  for (const f of allianceMembers(state)) {
    const net = groupNetwork(state, f);
    if (!net) continue;
    const nodes = net.nodes.map((n) => {
      const kind = f.bases.includes(n.tile) ? "station" : "relay";
      return { tile: n.tile, range: n.range, kind, label: `${f.name} ${kind === "relay" ? "relay" : "radio"}: ${n.range} tiles` };
    });
    out.push({ faction: f, id: f.id, name: f.name, color: f.color || "#aaaaaa", linked: canRadioGroup(state, f), nodes });
  }
  return out;
}

const best = (nodes) => nodes.reduce((m, n) => Math.max(m, n.range), 0);
const linkWord = (a) => (a.linked ? "linked: you talk by radio" : "no link to yours: word comes by envoy");

// The legend's lines: "Your radio: 12 tiles", "Allied: <Group> radio, 9 tiles (linked: …)". mine: null without a
// station or linked relay.
export function radioLegend(state) {
  const live = yourRadioRings(state).filter((n) => n.linked && !n.offline);
  const mine = live.length ? { range: best(live), count: live.length, text: `Your radio: ${best(live)} tiles${live.length > 1 ? ` (${live.length} stations and relays)` : ""}` } : null;
  const allies = alliedRadioNetworks(state).map((a) => ({ id: a.id, name: a.name, color: a.color, linked: a.linked, range: best(a.nodes), text: `Allied: ${a.name} radio, ${best(a.nodes)} tiles (${linkWord(a)})` }));
  return { mine, allies };
}
// The Layers box's tooltip for the Radio coverage line.
export function radioLegendTip(state) {
  const L = radioLegend(state);
  const lines = ["Rings round radios: how far they reach, in tiles.", L.mine ? L.mine.text : "Your radio: none on the air yet (build a radio station)."];
  for (const a of L.allies) lines.push(a.text);
  if (!L.allies.length) lines.push("Allies: coalition members' radios show here in their colour once they join.");
  lines.push("Groups outside the coalition are not shown.");
  return lines.join("\n");
}

// The tile tooltip's lines: whose radio covers this tile (yours first). [{ text, color }]
export function radioTipLines(state, tile) {
  const g = state.grid, out = [];
  const mine = yourRadioRings(state).filter((n) => n.linked && !n.offline && g.distance(n.tile, tile) <= n.range);
  if (mine.length) out.push({ text: `📻 Your radio: ${best(mine)} tiles (${mine.map((n) => n.base.name).join(", ")})`, color: RADIO_YOU_COLOR });
  for (const a of alliedRadioNetworks(state)) {
    const at = a.nodes.filter((n) => g.distance(n.tile, tile) <= n.range);
    if (at.length) out.push({ text: `📻 Allied: ${a.name} radio, ${best(at)} tiles (${a.linked ? "linked" : "no link: by envoy"})`, color: a.color });
  }
  return out;
}
