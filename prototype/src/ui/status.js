// Status icons next to a survivor's name (sim/status.js has the states and every threshold): low mood, hungry or
// starving, thirsty or parched, low health, infected, sick. They stack, one per state, each with its tooltip.
// Only for people you are in touch with: the callers check contact.
import { statusesOf } from "../sim/status.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "" when nothing is wrong. opts.skip: state keys to leave out (sim/status.js statusesOf).
export function statusIcons(state, s, opts = {}) {
  const list = statusesOf(state, s, opts);
  if (!list.length) return "";
  return `<span class="st-icons">${list.map((x) => `<span class="st-ic ${x.tone}" data-st="${x.key}" data-tip="${esc(x.tip)}">${x.icon}</span>`).join("")}</span>`;
}
