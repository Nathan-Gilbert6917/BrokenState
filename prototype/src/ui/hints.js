// @ts-check
// The key hints in the words of the device in use (ui/inputmode.js): a mouse and the keyboard read exactly what they
// always read; a finger reads taps, long presses and the on-screen ✕; a controller reads its buttons (Ⓐ press, Ⓑ back,
// Ⓧ the tile menu, Ⓨ the next team or End turn, ☰ pause, LB RB, LT RT: the layers in main.js, ui/gamepad.js).
// Three ways in, from the most care to the least:
//   keyHint({ key, touch, pad }) (inputmode.js): a line written for each device, for the short ones seen a lot (the
//     pick banners, PAUSED, the guide's notes, the camera spots' flash, the battle bar's note).
//   devText(s, where): a line written for a mouse and the keyboard, its words swapped (click → tap / press Ⓐ on,
//     right-click → long-press / Ⓧ, hover → long-press / point at, the wheel → a pinch / LT RT, Esc → ✕ / Ⓑ) and the
//     keys a finger or a pad cannot press dropped ("(Shift+N)"). For the many lines nobody rewrites by hand: the
//     battle's prompts, the inventory's Selected strip, every tip. where: "map" (the State Map and its windows: Esc ✕ Ⓑ,
//     Space ☰, Tab Ⓨ) or "battle" (a right-click and Esc both Ⓑ, Space and Enter Ⓨ, Tab RB).
//   the key badges on buttons (<span class="key">, a panel strip's <kbd>): touch.css, by <html class="input-…">; hidden
//     by touch, a controller's button where data-pad names one (End turn: Y), hidden where none does.
// In "mouse" mode keyHint and devText hand back the very string they were given: a desktop reads what it read before.
import { inputMode, keyHint } from "./inputmode.js";

export { keyHint };
export const padMode = () => inputMode() === "pad";
// The controller's buttons in plain text (a tip, a toast); padHtml draws them as an Xbox pad does in a line of HTML.
export const PAD = { A: "Ⓐ", B: "Ⓑ", X: "Ⓧ", Y: "Ⓨ", Menu: "☰", View: "⧉", LB: "LB", RB: "RB", LT: "LT", RT: "RT" };
const GLYPH = { "Ⓐ": "A", "Ⓑ": "B", "Ⓧ": "X", "Ⓨ": "Y", "☰": "Menu", "⧉": "View" };
// A button as HTML: A green, B red, X blue, Y yellow, the bumpers and triggers grey pills (touch.css .kh).
/** @param {string} n A B X Y LB RB LT RT Menu View */
export const kh = (n) => `<b class="kh kh-${n}">${n === "Menu" ? "☰" : n === "View" ? "⧉" : n}</b>`;
// Every button named in a line of HTML (already escaped), drawn: Ⓐ ☰ LB … as kh. Only in "pad" mode, where they
// are the controller's; any other mode hands the line back as it is. A line with buttons drawn comes in one span, so
// a flex row it sits in (the inventory's Selected strip) keeps it one piece instead of a piece between buttons.
/** @param {string} h */
export function padHtml(h) {
  if (inputMode() !== "pad" || !h) return h;
  const out = String(h).replace(/[ⒶⒷⓍⓎ☰⧉]|\b(?:LB|RB|LT|RT)\b/g, (g) => kh(GLYPH[g] || g));
  return out === h ? out : `<span>${out}</span>`;
}

// A key as the prose writes it: Esc, Space, Shift+N, ⇧Z, Ctrl+1–9, F1–F9, a letter, [ ] \. A bare number is not one
// ("(1 action)"), a range of them is ("1–9").
const KEY = String.raw`(?:(?:Shift|Ctrl|Alt)\+|⇧)*(?:Esc|Space|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|F[1-9](?:–F?[1-9])?|[A-Z](?![\w+])|\d–\d|(?<=\+)\d|[\[\]\\])`;
const K = `${KEY}(?: (?:go|save|back|again))?`;
const SEP = String.raw`(?:, or |, | or | / | · |; )`;
// "(Esc)", "(Shift+N)", "(T or Shift+T)", "(Shift+1–9 go, Ctrl+1–9 save)", "(or Enter)": a key and nothing else.
const KEYS_IN = new RegExp(String.raw` ?\((?:or )?(?:press )?${K}(?:${SEP}(?:press )?${K})*\)`, "g");
// ", or press 1–9 or Tab", " or press Shift+S": the key as one more way to do what the words say.
const OR_PRESS = new RegExp(String.raw`,? or press (?:${K}|\d)(?:${SEP}${K})*(?=[\s.,;:)]|$)`, "g");
// "Press I or Reload": the key, or the button named after it.
const PRESS_OR = new RegExp(String.raw`\b([Pp])ress ${KEY} or (?=[A-Z])`, "g");
// A sentence about a click with Shift, Ctrl or Alt held: no such thing by finger or pad.
const MOD_CLICK = /(?:^|(?<=[.!?;]\s))[^.!?;<>]*\b(?:Shift|Ctrl|Alt)\+(?:right-)?click[^.!?;<>]*[.!?;]?\s?/g;
const cap = (a, w) => (a === a.toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w);
/** @typedef {[RegExp, string | ((...m: string[]) => string)]} Rule */

// ---------- a finger ----------
/** @type {Rule[]} */
const TOUCH = [
  [MOD_CLICK, ""],
  [/ ?\([^()]*\bwheel\b[^()]*\)/g, ""],
  [/\b(?:the )?mouse wheel\b/g, "a pinch"],
  [/\b(?:the )?wheel to zoom\b/g, "pinch to zoom"],
  [/ \(or drag it\)/g, ""],
  [KEYS_IN, ""],
  [OR_PRESS, ""],
  [PRESS_OR, (m, p) => cap(p, "tap ")],
  [/\b(?:Esc or right-click|[Rr]ight-click or Esc)\b/g, "✕"],
  [/\b([Rr])ight-click(s|ed|ing)?\b/g, (m, r, s) => cap(r, `long-press${s === "ing" ? "ing" : s ? "es" : ""}`)],
  [/\b([Ll])eft-click/g, (m, l) => cap(l, "click")],
  [/\b([Dd])ouble-click/g, (m, d) => cap(d, "double-tap")],
  [/(?<![\w-])([Cc])lick(s|ed|ing)?(?![\w-])/g, (m, c, s) => cap(c, `tap${s === "ed" ? "ped" : s === "ing" ? "ping" : s || ""}`)],
];
// On the map Tab (and N) is ❗ Next team, Esc the ✕ on a window or a banner, a hover the long press that shows a tip.
/** @type {Rule[]} */
const TOUCH_MAP = [
  [/\bTab(?: or N)?\b/g, "❗ Next team"],
  [/\bEsc\b/g, "✕"],
  [/(?<![\w-])([Hh])over(s|ing)?(?![\w-])/g, (m, h, s) => cap(h, `long-press${s === "ing" ? "ing" : s ? "es" : ""}`)],
];
// In a battle no ✕ stands beside a prompt (an order's own button again drops it, the tap chip has its own), so the Esc
// lines go; a tap on a cell previews what a hover would show (ui/combat.js combatTap); no Tab.
/** @type {Rule[]} */
const TOUCH_BATTLE = [
  [/(?:^|(?<=[.!?]) )(?:Esc|✕)(?::| to)[^.]*\.?/g, ""],
  [/, Esc to [^.,;]*/g, ""],
  [/,? or (?:press )?(?:Shift\+)?Tab\b/g, ""],
  [/\bEsc\b/g, "✕"],
  [/(?<![\w-])([Hh])over(s|ing)?(?![\w-])/g, (m, h, s) => cap(h, `tap${s === "ing" ? "ping" : s || ""}`)],
];

// ---------- a controller ----------

// A click with the pad: Ⓐ on what is pointed at. "Click a tile" → "Press Ⓐ on a tile", "click to fire" → "press Ⓐ
// to fire", "a click" → "a press".
function padClick(m, c, s, next) {
  const P = c === "C" ? "Press" : "press";
  if (s === "ing") return `${P.replace(/ss$/, "ssing")} Ⓐ on ${next}`;
  if (/^(?:to|again|twice|or|and|here|away|where|anywhere|once|for)\b|^[:,.;)]/.test(next)) return `${P} Ⓐ ${next}`.replace(/Ⓐ ([:,.;)])/, "Ⓐ$1");
  return `${P} Ⓐ on ${next}`;
}
// On the map Ⓧ is the tile menu (a right-click), Ⓨ the next team (Tab, N), ☰ the clock (Space); in a battle a
// right-click steps back as Ⓑ does, Ⓨ ends the turn or starts the fight (Space, Enter), LB / RB go through your people.
/** @param {"map" | "battle"} where @returns {Rule[]} */
function padRules(where) {
  const battle = where === "battle";
  return [
    [MOD_CLICK, ""],
    [/ ?\([^()]*\bwheel\b[^()]*\)/g, ""],
    [/\b(?:the )?(?:mouse )?wheel to zoom\b/g, "LT RT to zoom"],
    [/\b(?:the )?mouse wheel\b/g, "LT RT"],
    [/ \(or drag it\)/g, ""],
    [/ ?\((Esc|Space|Enter|Tab)\)/g, (m, k) => ` (${k === "Esc" ? PAD.B : k === "Tab" ? (battle ? PAD.RB : PAD.Y) : battle ? PAD.Y : k === "Space" ? PAD.Menu : PAD.A})`],
    [KEYS_IN, ""],
    [OR_PRESS, ""],
    [PRESS_OR, (m, p) => cap(p, "pick ")],
    [/\b(?:Esc or right-click|[Rr]ight-click or Esc)\b/g, PAD.B],
    [/\b([Rr])ight-click(?:s|ed|ing)? (a|an|the|any|this|one|it)\b/g, (m, r, w) => `${battle ? PAD.B : PAD.X} on ${w}`],
    [/\b([Rr])ight-click(?:s|ed|ing)?\b/g, battle ? PAD.B : PAD.X],
    [/\b([Ll])eft-click/g, (m, l) => cap(l, "click")],
    [/\b(a|one|the|each|every|plain|next|second|first|another) click\b/gi, (m, w) => `${w} press`],
    [/(?<![\w-])([Cc])lick(s|ing)?(?![\w-]) ?([^\s<]*)/g, (m, c, s, next) => padClick(m, c, s || "", next)],
    [/(?<![\w-])([Hh])over (for|to)\b/g, (m, h, w) => `${cap(h, "point at")} it ${w}`],
    [/(?<![\w-])([Hh])over(s|ing)?(?![\w-])/g, (m, h, s) => cap(h, s === "ing" ? "pointing at" : s ? "points at" : "point at")],
    [/\bShift\+Tab\b/g, battle ? PAD.LB : "Shift+Tab"],
    [/\bTab or N\b/g, PAD.Y],
    [/\bTab\b/g, battle ? PAD.RB : PAD.Y],
    [/\bEsc\b/g, PAD.B],
  ];
}
const RULES = { touch: { map: [...TOUCH, ...TOUCH_MAP], battle: [...TOUCH, ...TOUCH_BATTLE] }, pad: { map: padRules("map"), battle: padRules("battle") } };

// ---------- lines written for each device ----------
// The pick banners (main.js's move, ui/fieldworks.js, ui/tradewindow.js): "<b>click a tile</b> … · <b>Esc</b> cancels".
// A finger's banner also has its ✕ Cancel (ui/responsive.js pickCancel), the pad's Ⓑ is its Esc (main.js map layer).
export const pickWord = () => keyHint({ key: "click", touch: "tap", pad: `${kh("A")} on` });
export const escCancels = () => keyHint({ key: " · <b>Esc</b> cancels", touch: " · <b>✕</b> cancels", pad: ` · ${kh("B")} cancels` });
// A guide note or step (ui/guide.js): its own touch / pad words where it has them, else its text through devText.
/** @param {Record<string, any>} t @param {string} [k] the text's field (text, why) */
export function sayFor(t, k = "text") {
  const m = inputMode();
  return m === "mouse" ? t[k] : t[m] ?? devText(t[k]);
}

/** A mouse-and-keyboard line in the words of the device in use; the very same string in "mouse" mode.
 * @param {string} s @param {"map" | "battle"} [where] */
export function devText(s, where = "map") {
  const m = inputMode();
  if (m === "mouse" || !s) return s;
  let out = String(s);
  for (const [re, to] of RULES[m][where]) out = out.replace(re, /** @type {any} */ (to));
  return out.replace(/ {2,}/g, " ").replace(/ ([.,;:])/g, "$1").replace(/\(\s*\)/g, "");
}
