// @ts-check
// Which device the player is using now: "mouse" (a mouse and the keyboard), "touch" (a finger or a pen) or "pad" (a
// game controller, ui/gamepad.js). The key hints follow it (keyHint: "Esc" with a keyboard, "✕" by touch, "Ⓑ" with a
// controller), so the last device used wins, not what the screen is: a tablet with a keyboard says Esc again.
// <html> carries the class input-mouse / input-touch / input-pad for CSS, and "inputmode" fires on window on a change.
// It starts as "touch" on a touch-only screen (no hover, a coarse pointer), "mouse" anywhere else: a desktop
// with a mouse stays "mouse" until a finger or a controller is used, so nothing changes for it.

/** @typedef {"mouse" | "touch" | "pad"} InputMode */
const mq = (q) => typeof matchMedia === "function" && matchMedia(q).matches;
// The mode a screen starts in, and goes back to when the last controller is unplugged (ui/gamepad.js).
/** @returns {InputMode} */
export const homeMode = () => (mq("(hover: none) and (pointer: coarse)") ? "touch" : "mouse");
/** @type {InputMode} */
let mode = homeMode();

/** @returns {InputMode} */
export const inputMode = () => mode;

/** @param {InputMode} m */
export function setInputMode(m) {
  if (m === mode) return;
  mode = m;
  if (typeof document === "undefined") return;
  const c = document.documentElement.classList;
  c.remove("input-mouse", "input-touch", "input-pad");
  c.add(`input-${m}`);
  window.dispatchEvent(new CustomEvent("inputmode", { detail: m }));
}

// The pointer and the keyboard set it; ui/gamepad.js sets "pad" on a button or a stick past its dead zone. A mouse
// that only twitches (a moved desk) does not take it back from a controller: a press or a real move does.
export function initInputMode() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add(`input-${mode}`);
  let mx = -1, my = -1;
  addEventListener("pointerdown", (e) => setInputMode(e.pointerType === "mouse" ? "mouse" : "touch"), { capture: true, passive: true });
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    if (mx >= 0 && Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) > 24) setInputMode("mouse");
    mx = e.clientX; my = e.clientY;
  }, { capture: true, passive: true });
  addEventListener("keydown", (e) => { if (e.isTrusted) setInputMode("mouse"); }, { capture: true, passive: true }); // not the Esc a ✕ or a pad's B sends (ui/responsive.js, ui/padnav.js)
}

// The hint for one action in the current mode: keyHint({ key: "Esc", touch: "✕", pad: "Ⓑ" }). A mode left out
// falls back to the key, so a desktop always reads what it read before.
/** @param {{ key: string, touch?: string, pad?: string }} h */
export const keyHint = (h) => (mode === "touch" ? h.touch ?? h.key : mode === "pad" ? h.pad ?? h.key : h.key);
