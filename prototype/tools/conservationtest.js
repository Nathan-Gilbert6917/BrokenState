// The conservation test (docs/adr/0001-ai-parity.md): a campaign run (the autopilot plays your side) checking that the
// AI side (every other group with its outposts, its people and what they carry, its prisoners, its parties on the
// road, the visitors and nomad bands) never holds more rounds than it held the day before plus what the legitimate
// sources noted coming in that day (src/sim/ledger.js: scavenged, made at a bench, traded or taken from you, a group
// or band created with its holdings). Transfers between AI groups cancel out. Also: no item is in two places at once
// (a group's books hold an item only where one of its people carries it, or as its spare).
// Usage: node tools/conservationtest.js [seed] [days]
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { allCarried } from "../src/sim/inventory.js";
import { carriedRounds } from "../src/sim/loadouts.js";
import { isRoundItem } from "../src/sim/itemstack.js";
import { nomadsOf } from "../src/sim/nomads.js";
import { roundsIn } from "../src/sim/ledger.js";

const seed = Number(process.argv[2] || 7);
const DAYS = Number(process.argv[3] || 60);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };

// The rounds in an item: a box of loose rounds, what is loaded in a gun (gunload.js it.loaded), a magazine's stack.
const stackN = (st) => (Array.isArray(st) ? st.reduce((a, x) => a + (x.n || 0), 0) : 0);
// What is inside counts too: a pack's or a rig's contents (inventory.js item.contents), a gun's fitted parts.
const inItem = (it) => (!it || typeof it !== "object" ? 0 : (isRoundItem(it) ? Math.floor(Number(it.dur) || 0) : 0) + (it.loaded ? (Array.isArray(it.loaded.stack) ? stackN(it.loaded.stack) : it.loaded.n || 0) : 0) + stackN(it.stack)
  + (Array.isArray(it.contents) ? it.contents.reduce((a, x) => a + inItem(x), 0) : 0) + (it.mods ? Object.values(it.mods).reduce((a, x) => a + inItem(x), 0) : 0));
const itemRounds = (list) => (list || []).reduce((a, it) => a + inItem(it), 0);
// The AI side's rounds, by holder (a name for the report).
function holdings(state) {
  const out = new Map();
  const add = (k, n) => { if (n) out.set(k, (out.get(k) || 0) + n); };
  // Each stores record counted once (a party can carry the very record its group or band holds).
  const seen = new Set();
  const once = (rec) => { if (!rec || seen.has(rec)) return 0; seen.add(rec); return roundsIn(rec); };
  for (const f of state.factions || []) {
    const k = `group ${f.name} #${f.id}`;
    add(`${k}|stock`, once(f.stock));
    for (const h of Object.values(f.homes || {})) if (h && h.stock && h.stock !== f.stock) add(`${k}|stock`, once(h.stock));
    for (const s of f.people || []) if (s.alive !== false) add(`${k}|carried`, carriedRounds(s));
    for (const r of f.prisoners || []) if (r.s && r.s.alive !== false) add(`${k}|prisoners`, carriedRounds(r.s));
    add(`${k}|shelf`, itemRounds(f.wares));
    // Their spare kit (on the books, carried by nobody): rounds left in the guns and magazines.
    const held = new Set((f.people || []).filter((p) => p.alive !== false).flatMap((p) => allCarried(p)));
    add(`${k}|spare`, itemRounds(((f.arsenal && f.arsenal.items) || []).filter((it) => !held.has(it))));
  }
  for (const p of state.parties || []) {
    if (p.owner === "player") continue;
    const k = `party of ${p.owner}`;
    if (p.goods) { add(k, once(p.goods.supplies)); add(k, itemRounds(p.goods.gear)); }
    if (p.scav) add(k, once(p.scav.got));
    if (p.cargo) { add(k, once(p.cargo.supplies)); add(k, itemRounds(p.cargo.gear)); }
  }
  for (const v of state.visitors || []) { const k = `visitors ${v.name} #${v.id ?? v.serial}`; add(`${k}|stock`, once(v.stock)); add(`${k}|shelf`, itemRounds(v.wares)); for (const s of v.people || []) if (s && s.alive !== false) add(`${k}|carried`, carriedRounds(s)); }
  // Wandering groups met on the road (wanderers.js): people with what they carry, who may join a group.
  for (const g of (state.wanderers && state.wanderers.groups) || []) for (const s of g.people || []) if (s && s.alive !== false) add(`wanderers #${g.wid}|carried`, carriedRounds(s));
  for (const b of nomadsOf(state)) { const k = `nomads ${b.name} #${b.id ?? b.serial ?? ""}`; add(`${k}|stock`, once(b.stock)); add(`${k}|shelf`, itemRounds(b.wares)); for (const s of b.people || []) if (s && s.alive !== false) add(`${k}|carried`, carriedRounds(s)); }
  return out;
}
const sum = (m) => [...m.values()].reduce((a, n) => a + n, 0);

// Every item in one place at most: a person carries it, or it lies in one list; a group's book entry is carried by one
// of its own people or is spare.
function duplicates(state) {
  const where = new Map();
  const dup = [];
  const put = (it, tag) => { if (!it || typeof it !== "object") return; const was = where.get(it); if (was && was !== tag) dup.push(`${it.name || it.key}: ${was} and ${tag}`); else where.set(it, tag); };
  const people = [];
  for (const s of state.survivors || []) if (s.alive !== false) people.push([s, `your ${s.name}`]);
  for (const f of state.factions || []) for (const s of f.people || []) if (s.alive !== false) people.push([s, `${f.name}'s ${s.name}`]);
  for (const [s, tag] of people) for (const it of allCarried(s)) put(it, tag);
  for (const b of state.bases || []) for (const it of b.armory || []) put(it, `${b.name}'s armory`);
  for (const f of state.factions || []) for (const it of f.wares || []) put(it, `${f.name}'s shelf`);
  for (const p of state.parties || []) for (const it of (p.cargo && p.cargo.gear) || []) put(it, `party ${p.id}'s cargo`);
  for (const f of state.factions || []) {
    const mine = new Set((f.people || []).filter((s) => s.alive !== false));
    for (const it of (f.arsenal && f.arsenal.items) || []) {
      const at = where.get(it);
      if (!at) continue; // spare at home
      const by = (f.people || []).find((s) => s.alive !== false && allCarried(s).includes(it));
      if (!by || !mine.has(by)) dup.push(`${it.name || it.key}: on ${f.name}'s books, but at ${at}`);
    }
  }
  return dup;
}

console.log(`Conservation: seed ${seed}, ${DAYS} days, the autopilot playing your side`);
const st = createWorld({ seed, factionCount: 6 });
setAutopilot(st, true);
st.ledgerOn = true;
st.ledger = { total: 0, by: {} };
let prev = holdings(st), prevLedger = 0, worst = 0, worstDay = null, bad = 0;
const lines = [];
let dupFirst = null;
// TRACE=day1,day2: the writers of rounds into the AI side's stores on those days (a debugging aid).
const TRACE = new Set(String(process.env.TRACE || "").split(",").filter(Boolean).map(Number));
const INTERNAL = /collectRounds|armRounds|gatherStores|spreadStores|settleRec|settleGroup/;
function traced(on) {
  const sig = new Map();
  if (!on) return sig;
  const wrap = (holder, key, tag) => {
    const o = holder[key];
    if (!o || o.__w) return;
    holder[key] = new Proxy(o, { get: (t, k) => (k === "__w" ? true : t[k]), set: (t, k, val) => {
      if ((/^a_/.test(k) || k === "ammo") && typeof val === "number" && val > (t[k] || 0)) {
        const stack = new Error().stack.split("\n").slice(2, 6).map((x) => x.trim().replace(/\(file:.*\/(src|tools)\//, "(").replace(/\)$/, ""));
        if (!stack.some((x) => INTERNAL.test(x))) { const k2 = `${tag}: ${stack.slice(0, 3).join(" < ")}`; sig.set(k2, (sig.get(k2) || 0) + val - (t[k] || 0)); }
      }
      t[k] = val; return true;
    } });
  };
  sig.wrapAll = () => {
    for (const f of st.factions) { wrap(f, "stock", f.name); for (const h of Object.values(f.homes || {})) { if (h && h.type === "hub") h.stock = f.stock; else if (h && h.stock) wrap(h, "stock", f.name); } }
    for (const v of st.visitors || []) wrap(v, "stock", v.name);
    for (const b of nomadsOf(st)) wrap(b, "stock", b.name);
  };
  return sig;
}
for (let d = 0; d < DAYS; d++) {
  const sig = traced(TRACE.has(day(st) + 1));
  // Checked every hour: a holder that appears brings its holdings as they are when it appears (a caravan that arrives
  // and sells to a group the same day: its arrival stock is its creation seed, the sale a transfer).
  let dayBad = false;
  for (let h = 0; h < 24; h++) {
    if (sig.wrapAll) sig.wrapAll();
    tickHour(st);
    const now = holdings(st);
    // A holder seen for the first time (a group, band or visitor just made) brings its holdings: its creation seed.
    let born = 0;
    const owners = (m) => new Set([...m.keys()].map((k) => k.split("|")[0]));
    const was = owners(prev);
    for (const [k, n] of now) if (!was.has(k.split("|")[0]) && !/^party of/.test(k)) born += n;
    const grew = sum(now) - sum(prev), allowed = st.ledger.total - prevLedger + born;
    const excess = grew - allowed;
    if (excess > 0.5) {
      if (!dayBad) bad++;
      dayBad = true;
      if (excess > worst) { worst = excess; worstDay = day(st); }
      if (lines.length < 12) {
        const gains = [...now.entries()].map(([k, n]) => [k, n - (prev.get(k) || 0)]).filter(([, g]) => g > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 4);
        lines.push(`day ${day(st)}, hour ${st.hour % 24}: +${Math.round(grew)} held, ${Math.round(allowed)} noted: ${gains.map(([k, g]) => `${k} +${Math.round(g)}`).join(", ")}`);
      }
    }
    prev = now;
    prevLedger = st.ledger.total;
  }
  if (sig.size) { console.log(`    trace, day ${day(st)}:`); for (const [k, n] of [...sig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`      +${Math.round(n)} ${k}`); }
  if (!dupFirst) { const dups = duplicates(st); if (dups.length) dupFirst = `day ${day(st)}: ${dups.slice(0, 3).join("; ")}`; }
}
for (const l of lines) console.log(`    ${l}`);
console.log(`    noted sources: ${Object.entries(st.ledger.by).map(([k, n]) => `${k} ${Math.round(n)}`).join(", ") || "none"}`);
check(bad === 0, `the AI side never holds more rounds than came in (${bad} day${bad === 1 ? "" : "s"} over${worstDay != null ? `, the worst +${Math.round(worst)} on day ${worstDay}` : ""})`);
check(!dupFirst, `no item in two places at once${dupFirst ? ` (${dupFirst})` : ""}`);
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
