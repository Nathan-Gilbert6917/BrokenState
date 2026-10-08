// Gun attachments (sights, muzzle devices, magazines, grips) fitted to a weapon item: item.mods = { mount: modItem }.
// An attachment is an ordinary item (data.js GEAR, cat "gunmod": looted, traded, carried in a pocket or the pack); fitted,
// it rides on the gun: it weighs and is worth what it is with the gun (inventory.js itemLoad, valuation.js itemValue),
// moves, is sold and is looted with it, and is saved with it (save.js writes the item as it is).
//
// Contract shared with the magazine / reload branch (keep the names): gunMods(item) -> what the item's fitted
// attachments add up to, neutral (NO_MODS) for a gun without any or anything that is not a gun:
//   aim: + to hit, close: + to hit within 2.5 tiles, opt: + best range (tiles), fall: + aim lost per tile beyond it,
//   dmg: × damage, cap: + rounds in the magazine, capMult: × magazine size, noise: × shot noise,
//   weight: + kg, value: + trade value (base values; the item's own worth is valuation.js itemValue).
// Magazine size (combat.js, the magazine branch) = round(WEAPONS[key].cap × capMult) + cap.
//
// Where the numbers act: combat.js shotOdds reads the unit's gm (playerUnit / refitUnit / enemyUnit set it: aim, close,
// opt, fall, dmg); stealth.js shotNoise multiplies a shot's noise by noise (battle earshot and alerts, raid Heat, the
// map's gunfire Heat through b.gunshots); hunting.js huntWeaponInfo takes the gun's noise × noise (a hunt's Heat, the
// base's hunting noise and the chance the wandering dead turn toward the shots).
//
// Mounts: one attachment each. optic (a sight), muzzle (suppressor, brake, compensator, choke), mag (a bigger
// magazine), under (a rail under the barrel: laser, foregrip or bipod; one of them).
//
// The numbers, against the weapon table (combat.js WEAPONS: a 9mm aims +4, the assault rifle +8; half cover is −20 and
// full cover −40, so no attachment is worth a step of cover; base aim is 40 + 2.5 a Shooting level, so +4 is what
// 1.6 levels of Shooting give):
//   attachment            mount   aim close opt  fall  dmg   cap  ×cap noise  kg    value  fits
//   Red dot sight         optic   +4                                          0.2   22     9mm, .357, pump shotgun, lever-action, carbine, assault rifle
//   Holographic sight     optic   +5  +3                                      0.35  35     pump shotgun, carbine, assault rifle
//   4× rifle scope        optic       −8   +3   −0.5                          0.6   40     lever-action, carbine, assault rifle (the hunting rifle has its own)
//   Laser sight           under   +1  +6                                      0.1   20     9mm, .357, pump shotgun, carbine, assault rifle
//   Vertical foregrip     under   +2  +2                                      0.15  12     pump shotgun, carbine, assault rifle
//   Bipod                 under       −5   +2   −0.5                          0.4   18     hunting rifle, lever-action, assault rifle
//   9mm suppressor        muzzle           −1         ×0.95           ×0.35   0.25  45     9mm
//   Rifle suppressor      muzzle           −1         ×0.95           ×0.4    0.55  60     hunting rifle, lever-action, carbine, assault rifle
//   Oil-filter suppressor muzzle                                      ×0.5    0.4   12     9mm and the four rifles; wears out in 12 shots
//   Muzzle brake          muzzle  +3                                  ×1.3    0.15  18     hunting rifle, lever-action, carbine, assault rifle (louder)
//   Pistol compensator    muzzle  +2                                  ×1.15   0.1   14     9mm, .357 (louder)
//   Shotgun choke         muzzle      −4   +2   −2                            0.05  12     pump shotgun (tighter spread: reaches further, less up close)
//   Extended pistol mag   mag                              +9                 0.15  14     9mm (15 → 24 rounds)
//   Drum magazine         mag     −2                             ×2           1.1   38     carbine, assault rifle (30 → 60; heavy and clumsy)
//   Shotgun tube extension mag                             +2                 0.25  14     pump shotgun (6 → 8)
// No suppressor fits a revolver (the gas escapes at the cylinder) or a shotgun; the pipe shotgun, the bows and melee
// weapons take nothing. Fall never drops below FALL_MIN a tile. A shot's noise × noise: a suppressed rifle shot (noise 3)
// is 1.2, heard 15 × 0.4 = 6 tiles off in a raid (9 + 2 × noise, × the share) instead of 15; a brake makes it 3.9.
import { GEAR } from "./data.js";

export const NO_MODS = Object.freeze({ aim: 0, close: 0, opt: 0, fall: 0, dmg: 1, cap: 0, capMult: 1, noise: 1, weight: 0, value: 0 });
export const MOUNTS = ["optic", "muzzle", "mag", "under"];
export const MOUNT_NAMES = { optic: "Sight", muzzle: "Muzzle", mag: "Magazine", under: "Under the barrel" };
export const FALL_MIN = 0.5;

const PISTOL = ["pistol"], RIFLES = ["huntrifle", "leverrifle", "carbine", "ar"];
// Battle and noise numbers by GEAR key (the item itself, its name, weight, value and description: data.js GEAR).
// short: how it reads in a weapon's name ("9mm pistol (red dot, suppressor)").
export const ATTACH = {
  reddot:    { mount: "optic",  short: "red dot",      fits: ["pistol", "revolver", "shotgun", "leverrifle", "carbine", "ar"], aim: 4 },
  holo:      { mount: "optic",  short: "holo sight",   fits: ["shotgun", "carbine", "ar"], aim: 5, close: 3 },
  scope4x:   { mount: "optic",  short: "4× scope",     fits: ["leverrifle", "carbine", "ar"], opt: 3, fall: -0.5, close: -8 },
  laser:     { mount: "under",  short: "laser",        fits: ["pistol", "revolver", "shotgun", "carbine", "ar"], aim: 1, close: 6 },
  foregrip:  { mount: "under",  short: "foregrip",     fits: ["shotgun", "carbine", "ar"], aim: 2, close: 2 },
  bipod:     { mount: "under",  short: "bipod",        fits: ["huntrifle", "leverrifle", "ar"], opt: 2, fall: -0.5, close: -5 },
  pistolcan: { mount: "muzzle", short: "suppressor",   fits: PISTOL, opt: -1, dmg: 0.95, noise: 0.35 },
  riflecan:  { mount: "muzzle", short: "suppressor",   fits: RIFLES, opt: -1, dmg: 0.95, noise: 0.4 },
  suppressor:{ mount: "muzzle", short: "oil-filter suppressor", fits: ["pistol", ...RIFLES], noise: 0.5 }, // makeshift: GEAR dur = shots
  brake:     { mount: "muzzle", short: "muzzle brake", fits: RIFLES, aim: 3, noise: 1.3 },
  comp:      { mount: "muzzle", short: "compensator",  fits: ["pistol", "revolver"], aim: 2, noise: 1.15 },
  choke:     { mount: "muzzle", short: "choke",        fits: ["shotgun"], opt: 2, fall: -2, close: -4 },
  extmag:    { mount: "mag",    short: "extended mag", fits: PISTOL, cap: 9 },
  drum:      { mount: "mag",    short: "drum mag",     fits: ["carbine", "ar"], capMult: 2, aim: -2 },
  tubeext:   { mount: "mag",    short: "tube extension", fits: ["shotgun"], cap: 2 },
};
export const isGunmod = (key) => !!ATTACH[key];
export const modDef = (key) => ATTACH[key] || null;
// Does this gun (a WEAPONS / GEAR key) take any attachment at all?
export const takesMods = (gunKey) => Object.values(ATTACH).some((a) => a.fits.includes(gunKey));
// Attachments that fit a gun, by GEAR key.
export const modsFor = (gunKey) => Object.keys(ATTACH).filter((k) => ATTACH[k].fits.includes(gunKey));
const nameOf = (key) => (GEAR[key] ? GEAR[key].name : key);
const fitted = (item) => (item && item.mods ? MOUNTS.map((m) => item.mods[m]).filter((x) => x && ATTACH[x.key]) : []);
export const fittedMods = fitted;

// Why this attachment cannot go on this gun ("" when it can; whatever is on that mount now comes off).
export function modFitReason(gun, mod) {
  const a = mod && ATTACH[mod.key];
  if (!a) return `${mod ? mod.name : "That"} is not a gun attachment.`;
  if (!gun || !GEAR[gun.key]) return "No gun to fit it to.";
  if (!a.fits.includes(gun.key)) return `The ${mod.name} does not fit a ${GEAR[gun.key].name.toLowerCase()}${a.mount === "muzzle" && ["revolver", "shotgun"].includes(gun.key) && /suppressor/i.test(mod.name) ? " (no suppressor fits a revolver or a shotgun)" : ""}.`;
  return "";
}
// Fits mod to gun. { ok, why, old }: old = what came off that mount (null when it was free).
export function fitMod(gun, mod) {
  const why = modFitReason(gun, mod);
  if (why) return { ok: false, why, old: null };
  const mount = ATTACH[mod.key].mount;
  gun.mods = gun.mods || {};
  const old = gun.mods[mount] || null;
  gun.mods[mount] = mod;
  return { ok: true, why: "", old };
}
// Takes the attachment off a mount and returns it (null when there is none).
export function removeMod(gun, mount) {
  if (!gun || !gun.mods || !gun.mods[mount]) return null;
  const m = gun.mods[mount];
  delete gun.mods[mount];
  if (!Object.keys(gun.mods).length) delete gun.mods;
  return m;
}

// What the attachments on an item add up to (the contract above).
export function gunMods(item) {
  const list = fitted(item);
  if (!list.length) return NO_MODS;
  const out = { ...NO_MODS };
  for (const m of list) {
    const a = ATTACH[m.key];
    if (!a.fits.includes(item.key)) continue; // never on the wrong gun (a save edited by hand)
    out.aim += a.aim || 0; out.close += a.close || 0; out.opt += a.opt || 0; out.fall += a.fall || 0;
    out.dmg *= a.dmg ?? 1; out.cap += a.cap || 0; out.capMult *= a.capMult ?? 1; out.noise *= a.noise ?? 1;
    const d = GEAR[m.key];
    out.weight += d && Number.isFinite(d.weight) ? d.weight : 0;
    out.value += d ? d.value || 0 : 0;
  }
  return out;
}
// A battle unit's attachments (combat.js sets u.gm and u.gmWeapon): nothing when its weapon has changed since (a raider
// handed a better gun, floorfolk.js; a thrown-in weapon swap, thirdside.js).
export const unitMods = (u) => (u && u.gm && u.gmWeapon === u.weapon ? u.gm : NO_MODS);
// The effective best range and fall-off of a weapon with its attachments (combat.js shotOdds).
export const modRange = (w, m) => ({ opt: (w.opt || 0) + m.opt, fall: Math.max(Math.min(FALL_MIN, w.fall || 0), (w.fall || 0) + m.fall) });

// The fitted suppressor (the item that muffles the shot: a can or an oil filter), or null.
export const fittedSuppressor = (item) => fitted(item).find((m) => (ATTACH[m.key].noise ?? 1) < 1 && ATTACH[m.key].fits.includes(item.key)) || null;
// A shot's wear on a makeshift muzzle device (GEAR dur = shots): n shots off it. Returns the item when it is worn out
// (it is gone from the gun), else null.
export function wearMuzzle(item, n = 1) {
  const m = item && item.mods && item.mods.muzzle;
  if (!m || !GEAR[m.key] || !GEAR[m.key].dur || !(n > 0)) return null;
  m.dur = Math.max(0, (m.dur ?? GEAR[m.key].dur) - n);
  if (m.dur > 0) return null;
  removeMod(item, "muzzle");
  return m;
}

// "9mm pistol (red dot, suppressor)": the weapon's name with what is fitted to it.
export function modLabel(item) {
  if (!item) return "";
  const list = fitted(item);
  return list.length ? `${item.name} (${list.map((m) => ATTACH[m.key].short).join(", ")})` : item.name;
}
const sgn = (v, unit = "") => `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100) / 100}${unit}`;
// One attachment's effects in words ("+4 aim, −8 aim up close, +3 tiles best range").
export function attachText(key) {
  const a = ATTACH[key];
  if (!a) return "";
  const bits = [];
  if (a.aim) bits.push(`${sgn(a.aim)} aim`);
  if (a.close) bits.push(`${sgn(a.close)} aim within 2.5 tiles`);
  if (a.opt) bits.push(`${sgn(a.opt)} tile${Math.abs(a.opt) === 1 ? "" : "s"} best range`);
  if (a.fall) bits.push(`${sgn(a.fall)} aim lost a tile beyond it`);
  if (a.dmg && a.dmg !== 1) bits.push(`damage ×${a.dmg}`);
  if (a.cap) bits.push(`${sgn(a.cap)} rounds a magazine`);
  if (a.capMult && a.capMult !== 1) bits.push(`magazine ×${a.capMult}`);
  if (a.noise && a.noise !== 1) bits.push(a.noise < 1 ? `shots ${Math.round(a.noise * 100)}% as loud` : `shots ${Math.round((a.noise - 1) * 100)}% louder`);
  return bits.join(", ");
}
// The fit list in words ("9mm pistol, .357 revolver").
export const fitsText = (key) => (ATTACH[key] ? ATTACH[key].fits.map(nameOf).join(", ") : "");
// A gun's net attachment effects in words, or "" (the inventory tooltip).
export function modsText(item) {
  const list = fitted(item);
  if (!list.length) return "";
  const m = gunMods(item);
  const bits = [];
  if (m.aim) bits.push(`${sgn(m.aim)} aim`);
  if (m.close) bits.push(`${sgn(m.close)} aim up close`);
  if (m.opt) bits.push(`${sgn(m.opt)} best range`);
  if (m.fall) bits.push(`${sgn(m.fall)} fall-off a tile`);
  if (m.dmg !== 1) bits.push(`damage ×${Math.round(m.dmg * 100) / 100}`);
  if (m.cap) bits.push(`${sgn(m.cap)} rounds`);
  if (m.capMult !== 1) bits.push(`magazine ×${m.capMult}`);
  if (m.noise !== 1) bits.push(`noise ×${Math.round(m.noise * 100) / 100}`);
  const worn = list.filter((x) => GEAR[x.key] && GEAR[x.key].dur).map((x) => `${x.name}: ${x.dur ?? GEAR[x.key].dur} of ${GEAR[x.key].dur} shots left`);
  return `fitted: ${list.map((x) => x.name).join(", ")} (${bits.join(", ") || "no effect"}${worn.length ? `; ${worn.join("; ")}` : ""})`;
}

// ---------- enemies' guns ----------
// How often an enemy's gun carries an attachment, by its kit (combat.js KITS): [chance, candidates] per mount; only the
// candidates that fit the gun count (none fit: nothing there). Soldiers' rifles are well kept: half carry a sight, a
// quarter a suppressor; raiders and the rest now and then. Looted with the gun (inventory.js enemyBody).
// Soldiers: a red dot or a holo sight often (a 4× scope on some rifles), a proper suppressor now and then, a drum
// rarely. Guards (police): lasers and red dots, bigger magazines. Militia and fighters (hunters at heart): scopes and
// bipods on their rifles. Raiders, survivors and zealots: cheap or makeshift parts (a red dot, a compensator, an oil
// filter, a choke).
export const ENEMY_MODS = {
  soldiers: { optic: [0.55, ["reddot", "holo", "holo", "scope4x"]], muzzle: [0.25, ["riflecan", "pistolcan"]], under: [0.2, ["foregrip", "laser", "bipod"]], mag: [0.08, ["drum"]] },
  guards:   { optic: [0.1, ["reddot"]], under: [0.15, ["laser"]], mag: [0.08, ["extmag", "tubeext"]] },
  militia:  { optic: [0.15, ["scope4x", "scope4x", "reddot"]], under: [0.1, ["bipod"]] },
  fighters: { optic: [0.12, ["scope4x", "reddot"]], under: [0.06, ["bipod", "foregrip"]], mag: [0.05, ["extmag", "tubeext"]] },
  raiders:  { optic: [0.1, ["reddot"]], muzzle: [0.1, ["comp", "suppressor", "choke"]], mag: [0.08, ["extmag", "tubeext"]] },
  survivors: { optic: [0.05, ["reddot"]], muzzle: [0.04, ["suppressor", "comp", "choke"]], mag: [0.04, ["extmag"]] },
  zealots:  { muzzle: [0.05, ["choke"]] },
};
// A number in [0, 1) from any parts (no random numbers used up: the battle's dice stay as they were).
function h01(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const str = String(part);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ 0x9e3779b9, 16777619) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// A loose attachment item (inventory.js newItem's shape; kept here so this module needs nothing but data.js).
export function makeMod(key, quality = 1) {
  const d = GEAR[key];
  const it = { key, name: d.name, quality };
  if (d.dur) it.dur = d.dur;
  return it;
}
// The attachments an enemy's gun carries ({ mount: item } or null). seed / salt: anything that varies per unit and battle.
export function enemyMods(kit, weapon, seed, salt) {
  const tab = ENEMY_MODS[kit];
  if (!tab || !takesMods(weapon)) return null;
  let out = null;
  for (const mount of MOUNTS) {
    const row = tab[mount];
    if (!row) continue;
    const cands = row[1].filter((k) => ATTACH[k] && GEAR[k] && ATTACH[k].mount === mount && ATTACH[k].fits.includes(weapon));
    if (!cands.length || h01(seed, salt, kit, weapon, mount) >= row[0]) continue;
    const key = cands[Math.floor(h01(seed, salt, mount, "pick") * cands.length) % cands.length];
    const q = [0.6, 0.75, 0.9, 1][Math.floor(h01(seed, salt, mount, "q") * 4) % 4];
    const it = makeMod(key, q);
    if (it.dur) it.dur = Math.max(2, Math.round(it.dur * (0.4 + 0.6 * h01(seed, salt, mount, "dur"))));
    (out = out || {})[mount] = it;
  }
  return out;
}

// ---------- starting guns ----------
// The cheap parts a colonist's gun may come with at the start of a run (never a scope, a drum or a proper suppressor).
export const STARTER_MODS = ["suppressor", "reddot", "laser", "comp", "extmag", "choke", "tubeext", "foregrip"];
export const STARTER = { none: 0.3, two: 0.2 }; // 30% of guns come bare, 20% with two parts, the rest with one
// Fits 0–2 cheap parts that suit the gun, drawn by 1 / value (the cheapest most often). rng: the run's seeded
// generator; its position is read, never moved, so the rest of the world comes out exactly as before. Returns the
// parts fitted.
/** @param {any} rng @param {any} item @param {string | number} [salt] @returns {any[]} */
export function randomStarterMods(rng, item, salt = "") {
  if (!item || !takesMods(item.key)) return [];
  const seed = rng && Number.isFinite(rng.state) ? rng.state : 0;
  const r = h01(seed, salt, item.key, item.name, "starter");
  const n = r < STARTER.none ? 0 : r < STARTER.none + STARTER.two ? 2 : 1;
  const got = [];
  for (let i = 0; i < n; i++) {
    const cands = STARTER_MODS.filter((k) => ATTACH[k] && GEAR[k] && ATTACH[k].fits.includes(item.key) && !(item.mods && item.mods[ATTACH[k].mount]));
    if (!cands.length) break;
    const w = cands.map((k) => 1 / Math.max(1, GEAR[k].value));
    let x = h01(seed, salt, item.key, i, "pick") * w.reduce((a, b) => a + b, 0);
    let key = cands[cands.length - 1];
    for (let j = 0; j < cands.length; j++) { x -= w[j]; if (x < 0) { key = cands[j]; break; } }
    const mod = makeMod(key, [0.6, 0.75, 0.9][Math.floor(h01(seed, salt, i, "q") * 3) % 3]);
    if (mod.dur) mod.dur = Math.max(3, Math.round(mod.dur * (0.5 + 0.5 * h01(seed, salt, i, "dur"))));
    fitMod(item, mod);
    got.push(mod);
  }
  return got;
}

// ---------- fitting what lies around (the autopilot: autopilot.js equipFromArmory) ----------
// How much an attachment is worth on a gun for a fight: aim counts, up close half, range a little, a suppressor a
// good deal (quiet shots, less Heat), a brake's noise against it; magazines a little (the reload branch counts them).
export function modScore(key) {
  const a = ATTACH[key];
  if (!a) return 0;
  return (a.aim || 0) + 0.5 * (a.close || 0) + 0.8 * (a.opt || 0) - 2 * (a.fall || 0) - 20 * (1 - (a.dmg ?? 1))
    + 6 * (1 - (a.noise ?? 1)) + 0.25 * (a.cap || 0) + 3 * ((a.capMult ?? 1) - 1) + (GEAR[key] && GEAR[key].dur ? -1 : 0);
}
// Fits loose attachments from pool (an armory list) to the guns given (best first), one per free mount and only where
// it helps (modScore > 0). Takes what it fits out of pool. Returns [{ gun, mod }].
export function fitFromPool(pool, guns) {
  const out = [];
  for (const gun of guns) {
    if (!gun || !takesMods(gun.key)) continue;
    for (const mount of MOUNTS) {
      if (gun.mods && gun.mods[mount]) continue;
      let best = null;
      for (const it of pool) {
        const a = it && ATTACH[it.key];
        if (!a || a.mount !== mount || !a.fits.includes(gun.key) || modScore(it.key) <= 0) continue;
        if (!best || modScore(it.key) > modScore(best.key)) best = it;
      }
      if (!best) continue;
      pool.splice(pool.indexOf(best), 1);
      fitMod(gun, best);
      out.push({ gun, mod: best });
    }
  }
  return out;
}

// The Help topic (ui/help.js).
export const GUNMODS_HELP = `Sights, suppressors, muzzle brakes, bigger magazines, grips and bipods fit on guns: one on each mount
  (sight, muzzle, magazine, under the barrel). They are found where guns are kept (gun stores, police stations, the National
  Guard, hunting lodges and cabins, army wrecks, sports shelves in malls), on the guns of soldiers and now and then of
  raiders and other fighters (they come with the gun when you loot it), and traders and merchants sell them. In the
  inventory, select a gun: the bar below lists what is fitted (Remove puts it in the armory or the team's cargo, or on
  the person) and every loose attachment within reach that fits it (Fit). Select an attachment to fit it to the gun in
  that person's hands. A fitted attachment adds its weight and worth to the gun, and is sold or looted with it.
  <br>Sights: a red dot (+4 aim), a holographic sight (+5, +3 up close), a 4× scope (+3 tiles best range, less fall-off,
  −8 up close; the hunting rifle has its own), a laser (+6 up close). Muzzle: a suppressor makes a shot a third as loud
  (a rifle can 40%: fewer of the dead and the guards hear it, half the Heat or less, and a hunt draws less; a little less
  damage and range), the makeshift oil-filter suppressor halves the noise and wears out in 12 shots, a muzzle brake (+3 aim)
  and a pistol compensator (+2) make the shot louder, a shotgun choke reaches further but spreads less up close. No
  suppressor fits a revolver or a shotgun. Magazines: an extended 9mm magazine (24 rounds), a drum for the carbine and the
  assault rifle (twice the rounds, heavy, −2 aim), a shotgun tube extension (+2 shells). Under the barrel: a laser, a
  foregrip (+2 aim) or a bipod (rifles: +2 range, −5 up close). None is worth a step of cover.`;
