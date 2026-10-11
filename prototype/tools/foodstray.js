// Food types (foods.js) leak check: runs autopilot campaigns and reports any generic "food" / "preserved" keys that
// reached a stock (state.foodStray: typed by the safety net) and any left in a stock at the end, by where they are.
// Usage: node tools/foodstray.js [days=120] [style=balanced] [seeds...=1 2] [hardcore]
import { createWorld, tickHour } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { foodIn } from "../src/sim/foods.js";

const args = process.argv.slice(2);
const hard = args.includes("hardcore");
const rest = args.filter((a) => a !== "hardcore");
const days = Number(rest[0] || 120);
const style = rest[1] || "balanced";
const seeds = rest.length > 2 ? rest.slice(2).map(Number) : [1, 2];
let bad = 0;
for (const seed of seeds) {
  const state = createWorld({ seed, factionCount: 8, mode: hard ? "hardcore" : "normal" });
  state.started = true;
  setAutopilot(state, true, style);
  const where = {};
  const scan = () => {
    const look = (name, st) => { if (st && (("food" in st) || ("preserved" in st))) where[name] = (where[name] || 0) + 1; };
    for (const b of state.bases) look(`base ${b.name}`, b.stock);
    for (const p of state.parties) { look(`party ${p.kind}`, p.supplies); if (p.cargo) look(`cargo ${p.kind}`, p.cargo.supplies); if (p.goods) look(`goods ${p.kind}`, p.goods.supplies); }
    for (const f of state.factions) look(`group ${f.type}`, f.stock);
    for (const v of state.visitors || []) look(`visitor ${v.kind}`, v.stock);
  };
  let err = null;
  try {
    for (let h = 0; h < days * 24; h++) {
      tickHour(state);
      if (h % 24 === 23) scan();
      if (state.gameOver) break;
    }
  } catch (e) { err = e; }
  const hubFood = state.bases[0] ? Math.round(foodIn(state.bases[0].stock)) : 0;
  console.log(`seed ${seed}: day ${Math.floor(state.hour / 24)}, people ${state.survivors.filter((s) => s.alive).length}, hub food ${hubFood} days, stray ${Math.round(state.foodStray || 0)}${Object.keys(where).length ? `, generic keys seen: ${JSON.stringify(where)}` : ""}`);
  if (err) { console.log(err.stack); bad++; }
  if (state.foodStray > 0 || Object.keys(where).length) bad++;
}
process.exit(bad ? 1 : 0);
