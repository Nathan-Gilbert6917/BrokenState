// Counting your people's deaths in the long-run tools (campaign50.js, wintest.js): one death per survivor, classified
// by the line world.js killSurvivor writes ("<name> died <cause>.").
// Counting every "death" log line with " died " in it counted some deaths twice: someone with the worm logs a second
// death line when they get up again (worm.js riseAtBase "… died with the worm in them at <base> and got up again",
// roadRise "… died near <place> with the worm in them", a group's base, an errand), and the night's care repeats a
// death on the operating table; so every worm death counted as two "worm" deaths, and a horde or raid death of
// someone carrying the worm counted once as that and once as "worm". A prisoner's or a guest's worm death (not one
// of your people) counted too. (Huge-map census at 7353bc3: 247 "worm" deaths were about 125 people.)
export function deathCause(text) {
  if (/hunger|starv/.test(text)) return "hunger";
  if (/thirst/.test(text)) return "thirst";
  if (/worm|parasite/.test(text)) return "worm";
  if (/cold|froze|exposure/.test(text)) return "cold";
  if (/hive/.test(text)) return "hive assault";
  if (/horde|Wallbreaker|the dead/.test(text) && !/defending|raid/.test(text)) return "horde";
  if (/defending|raid|overrun|was overrun/.test(text)) return "raid";
  if (/dysentery|flu|pneumonia|infect|fever|illness|sick|wound/.test(text)) return "illness";
  return "in the field";
}

// A counter for one run: call it after each tick with that tick's new log lines (newest first, as state.log keeps
// them). Returns the survivors who died since the last call: [{ s, cause, text, hour }]. Those who left (walked
// away, deserted, changed sides: s.left) are not deaths and are skipped here.
export function deathCounter(state) {
  const counted = new Set(state.survivors.filter((s) => !s.alive).map((s) => s.id));
  return (fresh) => {
    const out = [];
    for (const s of state.survivors) {
      if (s.alive || counted.has(s.id)) continue;
      counted.add(s.id);
      if (s.left) continue;
      // The oldest of this tick's death lines that names them: killSurvivor's (a rise line comes after it).
      let line = null;
      for (let i = fresh.length - 1; i >= 0; i--) {
        const l = fresh[i];
        if (l.kind === "death" && l.text.startsWith(`${s.name} died `)) { line = l; break; }
      }
      out.push({ s, cause: line ? deathCause(line.text) : "in the field", text: line ? line.text : "", hour: line && line.hour != null ? line.hour : state.hour });
    }
    return out;
  };
}
