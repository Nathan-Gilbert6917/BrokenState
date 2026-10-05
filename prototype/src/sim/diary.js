// The diary: every log line of the run, kept day by day. The log (world.js) keeps only the last 200 lines; world.js
// log() also hands each line here, so the Diary screen (ui/diary.js) can show any day of the run.
// Pure simulation data, no DOM: plain arrays and strings, so a save can copy it as it is.
//
// state.diary = { v, days: [day, ...] (index = day number - 1, created when the day gets its first line), pop }
//   day   = { e: [entry, ...], n: lines over the cap, s: [deaths, arrivals, battles, harvest food, builds, trades,
//             desertions], L: the leader's id that day }
//   entry = one string: char 0 = hour of the day ("a" + hour), char 1 = kind (KIND_CODE), char 2 = category
//           (CATEGORIES), then the text, then (when it names people or places) "\u001f" + refs, each "<type><id>@<start>+<len>"
//           joined by ",". Types: s survivor, b base, t tile (a site or "(x,y)" ground), f group, p team.
// The log line itself gets the same refs and category (l.r, l.c), so the log panel links names and places too.
// Nothing here uses the random number generator: recording never changes how a run plays out.
import * as Buildings from "./buildings.js";

export const DIARY_CAP = 150; // lines kept per day; the rest only counts ("+N more")
export const CATEGORIES = [
  // code, key, label, icon
  ["d", "death", "Deaths", "✝"],
  ["c", "combat", "Combat", "⚔"],
  ["h", "horde", "Hordes & hives", "🧟"],
  ["t", "trade", "Trade & groups", "🤝"],
  ["p", "team", "Teams", "🚶"],
  ["b", "base", "Base & people", "🏠"],
  ["m", "med", "Medical", "✚"],
  ["f", "farm", "Food, water & farming", "🌾"],
  ["w", "world", "Weather & world", "🌦"],
];
export const CAT = Object.fromEntries(CATEGORIES.map(([code, key, label, icon]) => [code, { code, key, label, icon }]));
const KIND_CODE = { info: "i", good: "g", danger: "a", death: "x", bad: "b" };
const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k]));
export const SUMMARY = ["deaths", "arrivals", "battles", "harvest", "builds", "trades", "desertions"];
const SEP = "\u001f";
export const ROBOT = "🤖";
const ROBOT_PRE = ROBOT + " ";

// ---------- classifying a line ----------
// Order matters: a death in a horde fight is a death, a horde breaking in is a horde line, and so on.
const RX = {
  d: /\bdied\b|lost hope and walked away|\bwas killed\b|whole team was lost|has fallen|dead or gone/,
  h: /horde|\bhives?\b|Wallbreaker|Broodmother|\bbrood\b|the dead overran|overrun by the dead|spike pits|decoy fire|the dead surge/i,
  c: /fight|ambush|drove off|broke into|\braid(?!ing team| team)|raiders?\b|attack|captive|prisoner|ransom|rescue|surrender|battle|defen[cs]es held|overran|checkpoint|shot\b/i,
  m: /\bflu\b|dysentery|pneumonia|fever|sprain|deep cut|wounds?\b|infect|\bmeds\b|night care|treated|got over|hospital|infirmary|clinic|medic|\bsick\b|\bill\b|outbreak|quarantine|bitten|turning|bandage|dressings/i,
  t: /trad(e|ed|ers?|ing)\b|caravan|radio|goodwill|\bpacts?\b|barter|\bdeal\b|(neutral|hostile|friendly) toward|allied|tribute/i,
  p: /\bteam\b|left for|is home|convoy|supply run|\bcamp\b|recon|scout|search|cache|mapped|boat|raft|vehicle|truck|\bfuel\b|extracted|on foot|founded|crossing|breakdown|stranded|checkpoint|patrol|carry|death site/i,
  f: /harvest|crops?\b|\bsow|\bplots?\b|\bfood\b|ration|water|\bwells?\b|frost|spoil|cellar|thirst|hunger|starv|drought|rain catcher|filter|preserv|\bjars\b|fields|winter stores|greenhouse|drying rack|kitchen|hunt|snares?|fish|fresh game|hunting cabin/i,
  b: /finished|queued|\bbuilt\b|crafted|roles|station|workshop|armory|leaving|\bmood\b|quarrel|joined|joins|leads the group|feast|bunkhouse|walls|repair|theft|errand|leader|survivors\.|preacher|tempers|stranger|newcomer|renamed|now called|\bbeds?\b|friends?\b|rival|grief|mourn|buried|memorial|\bdog\b/i,
};
const ORDER = ["d", "h", "c", "m", "t", "p", "f", "b"];
// Checked first: lines whose subject is clear from how they start, whatever else they mention.
const FIRST = [
  [/^[A-Z][A-Za-z /-]* team \(/, "p"],                       // "Scavenge / raid team (Cole, Jonah) is home with 3 meds"
  [/\broles:|queued at |^Queued | finished at |Gear handed out|talks about leaving|close to leaving|grown close|\bdog\b|rose to \d|took the perk|cannot stand|become friends|survivor alone|at the gate|^Refugees/, "b"],
];
export function classify(text, kind = "info") {
  const body = text.startsWith(ROBOT) ? text.slice(ROBOT.length).trim() : text;
  if (RX.d.test(body)) return "d";
  for (const [rx, c] of FIRST) if (rx.test(body)) return c;
  // A card answered by the autopilot ("Storm (hills (3,4)) → Shelter and wait."): the card's title says what it was.
  const arrow = body.indexOf(" → ");
  const head = arrow > 0 ? body.slice(0, arrow) : body;
  for (const part of arrow > 0 ? [head, body] : [body]) {
    for (const c of ORDER) if (RX[c].test(part)) return c;
  }
  return kind === "death" ? "d" : "w";
}

// ---------- names and places in a line ----------
// Built once per run and rebuilt when people, bases or groups change (or are renamed). Longest names first, so
// "Sutter Feed store Outpost" (a base) wins over "Sutter Feed store" (the site under it).
const indexes = new WeakMap();
const firstOf = (name) => String(name || "").split(/\s+/)[0];
function nameIndex(state) {
  const sig = `${state.survivors.length}|${state.survivors.map((s) => s.name).join("/")}|${state.bases.map((b) => `${b.id}:${b.name}`).join("/")}|${state.factions.length}`;
  // Crash sites name a tile for a while (crashes.js placeSite / expire): the places are read again when that changes, so
  // the index never depends on when it was first built (a loaded save builds it fresh).
  const siteSig = (state.crashes || []).filter((c) => { const t = state.tiles[c.tile]; return t && t.loc && t.loc.crash === c.id; }).map((c) => c.id).join(",");
  let ix = indexes.get(state);
  if (ix && ix.sig === sig && ix.siteSig === siteSig) return ix;
  const names = [];
  const firsts = new Map();
  for (const s of state.survivors) {
    if (!s || !s.name) continue;
    names.push([s.name, "s", s.id]);
    const f = firstOf(s.name);
    const list = firsts.get(f) || [];
    list.push(s);
    firsts.set(f, list);
    const parts = s.name.split(/\s+/);
    if (parts.length > 1) names.push([`${parts[0]} ${parts[parts.length - 1][0]}.`, "s", s.id]);
  }
  // A first name alone: the only person with it, or the only one of them still alive.
  for (const [f, list] of firsts) {
    if (f.length < 3) continue;
    const living = list.filter((s) => s.alive);
    const one = list.length === 1 ? list[0] : living.length === 1 ? living[0] : null;
    if (one) names.push([f, "s", one.id]);
  }
  for (const b of state.bases) names.push([b.name, "b", b.id]);
  for (const f of state.factions) if (f.name) names.push([f.name, "f", f.id]);
  if (!ix || !ix.sites || ix.siteSig !== siteSig) {
    ix = { sites: [], siteSig };
    for (const t of state.tiles) if (t.loc && t.loc.name) ix.sites.push([t.loc.name, "t", t.id]);
  }
  ix.sig = sig;
  ix.names = [...names, ...ix.sites].sort((a, b) => b[0].length - a[0].length);
  indexes.set(state, ix);
  return ix;
}
const WORD = /[A-Za-z0-9]/;
const bounded = (text, i, len) => (i === 0 || !WORD.test(text[i - 1])) && (i + len >= text.length || !WORD.test(text[i + len]) || text[i + len - 1] === ".");

// [type, id, start, length] for the people, bases, groups, teams and places a line names.
export function findRefs(state, text) {
  const out = [];
  const taken = [];
  const add = (type, id, start, len) => {
    const end = start + len;
    if (taken.some(([a, b]) => start < b && end > a)) return false;
    taken.push([start, end]);
    out.push([type, id, start, len]);
    return true;
  };
  // A team by its label and members: "Scavenge / raid team (Cole, Jonah)".
  const teamRx = /([A-Z][A-Za-z /-]*? team) \(([^)]+)\)/g;
  let m;
  while ((m = teamRx.exec(text))) {
    const names = m[2].split(/,\s*/).map((x) => x.trim()).sort().join(",");
    const p = state.parties.find((q) => q.owner === "player" && Array.isArray(q.members) &&
      q.members.map((id) => firstOf((state.survivors.find((s) => s.id === id) || {}).name)).sort().join(",") === names);
    if (p) add("p", p.id, m.index, m[1].length);
  }
  const ix = nameIndex(state);
  for (const [name, type, id] of ix.names) {
    let i = text.indexOf(name);
    while (i >= 0) {
      if (bounded(text, i, name.length) && add(type, id, i, name.length)) break;
      i = text.indexOf(name, i + 1);
    }
  }
  // Open ground as tile labels write it: "hills (12,30)".
  const at = /(?:\b[a-z]+(?: [a-z]+)? )?\((\d+),(\d+)\)/g;
  while ((m = at.exec(text))) {
    const x = Number(m[1]), y = Number(m[2]);
    if (x < state.grid.width && y < state.grid.height) add("t", state.grid.id(x, y), m.index, m[0].length);
  }
  return out.sort((a, b) => a[2] - b[2]);
}
export const encodeRefs = (refs) => refs.map(([t, id, a, n]) => `${t}${id}@${a}+${n}`).join(",");
export function decodeRefs(str) {
  if (!str) return [];
  const out = [];
  for (const r of str.split(",")) {
    const m = /^([a-z])(\d+)@(\d+)\+(\d+)$/.exec(r);
    if (m) out.push({ type: m[1], id: Number(m[2]), start: Number(m[3]), len: Number(m[4]) });
  }
  return out;
}

// ---------- recording ----------
export function diaryOf(state) {
  if (!state.diary) state.diary = { v: 1, days: [], pop: state.survivors.length };
  return state.diary;
}
function dayRec(state, dayNo) {
  const dy = diaryOf(state);
  let d = dy.days[dayNo - 1];
  if (!d) {
    const leader = state.survivors.find((s) => s.alive && s.leader);
    d = dy.days[dayNo - 1] = { e: [], n: 0, s: [0, 0, 0, 0, 0, 0, 0], L: leader ? leader.id : -1 };
    // Days without a line in between stay holes (null) in the array: nothing happened worth writing down.
  }
  return d;
}
const buildingNames = () => {
  const B = Buildings.BUILDINGS || {};
  if (!buildingNames.set || buildingNames.n !== Object.keys(B).length) {
    buildingNames.set = new Set(Object.values(B).map((b) => b && b.name).filter(Boolean));
    buildingNames.n = Object.keys(B).length;
  }
  return buildingNames.set;
};
export const isBuilding = (name) => buildingNames().has(name);
function summarize(d, text, kind) {
  if (text.startsWith(ROBOT)) return; // the governor's own notes are not events
  const s = d.s;
  if (kind === "death" && /\bdied\b/.test(text)) s[0]++;
  if (/Fight near|drove off the|broke into|broke through the defences|The defences held|ambushed|overran|fight with the brood|held off the/.test(text)) s[2]++;
  const h = /harvested ([\d.]+) food/.exec(text);
  if (h) s[3] += Math.round(Number(h[1]) || 0);
  const f = /^(.+?) finished at /.exec(text);
  if (f && buildingNames().has(f[1])) s[4]++;
  if (/^Traded with /.test(text)) s[5]++;
  if (/lost hope and walked away/.test(text)) s[6]++;
}

function record(state, l) {
  const dy = diaryOf(state);
  const hour = Math.max(0, l.hour | 0);
  const d = dayRec(state, Math.floor(hour / 24) + 1);
  const text = String(l.text ?? "");
  const kind = l.kind || "info";
  const cat = classify(text, kind);
  const refs = encodeRefs(findRefs(state, text));
  l.c = cat;
  l.r = refs;
  l.dy = 1; // recorded (log lines written straight into state.log are picked up by the next one)
  summarize(d, text, kind);
  if (d.e.length >= DIARY_CAP) { d.n++; return; }
  // The autopilot's "🤖 " goes into the category letter (upper case): most lines then fit one byte a character.
  const robot = text.startsWith(ROBOT_PRE);
  d.e.push(String.fromCharCode(97 + (hour % 24)) + (KIND_CODE[kind] || "i") + (robot ? cat.toUpperCase() : cat) + (robot ? text.slice(ROBOT_PRE.length) : text) + (refs ? SEP + refs : ""));
  return dy;
}

// world.js log(): the line just put on top of state.log.
export function diaryRecord(state, l) {
  if (!state || !l) return;
  diarySync(state, 1);
  record(state, l);
}

// New people (survivors.length grew: recruits, rescues, a group joining) get a line of their own, and log lines
// put straight into state.log (without log()) are recorded. Called by diaryRecord and by the UI before drawing.
export function diarySync(state, skipTop = 0) {
  if (!state || !state.log) return;
  const dy = diaryOf(state);
  // Unrecorded lines below the top one (newest first in state.log): record them oldest first.
  const fresh = [];
  for (let i = skipTop; i < state.log.length && fresh.length < 50; i++) {
    const l = state.log[i];
    if (!l || l.dy) break;
    fresh.push(l);
  }
  for (let i = fresh.length - 1; i >= 0; i--) record(state, fresh[i]);
  if (state.survivors.length > dy.pop) {
    const fresh2 = state.survivors.slice(dy.pop);
    dy.pop = state.survivors.length;
    for (const s of fresh2) {
      if (!s || !s.alive || !s.location || s.location.kind === "captive") continue;
      const l = { hour: state.hour, text: `${s.name} joined the group.`, kind: "good" };
      record(state, l);
      dayRec(state, Math.floor(state.hour / 24) + 1).s[1]++;
    }
  }
}

// ---------- reading ----------
export const diaryDayCount = (state) => (state.diary ? state.diary.days.length : 0);
export const diaryDay = (state, dayNo) => (state.diary && state.diary.days[dayNo - 1]) || null;
export function decodeEntry(str) {
  const cut = str.indexOf(SEP);
  const robot = str[2] !== str[2].toLowerCase();
  const text = (robot ? ROBOT_PRE : "") + (cut >= 0 ? str.slice(3, cut) : str.slice(3));
  return {
    hour: str.charCodeAt(0) - 97, kind: CODE_KIND[str[1]] || "info", cat: str[2].toLowerCase(), text,
    refs: cut >= 0 ? str.slice(cut + 1) : "", robot,
  };
}
export function diaryEntries(state, dayNo) {
  const d = diaryDay(state, dayNo);
  return d ? d.e.map(decodeEntry) : [];
}
export function daySummary(state, dayNo) {
  const d = diaryDay(state, dayNo);
  const out = Object.fromEntries(SUMMARY.map((k) => [k, 0]));
  if (d) SUMMARY.forEach((k, i) => (out[k] = d.s[i] || 0));
  out.lines = d ? d.e.length + d.n : 0;
  out.more = d ? d.n : 0;
  out.leaderId = d ? d.L : -1;
  return out;
}

// Size of the diary: lines kept and dropped, characters, and an estimate of the memory it takes (strings at two
// bytes a character when they hold anything beyond Latin-1, plus the string and array overhead).
export function diaryStats(state) {
  const days = state.diary ? state.diary.days : [];
  let lines = 0, dropped = 0, chars = 0, bytes = 0, daysWith = 0;
  for (const d of days) {
    if (!d) continue;
    daysWith++;
    dropped += d.n;
    bytes += 80; // the day object, its summary array and the entry array
    for (const e of d.e) {
      lines++;
      chars += e.length;
      // eslint-disable-next-line no-control-regex
      bytes += 16 + 8 + e.length * (/[^\u0000-ÿ]/.test(e) ? 2 : 1);
    }
  }
  return { days: days.length, daysWith, lines, dropped, chars, bytes };
}
