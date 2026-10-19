// The conservation ledger (tools/conservationtest.js; docs/adr/0001-ai-parity.md): every legitimate source that adds
// rounds to the AI side (the other groups, their people and parties, visitors and nomads) notes what it added, so a
// campaign run can check that their holdings never grow from nowhere. Off unless state.ledgerOn (a test switch): the
// game itself never writes it. Transfers between two AI groups cancel out in the AI side's total and are not noted.
// note(state, why, n): n rounds came in from outside the AI side (scavenged, made at a bench, traded or taken from
// you, a group or band created with its holdings).
export function note(state, why, n) {
  if (!state || !state.ledgerOn || !(n > 0)) return;
  const L = state.ledger || (state.ledger = { total: 0, by: {} });
  L.total += n;
  L.by[why] = (L.by[why] || 0) + n;
}
// The rounds in a stock-like record (keys a_..., and the old generic "ammo").
export function roundsIn(stock) {
  let n = 0;
  for (const [k, q] of Object.entries(stock || {})) if ((/^a_/.test(k) || k === "ammo") && typeof q === "number" && q > 0) n += q;
  return n;
}
// The rounds in a list of items: boxes of loose rounds, what is loaded in a gun, a magazine's stack.
const stackN = (st) => (Array.isArray(st) ? st.reduce((a, x) => a + (x.n || 0), 0) : 0);
export function goodsRounds(list) {
  let n = 0;
  for (const it of list || []) {
    if (!it) continue;
    if (/^a_/.test(it.key || "") && it.dur != null) n += Math.floor(Number(it.dur) || 0);
    if (it.loaded) n += Array.isArray(it.loaded.stack) ? stackN(it.loaded.stack) : it.loaded.n || 0;
    n += stackN(it.stack);
  }
  return n;
}
