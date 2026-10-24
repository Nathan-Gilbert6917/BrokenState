// World size argument for the headless tools (sim/worldsize.js): `size=huge`, `--size=huge` or just `huge`
// anywhere on the command line. It is taken out of process.argv, so the tools' positional arguments stay as they
// were. Normal (250 × 150 since 2026-10-24; worldsize.js) when none is given.
import { WORLD_SIZES, DEFAULT_SIZE } from "../src/sim/worldsize.js";

export function takeSize(fallback = DEFAULT_SIZE) {
  let size = fallback;
  for (let i = process.argv.length - 1; i >= 2; i--) {
    const m = /^(?:--)?(?:size=)?([a-z]+)$/i.exec(process.argv[i]);
    const key = m && m[1].toLowerCase();
    if (key && (WORLD_SIZES[key] || (key === "all" && /size=/.test(process.argv[i])))) {
      size = key;
      process.argv.splice(i, 1);
    }
  }
  return size;
}
