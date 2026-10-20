// Rounds in guns and magazines out of a fight, the short item tips and the row names (2026-10-10, user: "Starting guns
// and looted guns have a magazine inside them. The starting gun magazines were empty"; "too much detail when I hovered
// over the Hunting rifle"; "Add the word magazine to Gun Mags … '23 .308/7.62 NATO FMJ': is this loose rounds?";
// "Guns should show quickly how many rounds are in them"). sim/gunrounds.js, sim/itemnames.js, ui/itemlabels.js.
//   - a new run (normal, Hardcore, a picked start gun): every gun carried is loaded from the crew's starting rounds,
//     its spare magazines too, as far as the rounds go (2026-10-20: physically, every gun first, then a spare each in
//     turn; a spare short only when no round it takes is left); the gun's tip never says "magazine (empty)";
//   - out of a fight the badge counts what is in it (2026-10-20): a gun in the armory with rounds in the stores is
//     empty until it is reloaded (itemacts.js reloadGunAt: two pistols and 20 rounds, 15 and 5);
//   - a found gun has a believable few rounds in it (own dice: some empty, most part-loaded, never over its capacity),
//     a trader's has none; a gun on a body shows what is in it;
//   - the names: magazines say "magazine", rounds say "— loose" / "— box" / "— 2 boxes", the count is not in the name;
//   - the short tip: a few lines, the rounds in the mag, who carries it; the full one is kept for Shift.
// Usage: node tools/startmagtest.js
import { createWorld } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { carriedSpots, newItem } from "../src/sim/inventory.js";
import { gunRounds, roundsText, isRoundGun, gunCapacity, foundFill, FOUND, magazineText } from "../src/sim/gunrounds.js";
import { rowName, rowCount, supplyName, magName, withMagWord, roundsForm } from "../src/sim/itemnames.js";
import { gunRoundsLabel, itemShortTip, tipAttrs } from "../src/ui/itemlabels.js";
import { gunTipText } from "../src/ui/gunbuilder.js";
import { isMag } from "../src/sim/mags.js";
import { keyFor, roundOf, baseType } from "../src/sim/rounds.js";
import { reloadGunAt, loadUpAll } from "../src/sim/itemacts.js";
import { stackN } from "../src/sim/roundstack.js";
import { magTakes } from "../src/sim/mags.js";
import { rollSiteGuns, gunWares } from "../src/sim/gunfinds.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
// A new run as Start leaves it (main.js: itemacts.js loadUpAll out of what each carries, then the hub's stores or the
// team's supplies; createWorld alone loads from what each carries only, so the world's stock stays whole until then).
const world = (seed, extra = {}) => { const st = createWorld({ seed, factionCount: 5, ...extra }); loadUpAll(st); return st; };
// Every gun and magazine the crew carries: [{ s, item, loc, where, r }].
const crewKit = (st) => st.survivors.flatMap((s) => carriedSpots(s).filter((x) => isRoundGun(x.item) || isMag(x.item)).map((x) => ({ s, ...x, r: gunRounds(st, x.item, x.loc) })));

section("A new run: the guns are loaded from the starting rounds");
{
  let guns = 0, spares = 0;
  for (const seed of [1, 2, 3, 7, 42, 99, 123, 2024]) {
    const st = world(seed);
    const kit = crewKit(st);
    for (const x of kit.filter((k) => isRoundGun(k.item))) { guns++; check(x.r && x.r.n === x.r.cap && x.r.cap > 0, `seed ${seed}: ${x.s.name}'s ${x.item.name} is loaded (${roundsText(st, x.item, x.loc)})`); }
    for (const s of st.survivors) {
      const mags = kit.filter((k) => k.s === s && isMag(k.item));
      if (!mags.length) continue;
      spares += mags.length;
      // physical (2026-10-20): a spare short of full only when no round it takes is left on its holder or in the stores
      const left = (m) => { const cals = new Set(); for (const r of Object.keys(st.bases[0].stock)) { const x = roundOf(r); if (x && st.bases[0].stock[r] >= 1 && magTakes(m.item.key, x.cal)) cals.add(r); } for (const y of carriedSpots(s)) { const x = y.item && roundOf(y.item.key); if (x && y.item.dur >= 1 && magTakes(m.item.key, x.cal)) cals.add(y.item.key); } return [...cals]; };
      const typed = (m) => m.r.load !== baseType(m.r.cal); // a typed starting box (ammo.js starterLoad): a spare of its load is bounded by it (one kind a load, as in a fight)
      for (const m of mags) check(m.r.n === m.r.cap || left(m).length === 0 || (typed(m) && m.r.n > 0), `seed ${seed}: ${s.name}'s spare is full or nothing it takes is left (${m.r.n}/${m.r.cap} ${m.r.roundName}; left: ${left(m).join(", ") || "none"})`);
      check(mags.every((m) => m.r.n === stackN(m.item.stack)), `seed ${seed}: ${s.name}'s spares' badges are the rounds in them (${mags.map((m) => `${m.r.n}/${m.r.cap}`).join(" ")})`);
    }
    // every gun first, then the spares a magazine each in turn: no second spare loaded while someone's first of that calibre is empty
    const firsts = st.survivors.map((s) => kit.filter((k) => k.s === s && isMag(k.item))).filter((l) => l.length);
    for (const l of firsts) for (const o of firsts) if (o !== l && l.length > 1 && l[1].r.n > 0) check(!(o[0].r.n === 0 && o[0].item.key === l[1].item.key), `seed ${seed}: ${l[0].s.name}'s second spare has rounds while ${o[0].s.name}'s first is empty`);
    for (const x of kit.filter((k) => isRoundGun(k.item))) {
      const t = gunTipText(x.item);
      check(!/magazine \(empty\)/.test(t), `seed ${seed}: the ${x.item.name}'s tip names its magazine (${(/magazine \([^)]*\)?[^,;]*/.exec(t) || [""])[0]})`);
    }
  }
  check(guns >= 16 && spares >= 8, `guns and spares checked (${guns} guns, ${spares} spare magazines)`);
}

section("Hardcore and a picked start gun");
{
  let n = 0;
  for (const seed of [1, 3, 7, 42, 99, 4242]) {
    const st = world(seed, { mode: "hardcore", crewRoll: seed });
    // Hardcore grabs a gun with the rounds that came with it ("a 9mm pistol (9 rounds)"): loaded with all of them.
    const have = (key) => (st.parties || []).reduce((a, p) => a + Math.floor((p.supplies || {})[key] || 0) + Math.floor(((p.cargo && p.cargo.supplies) || {})[key] || 0), 0) + st.survivors.reduce((a, s) => a + carriedSpots(s).reduce((b, y) => b + (y.item.key === key ? Math.floor(y.item.dur || 0) : 0), 0), 0);
    for (const x of crewKit(st).filter((k) => isRoundGun(k.item))) { n++; const h0 = have(keyFor(x.r.cal, x.r.load)); check(x.r.n === Math.min(x.r.cap, x.r.n + h0) && x.r.n > 0, `hardcore ${seed}: ${x.item.name} loaded with what was grabbed (${x.r.n}/${x.r.cap}, ${h0} rounds left)`); } // (physical: the rounds went into it)
  }
  check(n >= 2, `Hardcore guns checked (${n})`);
  const a = world(42, { crew: [{ startGear: { slots: { weapon: "ar" }, carry: { pocket: ["mag_stanag_30", "mag_stanag_30"] } } }] });
  const ar = crewKit(a).filter((x) => x.s === a.survivors[0]);
  check(ar.length >= 3 && ar.every((x) => x.r.n === x.r.cap), `a picked assault rifle and its picked magazines are loaded (${ar.map((x) => `${x.item.key} ${x.r.n}/${x.r.cap}`).join(", ")})`);
  const h = world(42, { mode: "hardcore", crewRoll: 4242, crew: [{ startGear: { slots: { weapon: "huntrifle" } } }] });
  const hr = crewKit(h).find((x) => x.s === h.survivors[0] && isRoundGun(x.item));
  check(hr && hr.r.n === hr.r.cap, `Hardcore: a picked hunting rifle is loaded (${hr ? `${hr.r.n}/${hr.r.cap}` : "none"})`);
}

section("Rounds to hand are shared out; none: empty");
{
  const st = world(7);
  const base = st.bases[0];
  for (const k of Object.keys(base.stock)) if (k.startsWith("a_")) delete base.stock[k];
  base.stock.a_9mm_fmj = 20;
  base.armory.push(newItem("pistol", 1), newItem("pistol", 1), newItem("ar", 1));
  const i0 = base.armory.length - 3;
  const at = (d) => `armory:${base.id}:list:${i0 + d}`;
  const r0 = [0, 1, 2].map((d) => gunRounds(st, base.armory[i0 + d], at(d)));
  check(r0.every((x) => x.n === 0), `out of a fight a stored gun counts what is in it, not the stores (${r0.map((x) => `${x.n}/${x.cap}`).join(" ")})`);
  for (const d of [0, 1, 2]) reloadGunAt(st, at(d));
  const r = [0, 1, 2].map((d) => gunRounds(st, base.armory[i0 + d], at(d)));
  check(r[0].n + r[1].n === 20 - Math.max(0, 20 - r[0].cap - r[1].cap) && r[0].n === Math.min(20, r[0].cap) && !(base.stock.a_9mm_fmj >= 1), `two pistols reloaded from 20 rounds in the stores: ${r[0].n}/${r[0].cap} and ${r[1].n}/${r[1].cap}, the stores empty`);
  check(r[2].n === 0, `an assault rifle with no 5.56 in the stores is empty (${r[2].n}/${r[2].cap})`);
  const l = gunRoundsLabel(base.armory[i0 + 2], `armory:${base.id}:list:${i0 + 2}`, st);
  check(l && l.cls === "empty" && l.text === `0/${r[2].cap}` && /Empty/.test(l.tip), `its badge is red "0/${r[2].cap}" (${l && l.cls}: ${l && l.tip})`);
  base.stock.a_556_fmj = 100;
  check(gunRounds(st, base.armory[i0 + 2], at(2)).n === 0, "rounds in the stores: still empty until it is reloaded");
  reloadGunAt(st, at(2));
  check(gunRounds(st, base.armory[i0 + 2], at(2)).n === r[2].cap && base.stock.a_556_fmj === 100 - r[2].cap, `reloaded: full, out of the stores (${base.stock.a_556_fmj} left)`);
}

section("gunRoundsLabel(item): the item alone finds where it is");
{
  const st = world(1);
  const kit = crewKit(st);
  check(kit.length > 0 && kit.every((x) => { const a = gunRoundsLabel(x.item, null, st), b = gunRoundsLabel(x.item, x.loc, st); return a && b && a.text === b.text; }), `the same badge with or without the location (${kit.map((x) => gunRoundsLabel(x.item, null, st).text).join(" ")})`);
  const base = st.bases[0];
  base.armory.push(newItem("pistol", 1));
  const g = base.armory[base.armory.length - 1];
  base.stock.a_9mm_fmj = 40;
  check(gunRoundsLabel(g, null, st).n === 0, `a pistol in the armory, 9mm in the stores: empty until reloaded (${gunRoundsLabel(g, null, st).text})`);
  reloadGunAt(st, `armory:${base.id}:list:${base.armory.length - 1}`);
  check(gunRoundsLabel(g, null, st).n === 15, `reloaded from the stores: ${gunRoundsLabel(g, null, st).text}`);
  base.armory.pop();
  check(gunRoundsLabel(g, null, st).n === 15, "taken out of the armory (nowhere): what is in it, still 15");
}

section("Found guns: a believable few rounds");
{
  const caps = [], ns = [];
  let empty = 0, full = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const g = foundFill(newItem(i % 2 ? "pistol" : "ar", 1), "test", i);
    const cap = gunCapacity(g);
    if (!g.loaded) { empty++; continue; }
    caps.push(cap); ns.push(g.loaded.n);
    if (g.loaded.n >= cap) full++;
    if (!(g.loaded.n >= 1 && g.loaded.n <= cap)) check(false, `a found gun's rounds within 1..${cap} (${g.loaded.n})`);
  }
  const share = empty / N;
  check(Math.abs(share - FOUND.empty) < 0.08, `about ${Math.round(FOUND.empty * 100)}% found empty (${Math.round(share * 100)}%)`);
  const avg = ns.reduce((a, n, i) => a + n / caps[i], 0) / Math.max(1, ns.length);
  check(avg > 0.15 && avg < 0.6 && full < ns.length * 0.2, `mostly part-loaded: average ${Math.round(avg * 100)}% of a magazine, ${full} of ${ns.length} full`);
  const g = foundFill(newItem("pistol", 1), "again", 3), g2 = foundFill(newItem("pistol", 1), "again", 3);
  check(JSON.stringify(g.loaded || null) === JSON.stringify(g2.loaded || null), "the same dice give the same fill (no draw from the world's numbers)");
  const st = world(11);
  let finds = 0, filled = 0;
  for (const t of st.tiles.filter((x) => x.loc).slice(0, 400)) for (let h = 0; h < 40 && finds < 40; h++) {
    st.hour = h;
    for (const it of rollSiteGuns(st, t.id, 50, `t${h}`)) if (isRoundGun(it)) { finds++; if (it.loaded) filled++; }
  }
  check(finds >= 5 && filled > 0 && filled < finds, `guns found at sites: ${filled} of ${finds} with rounds in them`);
  let wares = 0, wl = 0;
  for (let d = 0; d < 400; d++) for (const it of gunWares(st, "traders", "Shop", d)) if (isRoundGun(it)) { wares++; if (it.loaded) wl++; }
  check(wl === 0, `a trader's guns are sold empty (${wares} checked)`);
  const body = foundFill(newItem("ar", 1), "body", 1);
  body.loaded = { n: 12, key: "a_556_fmj" };
  const r = gunRounds(st, body, "body:0:weapon");
  check(r.n === 12 && r.src === "in it", `a gun on a body shows what is in it (${r.n}/${r.cap}, ${r.src})`);
}

section("Row names");
{
  const loose = { key: "a_308_fmj", name: GEAR.a_308_fmj.name, quality: 1, dur: 23, loose: true };
  const box = { key: "a_308_fmj", name: GEAR.a_308_fmj.name, quality: 1, dur: 20 };
  const boxes = { key: "a_308_fmj", name: GEAR.a_308_fmj.name, quality: 1, dur: 60 };
  check(rowName(loose) === ".308 / 7.62 NATO FMJ — loose" && rowCount(loose) === "×23", `loose rounds: "${rowName(loose)}" ${rowCount(loose)}`);
  check(roundsForm(box) === "box" && rowName(boxes) === ".308 / 7.62 NATO FMJ — 3 boxes" && rowCount(boxes) === "×60", `boxed: "${rowName(box)}", "${rowName(boxes)}"`);
  check(!/\d+\s*\.308/.test(rowName(loose)) && !/^\d/.test(rowName(loose)), "the count is never in front of the name");
  check(supplyName("a_308_fmj") === ".308 / 7.62 NATO FMJ — loose" && supplyName("food") === GEAR.food ? true : supplyName("a_308_fmj").endsWith("— loose"), `the stores' rounds: "${supplyName("a_308_fmj")}"`);
  check(magName("mag_ak_75") === "AK drum magazine (75)" && magName("mag_m249_100") === "Belt box magazine (100)" && magName("mag_glock_15") === "9mm pistol magazine (15)", `magazines say magazine: ${magName("mag_ak_75")}, ${magName("mag_m249_100")}`);
  check(withMagWord("Drum") === "Drum magazine", "a name with no count gets the word at the end");
  const mag = newItem("mag_ak_75", 1);
  check(rowName(mag) === "AK drum magazine (75)" && rowCount(mag) === "", `a magazine's row: "${rowName(mag)}"`);
}

section("The short tip");
{
  const st = world(1);
  const s = st.survivors.find((x) => x.gear.weapon && isRoundGun(x.gear.weapon));
  const t = itemShortTip(s.gear.weapon, `s:${s.id}:weapon`, s, st);
  const lines = t.split("\n");
  check(lines.length <= 7 && lines.length >= 4, `a few lines (${lines.length}): ${JSON.stringify(t)}`);
  check(/\d+\/\d+ in mag/.test(t) && /condition \d+%/.test(t) && /kg/.test(t) && /Damage [▰▱]+/.test(t) && t.includes(`Carried by ${s.name}`), "rounds in the mag, condition, weight, stat bars, who carries it");
  check(/Shift/.test(t) && t.length < 400, `short (${t.length} characters) with the Shift hint`);
  const a = tipAttrs(t, "full text");
  check(a.includes("data-tip-full=\"full text\"") && a.includes("data-tip-pre"), "the full text rides along for Shift");
  check(magazineText(s.gear.weapon) && !/empty/i.test(magazineText(s.gear.weapon)), `the magazine in words: ${magazineText(s.gear.weapon)}`);
  const vest = newItem("vest", 1);
  if (GEAR.vest) check(!/in mag/.test(itemShortTip(vest, null, null, st)), "armour has no rounds line");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
