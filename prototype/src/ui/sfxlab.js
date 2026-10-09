// The sound test for guns and blasts (Settings → Sound, under "Hear"): audition every gun voice in each fire mode,
// suppressed or on subsonic rounds, near, far or out of sight, in each kind of place; the handling (reload, jam,
// unjam, a dry click, the slide locking back, brass); every blast and the grenade, Molotov, rocket and 40 mm
// sequences; and the old sound next to the new one. ui/audio.js wires it (LAB.ctx, LAB.old) and puts labHtml() in
// the Sound section. Also the offline renderer the WAV previews use (tools/sfxpreview.cjs): labRender.
//
// Panel structure (rows of the Sound section, each a .setrow): "Gun sounds" (gun, mode, suppressed, subsonic, ▶ Fire,
// ▶ Old then new), "Where" (distance, place, side), "Handling" (sound, ▶ Play, brass on/off), "Blasts and grenades"
// (kind or sequence, ▶ Play). A zombie list (ui/zombiesfx.js) can sit beside it as another .setrow block.
import { LAB_GUNS, labPlan, place, playGun, playHand, ROOMS, BRASS, gunVoice, installBus, roundGap, GUNVOL, setGunVolume } from "./gunsfx.js";
import { LAB_BLASTS, playBlast, flight, THROW_FLIGHT, FUSE } from "./blastsfx.js";
import { weaponSound } from "./soundcues.js";
import { WEAPONS } from "../sim/combat.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

export const LAB = {
  gun: "ar", mode: "auto", sup: false, sub: false, dist: "near", room: "field", pan: "centre", hand: "reload", blast: "seq:frag",
  ctx: null, // () => a running AudioContext with the battle bus (ui/audio.js), or null
  old: null, // (name) => plays an old sound by name (ui/audio.js sfx)
};
export const LAB_DISTS = { near: ["Near (2 tiles)", 2, true], mid: ["Mid (12 tiles)", 12, true], far: ["Far (30 tiles)", 30, true], hidden: ["Unseen enemy (12, out of sight)", 12, false] };
export const LAB_PANS = { left: ["Left", -0.7], centre: ["Centre", 0], right: ["Right", 0.7] };
export const LAB_HANDS = { reload: "Reload (this gun)", reloadEmpty: "Reload from empty", jam: "Jam (dull clack)", unjam: "Unjam (tap, rack)", dry: "Dry fire (click)", empty: "Last round (slide locks)", brass: "Brass tinkle" };
export const LAB_SEQS = { "seq:frag": "Grenade thrown: pin, spoon, clatter, blast", "seq:flash": "Flashbang thrown", "seq:smoke": "Smoke grenade thrown", "seq:molotov": "Molotov thrown: smash, whoomph, fire", "seq:flare": "Road flare thrown", "seq:pipebomb": "Pipe bomb thrown (fuse)", "seq:gl40": "40 mm launched: thoonk, flight, impact", "seq:rocket": "Rocket: launch, backblast, flight, impact", "seq:fight": "Grenade fight (6 s)" };
export function labPlace(o = LAB) {
  const [, dist, seen] = LAB_DISTS[o.dist] || LAB_DISTS.near;
  return place({ pan: (LAB_PANS[o.pan] || LAB_PANS.centre)[1], dist, seen, room: ROOMS[o.room] ? o.room : "field" });
}
const modesOf = (key) => { const w = WEAPONS[key] || {}; return w.modes ? Object.keys(w.modes) : key === "turret_m2" ? ["single", "burst", "auto"] : ["single"]; };

// ---------- playing ----------
export function labGun(c, t, o = LAB) {
  const mode = modesOf(o.gun).includes(o.mode) ? o.mode : "single";
  return playGun(c, t, labPlan(o.gun, mode, o.sup, o.sub), labPlace(o));
}
export function labHand(c, t, o = LAB) {
  const row = gunVoice(o.gun), sp = labPlace(o);
  const w = WEAPONS[o.gun] || {};
  if (o.hand === "reload" || o.hand === "reloadEmpty") return playHand(c, t, { kind: "reload", rel: row.rel, n: Math.min(w.cap || 5, row.rel === "break" ? 2 : 4), empty: o.hand === "reloadEmpty" }, sp);
  if (o.hand === "brass") return playHand(c, t, { kind: "brass", brass: row.brass || "brassR", gain: 2.2 }, sp);
  return playHand(c, t, { kind: o.hand }, sp);
}
// A throw: the pin (at the thrower, near), the flight, the clatter, the fuse, the blast (where it lands, a bit further).
function throwSeq(c, t, kind, o) {
  const near = labPlace({ ...o, dist: "near" }), sp = labPlace(o);
  const pre = { frag: "pin", flash: "pin", smoke: "pin", pipebomb: "fuse", molotov: "light", flare: "strike" }[kind];
  if (pre) playHand(c, t, { kind: "throw", h: pre, gain: 1.4 }, near);
  const land = t + THROW_FLIGHT + (pre === "pin" ? 0.25 : 0), fuse = FUSE[kind] || 0;
  if (["frag", "flash", "smoke", "pipebomb"].includes(kind)) playHand(c, land, { kind: "clatter", gain: 1.6 }, sp);
  return land - t + playBlast(c, land + fuse, { kind }, sp);
}
export function labBlast(c, t, o = LAB) {
  const sp = labPlace(o);
  const what = o.blast;
  if (what === "seq:gl40" || what === "seq:rocket") {
    const rocket = what === "seq:rocket";
    playGun(c, t, labPlan(rocket ? "rpg" : "m79"), labPlace({ ...o, dist: "near" }));
    const fl = flight(rocket ? "rocket" : "gl", 14);
    return fl + playBlast(c, t + fl, { kind: rocket ? "rocket" : "gl40" }, sp);
  }
  if (what === "seq:fight") return grenadeFight(c, t, o);
  if (what && what.startsWith("seq:")) return throwSeq(c, t, what.slice(4), o);
  return playBlast(c, t, { kind: what }, sp);
}
// Six seconds of a grenade fight: rifles trading, a frag each way, a 40 mm, a Molotov, a rocket into a car at the end.
export function grenadeFight(c, t, o = LAB) {
  const P = (dist, pan, seen = true) => place({ dist, pan, seen, room: o.room || "town" });
  const shots = [[0, "ar", "burst", 4, -0.4], [0.5, "ak", "auto", 14, 0.5], [1.2, "carbine", "single", 3, -0.2], [2.4, "lmg", "auto", 18, 0.7], [3.1, "pistol", "single", 2, -0.6], [4.2, "ak", "burst", 12, 0.4], [5.0, "ar", "auto", 5, -0.3]];
  for (const [at, k, m, d, pan] of shots) playGun(c, t + at, labPlan(k, m), P(d, pan, d < 15));
  throwSeq(c, t + 0.7, "frag", { ...o, dist: "mid", pan: "right" });
  playHand(c, t + 1.8, { kind: "throw", h: "pin", gain: 1.4 }, P(2, -0.2));
  playBlast(c, t + 2.6, { kind: "frag" }, P(3, -0.5)); // one landing close: the ducking
  playGun(c, t + 3.3, labPlan("m79"), P(14, 0.6));
  playBlast(c, t + 3.3 + flight("gl", 10), { kind: "gl40" }, P(6, 0.1));
  throwSeq(c, t + 3.8, "molotov", { ...o, dist: "mid", pan: "left" });
  playGun(c, t + 4.6, labPlan("rpg"), P(16, 0.8));
  playBlast(c, t + 4.6 + flight("rocket", 14), { kind: "vehicle", glass: true }, P(10, -0.1));
  return 6;
}
export function labGunHtml() {
  const L = LAB;
  const sel = (k, opts, t) => `<select data-action="lab-set" data-k="${k}"${tip(t)}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(L[k]) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const box = (k, label, t, on = L[k]) => `<button class="setopt ${on ? "active" : ""}" data-action="lab-opt" data-k="${k}"${tip(t)}>${on ? "✔" : "✗"} ${label}</button>`;
  const modes = modesOf(L.gun).map((m) => [m, m === "single" ? "Single" : m === "burst" ? `Burst (${roundsOf(L.gun, m)})` : `Full auto (${roundsOf(L.gun, m)} at ${Math.round(60 / roundGap(L.gun))} rpm)`]);
  const play = (what, label, t) => `<button data-action="lab-play" data-what="${what}"${tip(t)}>▶ ${label}</button>`;
  return `<h3>Gun and blast sounds</h3>
    <div class="setrow"><label>Gun ${sel("gun", LAB_GUNS)}</label> <label>Mode ${sel("mode", modes, "Single shot, burst or full auto: the real number of rounds at the gun's rate of fire")}</label>
      ${box("sup", "Suppressed", "A suppressor on the gun (none fits a revolver or a launcher)")} ${box("sub", "Subsonic rounds", "No supersonic crack (the .45 is always subsonic)")}
      ${play("gun", "Fire", "Play this gun as set")} ${play("old", "Old, then new", "The old sound for this gun's class, then the new one")}</div>
    <div class="setrow"><label>Where ${sel("dist", Object.entries(LAB_DISTS).map(([k, v]) => [k, v[0]]), "How far from the listener (the selected unit, or the middle of the screen); out of sight is muffled")}</label>
      <label>Place ${sel("room", Object.entries(ROOMS).map(([k, v]) => [k, v.label]), "The reverb: a tight room indoors, a slapback in town, a soft long tail in forest and over fields")}</label>
      <label>Side ${sel("pan", Object.entries(LAB_PANS).map(([k, v]) => [k, v[0]]))}</label></div>
    <div class="setrow"><label>Handling ${sel("hand", Object.entries(LAB_HANDS))}</label> ${play("hand", "Play", "The handling for the gun picked above")}
      ${box("brass", "Brass tinkle after shots", "The empty cases tinkling down near the shooter, now and then", BRASS.on)}</div>
    <div class="setrow"><label>Blasts ${sel("blast", [...Object.entries(LAB_SEQS), ...LAB_BLASTS])}</label> ${play("blast", "Play", "A blast (where set above), or a whole throw or launch")}</div>`;
}
const roundsOf = (key, m) => { const w = WEAPONS[key] || {}; return w.modes && w.modes[m] ? w.modes[m].rounds : key === "turret_m2" ? (m === "burst" ? 3 : 12) : 1; };
function labGo(what) {
  const c = LAB.ctx ? LAB.ctx() : null;
  if (!c) return;
  const t = c.currentTime + 0.05;
  try {
    if (what === "gun") labGun(c, t);
    else if (what === "hand") labHand(c, t);
    else if (what === "blast") labBlast(c, t);
    else if (what === "old") {
      if (LAB.old) LAB.old(LAB.sup && WEAPONS[LAB.gun] && WEAPONS[LAB.gun].noise ? "suppressed" : weaponSound(LAB.gun));
      labGun(c, t + 1.4);
    }
  } catch (e) { console.warn("Broken State: the sound test failed", e); }
}
export const LAB_ACTIONS = {
  "lab-play": (state, ui, d) => labGo(d.what),
  "lab-opt": (state, ui, d) => { if (d.k === "brass") BRASS.on = !BRASS.on; else if (d.k === "sup" || d.k === "sub") LAB[d.k] = !LAB[d.k]; },
};
export const LAB_CHANGE = {
  "lab-set": (state, ui, el) => {
    const k = el.dataset.k;
    if (!["gun", "mode", "dist", "room", "pan", "hand", "blast"].includes(k)) return;
    LAB[k] = el.value;
    if (k === "gun" && !modesOf(LAB.gun).includes(LAB.mode)) LAB.mode = modesOf(LAB.gun).includes("auto") ? "auto" : "single";
  },
};

// ---------- offline renders (the WAV previews, the browser checks) ----------
// The game's chain for the effects at the default sliders: the effects gain, (the new limiter), the master gain, the
// master compressor; then `makeup` for listening (the same for old and new, so their levels compare).
export const GAME_LEVELS = { sfx: 0.8 * 0.8 * 0.8, master: 0.7 * 0.7 }; // the default sliders (ui/audio.js: squared, the effects trim 0.8)
export const MAX_LEVELS = { sfx: 1 * 1 * 0.8, master: 1 }; // both sliders at 100%
export function makeLimiter(c) {
  const l = c.createDynamicsCompressor();
  l.threshold.value = -8; l.knee.value = 3; l.ratio.value = 16; l.attack.value = 0.001; l.release.value = 0.12;
  return l;
}
export function makeMasterComp(c) {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  return comp;
}
// fn(ctx, t, sfxNode): play into the chain (the new voices find the battle bus on the context). Returns { L, R, sr }.
export async function labRender(fn, secs, o = {}) {
  const OAC = typeof window !== "undefined" && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return null;
  // A compressor starts with its gain reduction wound right down (Chrome: about 20 dB, released over a second), which a
  // running game never hears: PRE s of silence first let it settle, then they are cut off the result.
  const PRE = o.pre ?? 1.5;
  const sr = o.sr || 48000, c = new OAC(2, Math.ceil(sr * (secs + PRE)), sr);
  const lv = o.max ? MAX_LEVELS : GAME_LEVELS;
  const sfx = c.createGain(); sfx.gain.value = lv.sfx;
  const master = c.createGain(); master.gain.value = lv.master;
  const comp = makeMasterComp(c), mk = c.createGain(); mk.gain.value = o.makeup ?? 4;
  let lim = null;
  if (o.limiter !== false) { lim = makeLimiter(c); sfx.connect(lim); lim.connect(master); } else sfx.connect(master);
  master.connect(comp); comp.connect(mk); mk.connect(c.destination);
  installBus(c, sfx);
  const keep = GUNVOL.v;
  if (o.gunVol != null) setGunVolume(o.gunVol); // the Gunfire slider (squared: 150% is 2.25)
  try { fn(c, PRE + 0.05, sfx); } finally { setGunVolume(keep); }
  // o.meter: the limiter's and the master compressor's gain reduction (dB), sampled every 10 ms while it renders
  const meter = { lim: [], comp: [] };
  if (o.meter && c.suspend) {
    for (let t = PRE + 0.01; t < PRE + secs - 0.01; t += 0.01) {
      c.suspend(t).then(() => { if (lim) meter.lim.push(-lim.reduction); meter.comp.push(-comp.reduction); c.resume(); });
    }
  }
  const buf = await c.startRendering();
  const sum = (a) => { const act = a.filter((x) => x > 0.1); return { max: Math.round(Math.max(0, ...a) * 10) / 10, mean: a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : 0, meanActive: act.length ? Math.round((act.reduce((s, x) => s + x, 0) / act.length) * 10) / 10 : 0, active: a.length ? Math.round((act.length / a.length) * 100) : 0 }; };
  const cut = Math.round(PRE * sr);
  return { L: buf.getChannelData(0).slice(cut), R: buf.getChannelData(1).slice(cut), sr, reduction: o.meter ? { limiter: sum(meter.lim), master: sum(meter.comp) } : null };
}
