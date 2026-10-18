// Every item icon on one page (ui/itemart.js), family by family: big (3×) and at the inventory's size, with the key
// and name. Served by `node server.cjs`: http://localhost:5173/tools/itemartpreview.html (?family=food for one family).
// Screenshot: NODE_PATH=$(npm root -g) node tools/itemartshot.cjs [family] [out.png]
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { FAMILIES, itemArtURL } from "../src/ui/itemart.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const only = new URLSearchParams(location.search).get("family");
let html = "";
for (const [name, f] of Object.entries(FAMILIES)) {
  if (only && only !== name) continue;
  for (const [kind, t, src] of [["gear", f.GEAR_ART || {}, GEAR], ["supply", f.SUPPLY_ART || {}, SUPPLIES]]) {
    const keys = Object.keys(t);
    if (!keys.length) continue;
    html += `<h2>${name} · ${kind} (${keys.length})</h2><div class="grid">`;
    for (const k of keys) {
      const u = itemArtURL(k, kind);
      html += `<div class="cell${u ? "" : " miss"}">${u ? `<img src="${u}" alt="">` : "<div style='height:54px'>none</div>"}<div>${u ? `<img class="sm" src="${u}" alt="">` : ""}</div><div class="n">${esc(src[k] ? src[k].name : "?")}</div><div class="k">${esc(k)}</div></div>`;
    }
    html += "</div>";
  }
}
document.getElementById("out").innerHTML = html || "No drawings yet.";
document.body.dataset.ready = "1";
