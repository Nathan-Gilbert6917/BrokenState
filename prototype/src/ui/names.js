// Short names for lists and tabs: the first name, with a last initial when two living people share it
// ("Lucia A." and "Lucia M."), or the full name when even that is the same. main.js calls noteNames(state)
// before the panels are drawn; without it the plain first name is used.
let shared = new Set(); // first names two or more living survivors have
let clash = new Set();  // "First L." forms that are still not unique

const parts = (name) => String(name ?? "").trim().split(/\s+/).filter(Boolean);
const initialForm = (p) => `${p[0]} ${p[p.length - 1][0]}.`;

export function noteNames(state) {
  const seen = new Map(), forms = new Map();
  for (const s of state.survivors) {
    if (!s.alive) continue;
    const p = parts(s.name);
    if (!p.length) continue;
    seen.set(p[0], (seen.get(p[0]) || 0) + 1);
    if (p.length > 1) forms.set(initialForm(p), (forms.get(initialForm(p)) || 0) + 1);
  }
  shared = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  clash = new Set([...forms].filter(([, n]) => n > 1).map(([k]) => k));
}

export function shortName(s) {
  const p = parts(s && s.name);
  if (!p.length) return "";
  if (!shared.has(p[0]) || p.length < 2) return p[0];
  const f = initialForm(p);
  return clash.has(f) ? p.join(" ") : f;
}
