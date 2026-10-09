// Combat barks: short speech bubbles over the units' heads in a battle ("Reloading!", "I'm hit!", "Man down!").
// Read-only on the battle: each frame ui/combat.js drawCombat hands over the battle, and this module compares the
// units with what they were last frame and reads the new b.fx events (shots, throws, heals by seq). What changed
// becomes a trigger, a trigger a line (picked by a hash of the event's seq, the unit and the trigger: never the world's
// RNG or the battle's dice), and a line a bubble that follows the unit's animated position for about 1.8 s.
//
//   barkFrame(ctx, state, b, now, V)   ui/combat.js, every frame of a battle: detect, emit, draw
//   detectBarks(state, b, visible)    the triggers since the last call (tools/barkstest.js drives it directly)
//   emitBarks(list, now)              mode, chance, cooldown and the cap: the bubbles that start now
//   lineFor(trig, voice, key, vars)   the line (deterministic), voiceOf(state, u) whose voice it is
//   barkMode() / setBarkMode(m)       the Combat barks option: "on", "important" (man down, going down) or "off"
//
// Who speaks how: your people by trait (Brave: bold, Coward: nervous) and background (a veteran, cop, hunter or
// prepper terse; a teacher, office worker, student or nurse chatty); raiders taunt, soldiers talk like a radio,
// zealots preach, other fighters plain. The dead say nothing; a special one (sim/hiveconst.js ZTYPES) groans when
// first seen. An enemy barks only while your people see it (the same fog as the drawing).
import { active, hasMag, magIn, magEmpty, magShown, reloadRefusal } from "../sim/combat.js";
import { ZTYPES } from "../sim/hiveconst.js";
import { sfx } from "./audio.js";
import { barkShout } from "./humansfx.js"; // the shout in the speaker's own voice

export const BARK = {
  LIFE: 1800,          // ms a bubble shows
  FADE: 400,           // the last ms of it fading out
  COOL: 3000,          // ms before the same unit barks again (important ones skip it)
  MAX: 3,              // bubbles on screen at once
  CHANCE: 0.4,         // a routine trigger's chance
  MAXLEN: 24,          // characters a line may have (tools/barkstest.js)
};
// Always shown (Important only keeps just these): your own people going down and the shout that one of them is.
export const IMPORTANT = new Set(["goingdown", "mandown"]);
// Chances other than BARK.CHANCE (important ones are 1 on your side).
const CHANCE = { retreat: 0.9, special: 0.9, surrender: 0.7, outofammo: 0.6, jam: 0.5, revived: 0.6, groan: 0.5 };
// When one unit has several triggers in a frame, the highest speaks.
const PRIORITY = {
  goingdown: 100, mandown: 90, revived: 80, surrender: 75, retreat: 70, special: 65, crit: 60, hitbad: 55, lowhp: 50,
  kill_human: 45, kill_dead: 45, frag: 42, molotov: 41, flash: 40, smoke: 40, outofammo: 38, jam: 36, revive: 35,
  owshot: 30, suppress: 28, hit: 25, empty: 22, unjam: 20, reload: 18, watch: 12, hunker: 10, groan: 5,
};
export const TRIGGERS = Object.keys(PRIORITY);

// ---------- the lines ----------
// {n}: the downed teammate's first name; {Z} / {z}: a special dead's kind (capitalised / lower case).
// Pools: base (your people, anyone), bold, nervous (traits), terse, chatty (backgrounds); raider, radio (soldiers),
// zealot, enemy (other fighters); dead (the special dead: groans only).
export const LINES = {
  reload: {
    base: ["Reloading!", "Changing mags!", "Cover me, reloading!", "New mag in.", "Loading up!", "Mag change!", "Hold on, reloading!"],
    bold: ["Reloading. Stay put.", "Fresh mag. Who's next?", "Topping off!"],
    nervous: ["Come on, load...", "Reloading! Hurry!", "Hands shaking... in!"],
    terse: ["Reloading.", "Mag.", "Changing."],
    chatty: ["One sec, new mag!", "Reloading, cover me!"],
    raider: ["Hold on, loadin'!", "Reloadin'!"], radio: ["Reloading, cover.", "Mag change, cover!"],
    zealot: ["My faith is loaded.", "The fire is renewed."], enemy: ["Reloading!", "Cover me!"],
  },
  empty: {
    base: ["I'm empty!", "Mag's empty!", "Dry!", "Click! Empty!", "Out of rounds here!", "Empty! Need a sec!"],
    terse: ["Dry.", "Empty."], nervous: ["It's empty! Help!", "Nothing! It's empty!"], chatty: ["Uh, I'm out here!"],
    raider: ["I'm dry!"], radio: ["Weapon dry!"], zealot: ["My cup is empty!"], enemy: ["I'm empty!"],
  },
  outofammo: {
    base: ["Out of ammo!", "No more rounds!", "Last one gone!", "Anyone got ammo?!", "I've got nothing left!", "That was my last!"],
    terse: ["Winchester.", "Black on ammo."], chatty: ["I'm all out! Anyone?"], nervous: ["No ammo! What now?!"],
    bold: ["Out! Going hands-on!"], raider: ["Outta bullets!"], radio: ["Black on ammo!"], enemy: ["Out of ammo!"],
  },
  jam: {
    base: ["Jammed!", "Gun's jammed!", "Damn, it jammed!", "Stuck! It's stuck!", "Come on, come on!", "Malfunction!"],
    terse: ["Stoppage.", "Jam."], nervous: ["It won't fire!"], chatty: ["Oh no, it's jammed!"], bold: ["Jammed. Figures."],
    raider: ["Piece of junk!"], radio: ["Stoppage!"], zealot: ["A trial of faith!"], enemy: ["Jammed!"],
  },
  unjam: {
    base: ["Cleared it!", "Back in it!", "Gun's working!", "Fixed! Firing!", "There we go."],
    terse: ["Clear.", "Up."], chatty: ["Okay, got it working!"], radio: ["Stoppage cleared."], raider: ["Ha! Works again!"], enemy: ["Back up!"],
  },
  hit: {
    base: ["I'm hit!", "Ow! Damn!", "Took one!", "Argh!", "Just a graze!", "Ugh, that stings!", "I'm okay, I'm okay!"],
    bold: ["Is that all?", "Just a scratch!", "That all you got?"], nervous: ["They shot me!", "Oh God, I'm hit!"],
    terse: ["Hit. Still up.", "Grazed."], chatty: ["Ow! They hit me!"],
    raider: ["Argh! You'll pay!", "Lucky shot!"], radio: ["I'm hit!", "Taking fire!"], zealot: ["Pain is grace!", "I feel no pain!"], enemy: ["I'm hit!", "Argh!"],
  },
  hitbad: {
    base: ["I'm hit bad!", "That one hurt!", "Bleeding here!", "Need a medic!", "Hit hard!", "Ahh! My side!"],
    bold: ["Still standing!", "Keep fighting!"], nervous: ["I'm bleeding! Help!", "I don't wanna die!"],
    terse: ["Hit bad.", "Need a medic."], chatty: ["That's a lot of blood!"],
    raider: ["You'll pay for that!"], radio: ["Man hit! Need medic!"], zealot: ["I am tested!"], enemy: ["I'm hit bad!"],
  },
  crit: {
    base: ["Argh! Right through!", "That went deep!", "Ahh! My arm!", "My leg! My leg!", "Ugh! Direct hit!"],
    bold: ["Not... done yet!"], nervous: ["No no no no!"], terse: ["Bad one."], chatty: ["Oh God, that's bad!"],
    raider: ["Aagh! My gut!"], radio: ["Hit! Hit!"], zealot: ["Martyrdom calls!"], enemy: ["Aaagh!"],
  },
  goingdown: {
    base: ["I'm going down!", "Can't... stand...", "Help me...", "Tell them... I...", "I'm down!", "Ugh..."],
    bold: ["Get... them...", "Keep... fighting..."], nervous: ["Don't leave me!", "Please... help..."],
    terse: ["Down.", "I'm down."], chatty: ["Somebody... please..."],
    raider: ["Boss... help...", "Ugh... damn..."], radio: ["Man down... me...", "I'm down!"], zealot: ["I go... to Him..."], enemy: ["Ugh..."],
  },
  mandown: {
    base: ["Man down! {n}'s hit!", "{n}'s down!", "{n}! No!", "Get to {n}!", "We lost {n}! Help!", "Cover {n}!"],
    bold: ["Cover {n}! Go!", "I'll get {n}!"], nervous: ["They got {n}!", "{n}! Oh no!"],
    terse: ["{n} down.", "Man down."], chatty: ["Oh God, {n}'s hit!"],
    raider: ["They got one of us!", "Man down!"], radio: ["Man down! Man down!", "Casualty!"], zealot: ["A brother falls!", "He walks with God!"], enemy: ["Man down!"],
  },
  kill_dead: {
    base: ["Got one!", "Stay down!", "Dropped it!", "One less!", "Down it goes!", "Headshot!", "Got it!", "Rest now."],
    bold: ["Next!", "Who's next?"], nervous: ["Is it dead? Is it?", "It's down, right?"], terse: ["Tango down.", "Clear."], chatty: ["Got it! Did you see?"],
    raider: ["Ha! Deader!"], radio: ["Hostile down."], zealot: ["Return to dust!"], enemy: ["Got it!"],
  },
  kill_human: {
    base: ["Got him!", "Target down!", "He's down!", "Got one!", "One less!", "Sorry, friend."],
    bold: ["Who's next?", "Come on, then!"], nervous: ["Oh God... I got him."], terse: ["Target down.", "Down."], chatty: ["I... I got him."],
    raider: ["Ha! Got one!", "Another one!"], radio: ["Hostile down!", "Tango down!"], zealot: ["Judgement!"], enemy: ["Got one!"],
  },
  frag: {
    base: ["Frag out!", "Grenade!", "Fire in the hole!", "Get down!", "Catch!"], terse: ["Frag out."], bold: ["Eat this!"],
    raider: ["Catch this!"], radio: ["Frag out!"], zealot: ["Holy fire!"], enemy: ["Grenade!"],
  },
  molotov: {
    base: ["Burn!", "Molotov out!", "Light 'em up!", "Fire!", "Here's fire!"], terse: ["Fire out."],
    raider: ["Burn, baby!"], radio: ["Incendiary out!"], zealot: ["Cleansing fire!"], enemy: ["Fire!"],
  },
  flash: {
    base: ["Flashbang!", "Flash out!", "Eyes!", "Cover your eyes!"], terse: ["Flash."], radio: ["Flash, flash!", "Bang out!"], enemy: ["Flash!"],
  },
  smoke: {
    base: ["Smoke out!", "Popping smoke!", "Smoke!", "Moving in smoke!"], radio: ["Popping smoke!"], enemy: ["Smoke!"],
  },
  owshot: {
    base: ["Got movement!", "Contact!", "Saw that!", "Not so fast!", "I see you!", "Movement! Firing!"],
    bold: ["Nobody gets past!"], terse: ["Contact.", "Engaging."], chatty: ["Oh no you don't!"], nervous: ["Something moved!"],
    raider: ["Gotcha!"], radio: ["Contact! Engaging!"], zealot: ["None shall pass!"], enemy: ["There!"],
  },
  watch: {
    base: ["Watching.", "Got this lane.", "Covering.", "Eyes up.", "I'll watch."], terse: ["Overwatch.", "Set."],
    chatty: ["I've got the corner."], nervous: ["I'll... keep watch."], radio: ["On overwatch."], raider: ["Come on out..."], enemy: ["Watching."],
  },
  suppress: {
    base: ["Heads down!", "Suppressing!", "Keep 'em down!", "Covering fire!", "Pin them!"], bold: ["Eat this!"], terse: ["Suppressing."],
    raider: ["Spray 'em!"], radio: ["Suppressing fire!"], zealot: ["Fear the Lord!"], enemy: ["Covering fire!"],
  },
  hunker: {
    base: ["Getting down!", "Taking cover!", "Head down!", "Staying low!", "Hugging the wall!"], nervous: ["I'm staying here!"], terse: ["Cover."],
    radio: ["Holding."], raider: ["Duck!"], enemy: ["Taking cover!"],
  },
  revive: {
    base: ["Stay with me!", "I've got you!", "Hang on!", "Don't you quit!", "Hold still!", "Breathe! Breathe!"],
    chatty: ["Easy, I've got you."], terse: ["On it."], nervous: ["Okay, okay, hold on!"], radio: ["Medic on it!"], enemy: ["Hang on!"],
  },
  revived: {
    base: ["I'm up! I'm up!", "Back in it.", "Thanks... I owe you.", "Ugh... I'm okay.", "Still breathing."],
    bold: ["Not done yet!"], nervous: ["Am I... alive?"], terse: ["Up."], radio: ["Back in action."], raider: ["Ugh... still here."], zealot: ["He returns me!"], enemy: ["I'm up!"],
  },
  lowhp: {
    base: ["I'm not doing good.", "Can't take much more!", "Barely standing!", "Need help here!", "So much blood..."],
    bold: ["Still in it!"], nervous: ["I can't do this!"], terse: ["Low. Still up."], raider: ["I'm hurtin'!"], radio: ["Critical! Need evac!"], enemy: ["Help me!"],
  },
  retreat: {
    base: ["Fall back!", "Pull back! Go!", "Out! Everyone out!", "Retreat!", "Move, move!"], terse: ["Fall back."], nervous: ["Run! Just run!"],
    raider: ["Screw this! Run!", "Get out!"], radio: ["Fall back! Now!", "Break contact!"], zealot: ["Regroup! Regroup!"], enemy: ["Run!", "Fall back!"],
  },
  surrender: {
    base: ["Don't shoot!"], raider: ["Okay! Okay! Don't!", "I quit! I quit!"], radio: ["I surrender!"], zealot: ["Mercy..."],
    enemy: ["Don't shoot!", "I give up!", "Hands up! Hands up!", "Please! Don't!"],
  },
  special: {
    base: ["{Z}! Watch it!", "What is that?!", "Big one!", "{Z}! Eyes up!", "Special! Careful!", "That's no normal one."],
    bold: ["{Z}? Bring it!"], nervous: ["What IS that?!"], terse: ["{Z}. Engage."], chatty: ["Is that a {z}?!"], radio: ["Contact, {z}!"],
  },
  groan: { dead: ["Hhhrrrgh...", "Grrhhh...", "...hhhaaa...", "Uuurrgh...", "Kkkhhh..."] },
};

// ---------- the option ----------
export const BARK_MODES = [["on", "On"], ["important", "Important only"], ["off", "Off"]];
const MODE_KEY = "brokenstate.combatBarks";
let mode = "on";
try { const m = typeof localStorage !== "undefined" ? localStorage.getItem(MODE_KEY) : null; if (BARK_MODES.some(([k]) => k === m)) mode = m; } catch { /* storage blocked */ }
export const barkMode = () => mode;
export function setBarkMode(m) {
  if (!BARK_MODES.some(([k]) => k === m)) return;
  mode = m;
  if (m === "off") S.live.length = 0;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* this session only */ }
}

// ---------- the hash (no world RNG, no battle dice) ----------
export function hash32(s) {
  let h = 0x811c9dc5;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
const h01 = (s) => hash32(s) / 4294967296;

// ---------- voices ----------
const TERSE = new Set(["veteran", "cop", "hunter", "prepper"]);
const CHATTY = new Set(["teacher", "office", "student", "nurse"]);
const KIT_VOICE = { raiders: "raider", soldiers: "radio", zealots: "zealot" };
// { side, temper, style, kind }: kind "person" (yours), "enemy" (a voice pool), "dead" (groans), null (silent).
export function voiceOf(state, u) {
  if (!u) return { kind: null };
  if (u.kind === "zombie") return { kind: u.ztype && ZTYPES[u.ztype] ? "dead" : null, pool: "dead" };
  if (u.kind !== "human") return { kind: null };
  if (u.side === "player") {
    const s = state && u.sid != null && state.survivors ? state.survivors.find((x) => x.id === u.sid) : null;
    const tr = (s && s.traits) || [];
    const temper = tr.includes("brave") ? "bold" : tr.includes("coward") ? "nervous" : null;
    const bg = s && s.background;
    const style = TERSE.has(bg) ? "terse" : CHATTY.has(bg) ? "chatty" : null;
    return { kind: "person", temper, style };
  }
  return { kind: "enemy", pool: KIT_VOICE[u.kit] || "enemy" };
}
// The pools a voice draws from, with weights (your people: their trait's pool most, their background's, the common
// ones); an enemy: its kind's pool, else the plain enemy pool.
export function poolsFor(trig, voice) {
  const L = LINES[trig];
  if (!L || !voice || !voice.kind) return [];
  if (voice.kind === "dead") return L.dead ? [[L.dead, 1, "dead"]] : [];
  if (voice.kind === "enemy") return L[voice.pool] ? [[L[voice.pool], 1, voice.pool]] : L.enemy ? [[L.enemy, 1, "enemy"]] : [];
  const out = [];
  if (voice.temper && L[voice.temper]) out.push([L[voice.temper], 3, voice.temper]);
  if (voice.style && L[voice.style]) out.push([L[voice.style], 2, voice.style]);
  if (L.base) out.push([L.base, 2, "base"]);
  return out;
}
// The line for a trigger: the same key (an event's seq and the unit) always gives the same line.
export function lineFor(trig, voice, key, vars = {}) {
  const pools = poolsFor(trig, voice);
  if (!pools.length) return null;
  const total = pools.reduce((a, p) => a + p[1], 0);
  let r = hash32(`pool:${trig}:${key}`) % total, pick = pools[0];
  for (const p of pools) { if (r < p[1]) { pick = p; break; } r -= p[1]; }
  const list = pick[0];
  const z = vars.z || "";
  return list[hash32(`line:${trig}:${key}`) % list.length].replace(/\{n\}/g, vars.n || "").replace(/\{Z\}/g, z ? z[0].toUpperCase() + z.slice(1) : "").replace(/\{z\}/g, z.toLowerCase());
}

// ---------- what changed ----------
// S: the battle being watched, each unit as it was last frame, the last fx seq read, the bubbles up, the cooldowns.
const S = { b: null, snap: new Map(), seq: 0, live: [], cool: new Map(), specials: new Set(), retreat: null, fell: null };
export const barkState = S; // tools/barkstest.js
export function resetBarks() { S.b = null; S.snap.clear(); S.seq = 0; S.live.length = 0; S.cool.clear(); S.specials.clear(); S.retreat = null; S.fell = null; }

const onMap = (u) => !u.left && !u.fled && !u.off && u.x >= 0;
const firstName = (u) => String(u.name || "").split(" ")[0];
const dryOf = (b, u) => !!(hasMag(u) && (magEmpty(b, u) || (u.side === "player" && magShown(b, u) < 1)));
function snapOf(b, u) {
  return { hp: u.hp, down: !!u.down, dead: !!u.dead, surr: !!u.surr, ko: !!u.ko, jam: !!u.jam, weapon: u.weapon, mag: hasMag(u) ? magIn(u) : null, dry: dryOf(b, u), ow: !!u.ow, hunker: !!u.hunker, fleeing: !!u.fleeing, ap: u.ap, x: u.x, y: u.y, active: active(u) };
}
const THROWN = { frag: "frag", pipebomb: "frag", molotov: "molotov", flashbang: "flash", smokegren: "smoke" };
// The nearest of the side that can speak (active, seen when it is not yours), not the unit itself.
function nearestSpeaker(b, t, visible, pred = () => true) {
  let best = null, bd = Infinity;
  for (const o of b.units) {
    if (o === t || o.side !== t.side || !active(o) || o.kind !== "human" || !visible(o) || !pred(o)) continue;
    const d = Math.hypot(o.x - t.x, o.y - t.y);
    if (d < bd || (d === bd && o.id < best.id)) { bd = d; best = o; }
  }
  return best;
}

// The triggers since the last call: [{ unit, trig, key, vars }]. visible(u): your people see that unit now. The
// first call for a battle only takes its picture.
export function detectBarks(state, b, visible = () => true) {
  const out = [];
  if (S.b !== b) {
    resetBarks();
    S.b = b;
    S.seq = b.fxSeq || 0;
    for (const u of b.units) S.snap.set(u.id, snapOf(b, u));
    S.retreat = b.retreatOrder || null;
    S.fell = b.tier ? b.tier.fellBackTurn ?? null : null;
    for (const u of b.units) if (u.kind === "zombie" && u.ztype && active(u) && visible(u)) S.specials.add(u.ztype); // seen at the start: no shout
    return out;
  }
  const byId = new Map(b.units.map((u) => [u.id, u]));
  const at = new Map();
  for (const u of b.units) if (onMap(u)) { const k = `${u.x},${u.y}`; const o = at.get(k); if (!o || (active(u) && !active(o))) at.set(k, u); }
  const unitAtP = (p, side) => { if (!p) return null; const u = at.get(`${p[0]},${p[1]}`); return u && (!side || u.side === side) ? u : null; };
  const phaseSide = b.phase === "enemy" ? "enemy" : "player";
  const stateKey = `${b.fxSeq}:${b.turn}`;
  const add = (unit, trig, key, vars) => { if (unit && LINES[trig]) out.push({ unit, trig, key: `${key}:${unit.id}`, vars }); };

  // The new events.
  const shooterAt = new Map(), critAt = new Set();
  for (const f of b.fx) {
    if (!(f.seq > S.seq)) continue;
    if ((f.type === "shot" || f.type === "melee") && f.to && !f.overpen && f.from && f.side !== "acid" && f.side !== "fire") {
      const a = f.unit != null ? byId.get(f.unit) : unitAtP(f.from, f.side);
      if (a && f.hit) { shooterAt.set(`${f.to[0]},${f.to[1]}`, { a, seq: f.seq }); if (f.crit) critAt.add(`${f.to[0]},${f.to[1]}`); }
      if (a && f.type === "shot" && !f.misfire) {
        if (f.suppress) add(a, "suppress", f.seq);
        else if (a.side !== phaseSide && a.side !== "third" && (a.side === "player" || a.side === "enemy")) add(a, "owshot", f.seq);
      }
    }
    if (f.type === "throw" && THROWN[f.item]) add(unitAtP(f.from), THROWN[f.item], f.seq);
    if (f.type === "heal" && f.to) {
      const t = unitAtP(f.to);
      if (t && t.down && !t.dead && !t.surr) {
        const was = S.snap.get(t.id);
        if (was && was.down) {
          let healer = null;
          for (const o of b.units) {
            if (o === t || o.side !== t.side || !active(o) || Math.max(Math.abs(o.x - t.x), Math.abs(o.y - t.y)) > 1) continue;
            const p = S.snap.get(o.id);
            if (!healer || (p && o.ap < p.ap)) healer = o;
          }
          add(healer, "revive", f.seq);
        }
      }
    }
  }
  S.seq = Math.max(S.seq, b.fxSeq || 0);

  // What changed on each unit.
  for (const u of b.units) {
    const p = S.snap.get(u.id), n = snapOf(b, u);
    S.snap.set(u.id, n);
    if (!p) continue;
    const pos = `${u.x},${u.y}`;
    const fell = (n.down && !p.down) || (n.dead && !p.dead && !p.down);
    if (fell && !n.surr && !(n.ko && u.side !== "player")) {
      const human = u.kind === "human";
      if (human && n.down && !n.dead) add(u, "goingdown", stateKey);
      if (human && p.active) {
        const sp = nearestSpeaker(b, u, visible);
        if (sp) add(sp, "mandown", stateKey, { n: firstName(u) });
      }
      const k = shooterAt.get(pos);
      if (k && k.a.side !== u.side && active(k.a)) add(k.a, human ? "kill_human" : "kill_dead", k.seq);
    }
    if (n.surr && !p.surr) add(u, "surrender", stateKey);
    if (p.down && !n.down && !n.dead && !n.surr) add(u, "revived", stateKey);
    if (!n.active || n.down) continue; // the shout before they drop is all: nothing more from the fallen
    if (n.hp < p.hp - 0.5 && u.maxHp > 0) {
      const f = n.hp / u.maxHp, f0 = p.hp / u.maxHp;
      add(u, critAt.has(pos) ? "crit" : f < 0.3 && f0 >= 0.3 ? "lowhp" : p.hp - n.hp >= 0.3 * u.maxHp ? "hitbad" : "hit", stateKey);
    }
    if (n.jam && !p.jam) add(u, "jam", stateKey);
    else if (!n.jam && p.jam && n.weapon === p.weapon) add(u, "unjam", stateKey);
    if (n.weapon === p.weapon && n.mag != null && p.mag != null && n.mag > p.mag) add(u, "reload", stateKey);
    else if (n.dry && !p.dry && n.weapon === p.weapon) add(u, /No ammo|No spare|Out of/i.test(reloadRefusal(b, u)) ? "outofammo" : "empty", stateKey);
    if (n.ow && !p.ow && u.side === phaseSide) add(u, "watch", stateKey);
    if (n.hunker && !p.hunker) add(u, "hunker", stateKey);
    if (n.fleeing && !p.fleeing) add(u, "retreat", stateKey);
    if (u.kind === "zombie" && u.ztype && ZTYPES[u.ztype] && !S.specials.has(u.ztype) && visible(u)) {
      S.specials.add(u.ztype);
      const sp = nearestSpeaker(b, { ...u, side: "player" }, () => true);
      if (sp) add(sp, "special", `${stateKey}:${u.id}`, { z: ZTYPES[u.ztype].name });
      add(u, "groan", stateKey);
    }
  }
  for (const [id] of S.snap) if (!byId.has(id)) S.snap.delete(id);
  // Sounding the retreat, falling back to the yard: the one nearest the middle of your people calls it.
  const fellBack = b.tier ? b.tier.fellBackTurn ?? null : null;
  if ((b.retreatOrder && b.retreatOrder !== S.retreat) || (fellBack != null && fellBack !== S.fell)) {
    const mine = b.units.filter((o) => o.side === "player" && o.kind === "human" && !o.dead && !o.down && !o.left);
    if (mine.length) {
      const cx = mine.reduce((a, o) => a + o.x, 0) / mine.length, cy = mine.reduce((a, o) => a + o.y, 0) / mine.length;
      const sp = mine.reduce((a, o) => (Math.hypot(o.x - cx, o.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? o : a));
      add(sp, "retreat", `${stateKey}:retreat`);
    }
  }
  S.retreat = b.retreatOrder || null;
  S.fell = fellBack;
  // Enemies (and the third side) only while your people see them; only those with something to say (the dead do not).
  return out.filter((e) => (e.unit.side === "player" || visible(e.unit)) && poolsFor(e.trig, voiceOf(state, e.unit)).length);
}

// ---------- which become bubbles ----------
const importantFor = (e) => IMPORTANT.has(e.trig) && e.unit.side === "player";
const chanceFor = (e) => (importantFor(e) ? 1 : e.unit.side !== "player" && IMPORTANT.has(e.trig) ? 0.5 : CHANCE[e.trig] ?? BARK.CHANCE);
// Starts the bubbles for these triggers (by the option, the chances, one a unit, the cooldown and the cap); returns
// the ones started. m: the option (barkMode() when left out).
export function emitBarks(state, list, now, m = mode) {
  const started = [];
  if (m === "off" || !list.length) return started;
  S.live = S.live.filter((q) => now - q.t0 < BARK.LIFE);
  // One trigger a unit: its highest.
  const best = new Map();
  for (const e of list) { const o = best.get(e.unit.id); if (!o || PRIORITY[e.trig] > PRIORITY[o.trig]) best.set(e.unit.id, e); }
  const order = [...best.values()].sort((a, c) => PRIORITY[c.trig] - PRIORITY[a.trig] || a.unit.id - c.unit.id);
  for (const e of order) {
    const imp = importantFor(e);
    if (m === "important" && !imp) continue;
    if (h01(`chance:${e.trig}:${e.key}`) >= chanceFor(e)) continue;
    const cool = S.cool.get(e.unit.id);
    if (!imp && cool != null && now - cool < BARK.COOL) continue;
    const text = lineFor(e.trig, voiceOf(state, e.unit), e.key, e.vars || {});
    if (!text) continue;
    const mine = S.live.findIndex((q) => q.id === e.unit.id);
    if (mine >= 0) { if (!imp) continue; S.live.splice(mine, 1); } // one bubble a unit; an important one takes its place
    if (S.live.length >= BARK.MAX) {
      if (!imp) continue;
      const k = S.live.findIndex((q) => !q.imp);
      S.live.splice(k >= 0 ? k : 0, 1); // an important one pushes out the oldest routine one
    }
    const q = { id: e.unit.id, side: e.unit.side, trig: e.trig, text, imp, t0: now };
    S.live.push(q);
    S.cool.set(e.unit.id, now);
    started.push(q);
    if (imp) { const [n, o] = barkShout(state, e.unit, e.trig); if (!sfx(n, o)) sfx("bark"); } // ui/humansfx.js: urgent for "man down", strained going down
  }
  return started;
}

// ---------- drawing ----------
// V: { visible(u), head(u) → [X, Y] screen px over the unit's labels (null: not drawn), w, h (the canvas in CSS px),
// font (px), sel (the selected unit's id), top (px kept clear at the top: the turn banner) }.
const SIDE_COL = { player: "#8fc1ff", enemy: "#ff8f85", third: "#e0a84f" };
export function drawBarks(ctx, b, now, V) {
  S.live = S.live.filter((q) => now - q.t0 < BARK.LIFE);
  if (!S.live.length) return 0;
  const fs = Math.max(11, Math.round(V.font || 14)), padX = Math.round(fs * 0.55), bh = Math.round(fs * 1.55), tail = Math.round(fs * 0.45);
  ctx.save();
  ctx.font = `700 ${fs}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const boxes = [];
  // The selected unit's labels stay clear (its health, actions and tags over its head).
  const sel = V.sel != null ? b.units.find((u) => u.id === V.sel) : null;
  const selHead = sel && V.head ? V.head(sel) : null;
  if (selHead) boxes.push({ x0: selHead[0] - fs * 2.6, x1: selHead[0] + fs * 2.6, y0: selHead[1] - fs * 0.2, y1: selHead[1] + fs * 2.2, fixed: true });
  const items = [];
  for (const q of S.live) {
    const u = b.units.find((x) => x.id === q.id);
    if (!u || (u.side !== "player" && !V.visible(u))) continue;
    const h = V.head(u);
    if (!h || !Number.isFinite(h[0]) || !Number.isFinite(h[1])) continue;
    if (h[0] < 0 || h[0] > (V.w || Infinity) || h[1] < -fs * 2 || h[1] > (V.h || Infinity)) continue; // off the screen: no bubble pinned to its edge
    const w = ctx.measureText(q.text).width + padX * 2;
    items.push({ q, ax: h[0], ay: h[1], w });
  }
  items.sort((a, c) => c.ay - a.ay); // the lowest first: the ones above step up out of its way
  let n = 0;
  for (const it of items) {
    const top = V.top || 0, W = V.w || Infinity, H = V.h || Infinity;
    let x0 = Math.max(4, Math.min(W - 4 - it.w, it.ax - it.w / 2)), y1 = it.ay - tail;
    for (let k = 0; k < 8; k++) { // step up past what it would cover
      const hit = boxes.find((o) => x0 < o.x1 && x0 + it.w > o.x0 && y1 - bh < o.y1 && y1 > o.y0);
      if (!hit) break;
      y1 = hit.y0 - 2;
    }
    y1 = Math.max(top + bh + 2, Math.min(H - 4, y1));
    const y0 = y1 - bh;
    boxes.push({ x0, x1: x0 + it.w, y0, y1 });
    const el = now - it.q.t0, a = Math.max(0, Math.min(1, el / 120, (BARK.LIFE - el) / BARK.FADE));
    ctx.globalAlpha = a;
    const col = it.q.imp ? "#ffd166" : SIDE_COL[it.q.side] || "#cfd6e0";
    ctx.fillStyle = "rgba(14,16,20,0.92)";
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.5, fs * 0.1);
    const r = Math.round(bh * 0.35), tx = Math.max(x0 + r + tail, Math.min(x0 + it.w - r - tail, it.ax));
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x0 + it.w - r, y0); ctx.quadraticCurveTo(x0 + it.w, y0, x0 + it.w, y0 + r);
    ctx.lineTo(x0 + it.w, y1 - r); ctx.quadraticCurveTo(x0 + it.w, y1, x0 + it.w - r, y1);
    if (y1 + tail <= it.ay + 1) { ctx.lineTo(tx + tail * 0.7, y1); ctx.lineTo(tx, y1 + tail); ctx.lineTo(tx - tail * 0.7, y1); } // the tail, when it is still over its head
    ctx.lineTo(x0 + r, y1); ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
    ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = it.q.trig === "groan" ? "#b8c4a8" : "#f2f4f6";
    ctx.fillText(it.q.text, x0 + it.w / 2, y0 + bh / 2 + 1);
    n++;
  }
  ctx.restore();
  return n;
}

// Every frame of a battle (ui/combat.js drawCombat): what changed, the bubbles it starts, the bubbles drawn. Not
// in the deploy step; an auto-resolved battle never reaches the battle view, so it has none.
export function barkFrame(ctx, state, b, now, V) {
  if (!b) return 0;
  const list = detectBarks(state, b, V.visible); // kept up to date whatever the option, so turning it on starts quiet
  if (mode === "off" || b.phase === "deploy") return 0;
  emitBarks(state, list, now);
  return drawBarks(ctx, b, now, V);
}
