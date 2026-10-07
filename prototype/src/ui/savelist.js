// The save list in the menu (ui/settings.js gameTab), grouped by campaign: a head line for each campaign (its hub, mode,
// seed, how many saves), then its saves newest first: manual saves, its last 3 autosaves (ui/saves.js writeAutosave),
// the battle-start save, an Ironman game's slot, the crash save. The game being played comes first, then the others
// by their newest save. Saves from before campaigns are grouped by their seed (ui/saves.js entryCamp).
import { entryCamp, storageShare, storageUsed, STORAGE_CHARS } from "./saves.js";
import { campaignKey } from "../sim/savesummary.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

// Entries (newest first) in campaign groups: [{ key, entries }], the current game's first.
export function campaignGroups(saves, curKey = "") {
  const groups = new Map();
  for (const e of saves) {
    const k = entryCamp(e);
    if (!groups.has(k)) groups.set(k, { key: k, entries: [] });
    groups.get(k).entries.push(e);
  }
  const list = [...groups.values()];
  const newest = (g) => Math.max(...g.entries.map((e) => e.ts || 0));
  return list.sort((a, b) => (b.key === curKey) - (a.key === curKey) || newest(b) - newest(a));
}

// The list's HTML: row(entry) draws one save (ui/settings.js slotRow).
export function savesByCampaign(state, ui, saves, row) {
  const cur = ui.started && state ? campaignKey(state) : "";
  const groups = campaignGroups(saves, cur);
  return groups.map((g) => {
    const e = g.entries[0];
    const autos = g.entries.filter((x) => x.id.startsWith("auto-")).length;
    const name = e.hub || (e.mode === "hardcore" ? "On the road" : "Campaign");
    const bits = [e.mode === "hardcore" ? "Hardcore" : "Normal", `seed ${e.seed ?? "?"}`, `${g.entries.length} save${g.entries.length === 1 ? "" : "s"}${autos ? ` (${autos} autosave${autos === 1 ? "" : "s"}, the last 3 kept)` : ""}`];
    const head = `<div class="sgroup"${tip("One campaign: its saves, newest first. Its autosaves rotate: the last 3 are kept, the oldest written over.")}><b>${esc(name)}</b>${e.ironman || e.iron ? ` <span class="tag">ironman</span>` : ""}${g.key === cur ? ` <span class="tag">this game</span>` : ""} <span class="small muted">${esc(bits.join(" · "))}</span></div>`;
    return head + g.entries.map(row).join("");
  }).join("");
}

// A warning when the saves fill most of the browser's storage (a full storage refuses the next save).
export function storageWarning() {
  const share = storageShare();
  if (share < 0.7) return "";
  const mb = (storageUsed() / 1024 / 1024).toFixed(1);
  return `<div class="small warn" style="margin:0.2rem 0 0.4rem"${tip(`Browser storage holds about ${(STORAGE_CHARS * 2 / 1024 / 1024).toFixed(0)} MB for this game.`)}>Saves fill ${Math.round(share * 100)}% of this browser's storage (${mb} MB). Export the ones to keep and delete old ones, or the next save may not fit.</div>`;
}

// The Help tab's topic on autosaves, the save list and the error screen (ui/help.js puts it after "Saving").
export function savesHelpHtml() {
  return `<b>Autosaves rotate.</b> Each campaign keeps its last 3 autosaves (at dawn every day or every few days, the Options tab; when a hive assault starts; when the run ends): the next one goes over the oldest. Each is named by a one-line summary: the day, how many people, the season and what matters most (a war you joined, a hostile group, the run won or fallen, a Hardcore band still on the road). Your own saves show the same line under their name.<br><br>
    <b>The save list</b> (⚙ Menu → Game) is grouped by campaign: a head line with the hub, the mode and the seed, then that campaign's saves, newest first. The game you are playing comes first. Saves from older versions of the game are grouped by their seed. If the saves fill most of the browser's storage the list says so: Export the ones to keep and delete old ones.<br><br>
    <b>If something breaks.</b> When the game hits an error it did not expect, the clock stops and an error screen says what happened. The game as it was goes to the <i>crash save</i> (its own slot, in the list as "Crash: …"; it never writes over your saves). <i>Copy report</i> puts the details on the clipboard (the error, the day, seed and map, the last 20 log lines) to paste wherever you note bugs. <i>Try to keep playing</i> closes the screen with the game paused; <i>Load the crash save</i> or <i>Back to title</i> are safer if it breaks again straight away (the screen says so). In an Ironman game the crash save sits beside the game's own save, which keeps its last save, and is removed once the game saves itself again. In the desktop app, if the whole page stops or hangs, a window asks whether to reload it.`;
}
