# Broken State weapons overhaul: implementation plan (sections 1–17)

I read `dev` in the main checkout and both worktrees without changing anything.

**Where the two worktrees stand:**
- **gunmods** is only the committed stub so far. `src/sim/gunmods.js` returns NO_MODS. Its fit/remove UI, enemy parts and `randomStarterMods` don't exist yet, so this plan defines those contracts and the gunmods agent fills them in.
- **gunmags** has uncommitted work in `combat.js`, `ui/combat.js`, `carriers.js` and `keymap.js`. It adds `WEAPONS[k].cap`, `magCap`, `loadMag`, `magIn`, `magShown`, `reload`/`reloadRefusal`, `spendRounds`, `fireRefusal`, `hasShots` and a `"reload"` act. Its key design choice: **the team's pools stay the one count of rounds, and `u.mag` is only a counter** (rounds leave the pools when fired). This plan keeps that choice.
- **miltrucks** has no commits beyond `dev` yet, so section 11 is written against today's `vehicles.js` and battle vehicle code.

**Measured blast radius:**
- Generic `"ammo"`: 572 references in 72 src files, plus 84 tool files.
- `"parts"` as a supply: about 300 references in 47 files (718 hits for the bare word, but many are local variables like `parts` in `fieldheat.js` and `buildingmaps.js`).
- Pack contents (`.contents`): 90 references in 25 files. `packOf`: 25 in 12 files. `EQUIP_SLOTS`: 31.

Both supply migrations would be expensive, which drives the recommendations below.

---

## 0. Shared rules and the Phase 0 contract (done by the lead, serially, before the agents start)

**Ordering rules:**
- Merge gunmags, then gunmods, into `dev` first.
- Keep every existing GEAR and WEAPONS key.
- New loot uses **its own dice**: `hash01` tables, following `loot.js` `rollSiteArrows` / `rollAreaArrows`. Existing rng streams must not shift.

**Avoiding merge conflicts:** content goes into new data modules that import nothing, merged by one line each in `data.js` / `combat.js`. Agents then don't all append to the end of `data.js`.
- `src/sim/data-guns.js` exports `GUN_GEAR`, `GUN_WEAPONS`, `KIT_PATCH` (agent B).
- `src/sim/data-ammo.js` exports `CALIBERS`, `AMMO_TYPES`, `AMMO_GEAR` (agent A), plus `RELOAD_GEAR` (brass, powder, primer items: agent C).
- `src/sim/data-gunmods.js` exports `MOD_GEAR`, `PLATFORMS`, `WEAPON_PLATFORM` (gunmods agent / agent C).
- `src/sim/data-kit.js` exports `KIT_GEAR` (rigs, plates, mags, launchers; wave 2).
- `data.js` gets: `Object.assign(GEAR, GUN_GEAR, AMMO_GEAR, MOD_GEAR, KIT_GEAR)`.
- `combat.js` gets: `Object.assign(WEAPONS, GUN_WEAPONS)` and a `KIT_PATCH` merge into `KITS`.

**Fields fixed in Phase 0:**
- `WEAPONS[k].cal` on today's guns: pistol `9mm`, revolver `357`, shotgun `12ga`, pipegun `12ga`, huntrifle `308`, leverrifle `3030`, carbine `556`, ar `556`.
- Also `WEAPONS[k].rel` (base jam %, section 14) and `WEAPONS[k].common` (false means typed rounds only).

**Count-stack items:** GEAR `count: true` means `item.dur` is a count (rounds, primers…). Two small edits:
- `valuation.js itemValue`: value is linear in `dur/d.dur` when `d.count` is set.
- `inventory.js itemKg`: weight is `d.weight × dur/d.dur` when `d.count` is set.

The existing `tabs` purification tablets prove the pattern works.

**One stats function, used everywhere:** new `src/sim/gunstats.js` (agent A) with `gunStats(item | key, { load, mods, mag })` → `{ cal, aim, close, opt, fall, dmg:[lo,hi], ammoPerShot, cap, noise, weight, value, pen, jam, reloadAp }`. `playerUnit`/`shotOdds`, the gun builder and tooltips all call it, so the screen always matches the battle. The Phase 0 stub returns plain WEAPONS stats.

---

## 1. Ammo model

**Recommendation: keep generic `"ammo"` as the economy unit; special rounds are count-stack GEAR items ("boxes").** All 572 `"ammo"` references stay as they are (upkeep, trade, caravans, autopilot, raids, `autoResolveCombat`, factions).

- `"ammo"` means **common rounds**: ball, FMJ or 00 buck of any common calibre, fungible as today. Display name: "Ammo (common rounds)".
- Calibres with `common: false` (.50 BMG, 40 mm, rockets) and every non-common type exist **only** as boxes.
- **Guarantee: a gun loaded with common rounds behaves exactly as today.** Existing tests and balance hold.

**Calibres (`CALIBERS`):**

| cal | name | kg/round | box | common? | base pen |
|---|---|---|---|---|---|
| 22lr | .22 LR | 0.0035 | 100 | yes | 5 |
| 9mm | 9mm | 0.012 | 50 | yes | 15 |
| 45acp | .45 ACP | 0.021 | 50 | yes | 14 |
| 357 | .357 Magnum | 0.015 | 50 | yes | 20 |
| 12ga | 12 gauge | 0.04 | 25 | yes (00 buck) | 8 |
| 556 | 5.56 NATO | 0.012 | 30 | yes | 30 |
| 762x39 | 7.62×39 | 0.016 | 30 | yes | 32 |
| 308 | .308 / 7.62 NATO | 0.025 | 20 | yes | 38 |
| 3030 | .30-30 | 0.020 | 20 | yes (soft point) | 25 |
| 50bmg | .50 BMG | 0.115 | 10 | **no** | 70 |
| 40mm, rocket | section 13 | | | no | |

**Types (`AMMO_TYPES`):**
- "Pen" is the absolute penetration of that calibre and type (it replaces the base pen).
- "Soft ×" applies only when the hit lands on no armour.
- ad = the armour-damage factor (section 17). Value is per round; common rounds are 0.5.

| type | calibres | dmg× | soft× | pen | aim | opt / fall | close | noise× | jam× | ad | value |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fmj / buck (common) | all common | 1 | 1 | base | 0 | – | – | 1 | 1 | 0.4 pistol, 0.3 buck, 0.8 rifle | 0.5 |
| hp | 22, 9, 45, 357 | 1 | 1.2 | 2 / 8 / 8 / 12 | 0 | – | – | 1 | 1 | 0.3 | ×1.6 |
| sp (soft point) | 308, 762x39, 3030 | 1 | 1.12 | 30 / 25 / 25 | 0 | – | – | 1 | 1 | 0.6 | ×1.5 |
| ap | 9, 556, 762x39, 308 | 0.92 | 0.92 | 30 / 45 / 45 / 55 | 0 | – | – | 1 | 1 | 1.1 | ×2.8 |
| plusp (+P) | 9, 357 | 1.1 | 1.1 | base+3 | −2 | – | – | 1.1 | 1.2 | 0.45 | ×1.4 |
| subsonic | 22, 9, 45, 308 | 0.9 | 0.9 | base−2 | 0 | opt −1 | – | 0.75 (×0.6 suppressed) | 1.1 | 0.35 | ×1.4 |
| match | 556, 308 | 1 | 1 | base+2 | +6 | opt +1, fall ×0.85 | – | 1 | 0.8 | 0.8 | ×2 |
| tracer | 556, 762x39 | 1 | 1 | base−2 | +4 | – | – | 1 (reveals shooter at night) | 1 | 0.8 | ×1.4 |
| slug | 12ga | 1.15 | 1.15 | 22 | 0 | opt +4, fall ×0.55 | −8 | 1 | 1 | 0.9 | ×1.4 |
| bird | 12ga | 0.55 | 0.55 | 2 | +8 | opt −1 | +6 | 1 | 1 | 0.15 | ×0.6 |
| ball (.50) | 50bmg | 1 | 1 | 70 | – | – | – | 1 | 1 | 3 | 6 |
| api (.50) | 50bmg | 1.05 | 1.05 | 75 | – | – | – | 1 | 1 | 3.2 | 10; 25% ignites the target's tile (throwables.js `ignite`) |

- Buckshot and birdshot set `spread: true`. `carriers.js swarmArmor` should test `hit.spread`, not GEAR cat `shotgun`, so slugs lose the bonus against the worm swarm. Bird ×1.3 against the swarm.
- Box keys are `a_<cal>_<type>`, for example `a_9mm_hp` or `a_50bmg_ball`, generated in `data-ammo.js` as:
  `{ name: "9mm hollow point", slot: "pack", small: true, count: true, dur: box, weight: kg×box + 0.05, value: v×box, cat: "ammo", rounds: { cal, type } }`
- Box condition: `item.cond` is `"factory"` (default), `"hand"` (handloaded, with `item.hq` quality, section 12) or `"old"` (salvaged from the dead, corroded). Boxes with different conditions don't merge.

**Where boxes live:** pockets, pack, rig pouches (section 16), team cargo, base armory. Trade, loot and raid looting already handle items.

**Choosing ammo per gun:**
- `item.load` = a type key, `null` (common), or `"auto"`. It persists on the weapon item.
- It is set in the gun builder or the inventory tooltip ("Load: 9mm HP ▾"), and per magazine in section 15.
- `playerUnit` sets `u.load` from the item's load, or the magazine's (section 15). If the side has none of that type it falls back to common and logs it.

**In battle (agent A edits gunmags' functions in `combat.js`):**
- New helpers in a new `src/sim/ammo.js`:
  - `roundsOf(b, u, type)`: common → `ammoLeft(b)`; typed → the side's boxes of `a_<cal>_<type>`. The scan covers fighters' carried items, `party.cargo.gear`, and `base.armory` in base battles. It is cached on `b.rev` and invalidated by `takeRounds`.
  - `takeRounds(b, u, type, n)`: draws from the shooter's own boxes first, then teammates', cargo, armory. Empty boxes are removed at `endBattle`.
- `spendRounds`, `canFire`, `magShown`, `reloadRefusal`, `fireRefusal` switch from `ammoLeft(b)` to `roundsOf(b, u, u.load)`.
- Reload act gets `act.ammo`. Reloading with another type sets `u.load` and refills the magazine; because rounds are counted only at firing, nothing needs refunding.
- In the UI: the Reload button opens a type chooser when more than one type of that calibre is to hand; Shift+I cycles. Default is the current type.
- `fire()` passes `hit = { how:"shot", crit, weapon, cal, ammo: u.load }` to `damage` / `hitMult`, enemies included.
- `shotNoise` in `stealth.js` multiplies by the type's noise ×, a one-line change.

**Saves:** only additive fields (`item.load`, box items, `u.load`). The gunmags lever-action capacity change from 8 to 6 is safe because `loadMag` clamps. Unknown `item.load` values are nulled in `inventory.js ensureInv`. **No `SAVE_VERSION` bump.**

**Rejected alternative: full migration** to per-calibre supplies (`ammo_9mm`…). It touches the 72 files and 84 tools above, every trade table, faction stocks and the autopilot reserves. List it as option R1 in section 8; not recommended.

---

## 2. Armour penetration (numbers)

Section 17 replaces flat `armorMult` with per-hit pieces for **people**. Here is the summary, with the full model in section 17.
- Armour has a class (AC 1–6) and a threshold T = 10 × AC, scaled down as it wears.
- Penetration chance: `p = clamp(0.5 + (pen − T×(0.4 + 0.6×dur%))/20, 0.03, 0.97)`.
- If it penetrates: damage × 0.9 (× 0.85 at AC ≥ 4).
- If it's stopped: blunt damage × {AC1 0.6, AC2 0.45, AC3 0.35, AC4 0.3, AC5 0.25, AC6 0.2}.
- HP/SP get their soft-target bonus only on a location with no armour.

**Penetration chance against new armour:**

| round (pen) | vest AC2 (soft) | steel plate AC4 | ceramic plate AC5 | ceramic at 40% durability |
|---|---|---|---|---|
| 9mm HP (8) | 3% | 3% | 3% | 3% |
| 9mm FMJ (15) | 25% | 3% | 3% | 3% |
| 9mm AP (30) | 97% | 3% | 3% | 34% |
| 00 buck (8) | 3% | 3% | 3% | 3% |
| slug (22) | 60% | 3% | 3% | 3% |
| 5.56 FMJ (30) | 97% | 3% | 3% | 34% |
| 5.56 AP (45) | 97% | 75% | 25% | 97% |
| .308 SP (30) / FMJ (38) | 97% | 3% / 40% | 3% / 3% | 34% / 74% |
| .308 AP (55) | 97% | 97% | 75% | 97% |
| .50 BMG (70) | 97% | 97% | 97% | 97% |

**Armoured dead** (MILDEAD stays a per-weapon multiplier `m`):
- Adjust by pen relative to the weapon's common round: `m' = 1 − (1 − m) × clamp(1 − (pen − penCommon)/40, 0.2, 1.6) × plateDur^0.5`.
- `plateDur` is the unit's own 0–1 that drops per hit, so your hits do wear their plates. Body loot armour quality = `plateDur`.
- Dead soldier: pistol FMJ 0.5 → HP 0.41 (no soft bonus) → AP 0.63. AR 0.75 → AP 0.84. Shotgun buck 0.6 → slug 0.85. .50 gets a table entry of 1.
- Riot cop: pistol 0.7 → HP 0.65 → AP 0.81.
- Crits and sneak blades still ignore armour (`armorVs` unchanged).
- New weapon keys fall back by calibre: `MILDEAD.ARMOR.soldier.cal = { 22lr: 0.35, 9mm: 0.5, 45acp: 0.5, 357: 0.6, 12ga: 0.6, 556: 0.75, 762x39: 0.75, 308: 0.8, 3030: 0.7, 50bmg: 1 }`; riot: rifles 1, pistols 0.7.
- Melee falls back by class (`w.mclass`): soldier `{ blade: 0.45, pierce: 0.85, chop: 0.7, blunt: 0.85, heavy: 1 }`, riot `{ blade: 0.5, pierce: 0.75, chop: 0.6, blunt: 0.6, heavy: 0.8 }`.

**Same pen formula elsewhere:**
- Boneback front: apply it on `BB.FRONT` in `middead.js bonebackMult`.
- Brute hide (`t.armor` 0.75): `hitMult` for ztypes without a table.

**Crits on people go to the head** (×2), so helmets now matter against crits.

---

## 3. Gun roster

- Jam % is per shot for a new gun with factory ammo (section 14).
- Power is GEAR power for `combatPower`.
- "×1" ammo per shot unless noted.

| key | name | cal | dmg | opt | fall | aim | close | ammo/shot | cap | noise | kg | value | req | power | jam % | found |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pistol (kept) | 9mm pistol | 9mm | 15–22 | 6 | 4 | +4 | – | 1 | 15 | 2 | 1.0 | 30 | 2 | 3 | 0.35 | as today |
| revolver (kept) | .357 revolver | 357 | 20–30 | 5 | 5 | −2 | – | 1 | 6 | 3 | 1.2 | 34 | 3 | 3.5 | 0.05 (misfire only) | as today |
| shotgun (kept) | Pump shotgun | 12ga | 24–36 | 4 | 7 | +10 | +10 | 1 | 6 | 3 | 3.5 | 50 | 6 | 5 | 0.3 | as today |
| pipegun (kept) | Pipe shotgun | 12ga | 20–32 | 3 | 8 | −6 | +8 | 1 | 1 | 3 | 2.5 | 20 | 3 | 3.5 | 1.2 | crafted |
| huntrifle (kept) | Hunting rifle (.308 bolt) | 308 | 24–34 | 12 | 2 | +5 | −10 | 1 | 5 | 3 | 4 | 55 | 5 | 5 | 0.15 | as today |
| leverrifle (kept) | Lever-action rifle | 3030 | 20–30 | 10 | 2.5 | +4 | – | 1 | **6** (gunmags had 8) | 3 | 3.4 | 45 | 4 | 4.5 | 0.3 | as today |
| carbine (kept) | Police carbine | 556 | 20–29 | 9 | 3 | +7 | – | 1 | 30 | 3 | 3 | 95 | 8 | 6.5 | 0.5 | as today |
| ar (kept) | Assault rifle | 556 | 22–32 | 9 | 3 | +8 | – | 2 | 30 | 3 | 4 | 120 | 10 | 8 | 0.5 | as today |
| pistol22 | .22 target pistol | 22lr | 10–16 | 6 | 3 | +8 | – | 1 | 10 | 1 | 0.9 | 18 | 0 | 2 | 1.0 | houses, gun store, campsite |
| compact9 | Compact 9mm | 9mm | 14–21 | 5 | 5 | +2 | – | 1 | 8 | 2 | 0.65 | 24 | 1 | 2.6 | 0.45 | houses, cars, survivors |
| pistol45 | 1911 .45 | 45acp | 18–26 | 5 | 4.5 | +2 | – | 1 | 7 | 2 | 1.1 | 38 | 3 | 3.3 | 0.4 | police, gun store, ranch |
| smg | 9mm submachine gun | 9mm | 15–22 | 7 | 3.5 | +6 | +4 | 2 | 30 | 2 | 2.9 | 95 | 7 | 6 | 0.5 | police armory 0.03, military armory 0.03, guards strong |
| dbshotgun | Double-barrel shotgun | 12ga | 26–38 | 4 | 7 | +8 | +12 | 1 | 2 | 3 | 3.2 | 32 | 3 | 4.5 | 0.1 (misfire) | farms, ranch, barn, militia, zealots |
| sawnoff | Sawn-off shotgun | 12ga | 26–38 | 2 | 10 | +2 | +18 | 1 | 2 | 4 | 2.2 | 26 | 2 | 4 | 0.1 | raiders; crafted from dbshotgun |
| semishotgun | Semi-auto shotgun | 12ga | 24–36 | 4 | 6.5 | +11 | +10 | 1 | 8 | 3 | 3.8 | 120 | 7 | 6 | 0.7 | police/prison armory, military |
| rifle22 | .22 rifle | 22lr | 12–18 | 9 | 2.5 | +8 | – | 1 | 10 | 1 | 2.3 | 24 | 0 | 2.5 | 1.0 | farms, cabins, ranch, gun store (hunt big 0.25, small 1.1) |
| ak | AK-pattern rifle | 762x39 | 24–34 | 8 | 3.5 | +5 | – | 2 | 30 | 3 | 3.6 | 110 | 9 | 7.5 | 0.15 | raiders strong, expansionists, gun store 0.01 |
| dmr | Marksman rifle (AR-10) | 308 | 27–37 | 13 | 1.8 | +8 | −8 | 1 | 20 | 3 | 5 | 170 | 11 | 8 | 0.6 | military armory 0.02, milwreck 0.02, soldiers strong |
| lmg | Light machine gun (M249) | 556 | 22–32 | 8 | 3.5 | 0 | – | 3 | 100 | 4 | 8 | 240 | 12 | 9.5 | 0.9 | military armory 0.008, soldiers strong (1 in 6 at power 8+) |
| amr | .50 BMG anti-materiel rifle | 50bmg | 62–84 | 16 | 1.2 | −2 | −20 | 1 | 10 | 6 | 14 | 450 | 13 | 10 | 0.6 | military armory 0.006, milwreck 0.01; never in KITS |
| m2hb | M2 heavy machine gun (mount only) | 50bmg | 40–58 | 14 | 1.5 | +6 mounted | – | 3 | 100 | 6 | 38 (bulky) | 600 | 10 | – | 0.5 | section 11 |

**New weapon fields:**
- `heavy: { mob: −1, brace: +8 }` (lmg): −1 tile per action; +8 aim if the unit did not move this turn. `moveAlong` sets `u.movedT = b.turn`.
- `brace: −20` (amr): −20 aim if moved this turn.
- `pierce: 1` (amr): cover counts one step less. This reuses the spitter's `pierce` in `shotOdds`.
- `common: false` (amr, m2hb).
- `hunt` overrides in GEAR: smg `{ big: 0.5, small: 0.6 }`, amr `{ big: 0.6, small: 0.1 }`.

**Categories:** smg, lmg, ak are cat `automatic`; dmr, amr cat `rifle`. No new CATEGORIES, so TRADE_PREFS and `valuation.js GEAR_REF` keep working.

**KITS (`KIT_PATCH`):**
- raiders: add compact9, sawnoff, dbshotgun, ak (strong).
- soldiers: add smg, dmr and lmg (strong).
- guards: add smg, semishotgun, pistol45 (strong: semishotgun, carbine).
- militia: add rifle22, dbshotgun, pistol45.
- survivors: add pistol22, compact9, rifle22, dbshotgun.
- zealots: add dbshotgun, spear.
- fighters: add ak and semishotgun (strong).

**Loot lists:** LOCATIONS gear lists and `combat.js` AREAS gear entries get the new keys. `rng.pick` still draws once, so the stream length is unchanged.

**UI:** `ui/inventory.js` `GUNS` becomes `!WEAPONS[k].melee && !WEAPONS[k].arrows`.

---

## 4. Melee overhaul

**New fields on WEAPONS melee entries (agent B, `combat.js strike` and the `"melee"` case of `combatAct`):**
- `mclass`: `blade | pierce | chop | blunt | heavy`. Section 2 uses it for armour.
- `quick`: a strike costs 1 action instead of ending the turn, with at most one strike a turn (`u.struck = b.turn`). You can hit and step away; damage per turn doesn't go up.
- `stagger`: chance on a hit (doubled on a crit) that the target loses 1 AP next turn, applied where the enemy phase restores `u.ap = 2`. Brutes and bosses are immune.
- `bleed`: chance on a hit against a living human: 5 damage at the start of each of its next 2 turns.
- `reach: 2`: strike at Chebyshev distance 2 in a straight line, with clear LOS and nobody in between. Needs a helper `inMelee(b, u, t)` used by `combatAct` and `aiMelee` in place of `adjacent`. **Medium risk** (pick-list).
- `takedown`: replaces `stealth.js CLUB[key]` with `CLUB[key] ?? w.takedown ?? 5`.

| key | dmg | meleeAim | class | traits | takedown | kg | value | where |
|---|---|---|---|---|---|---|---|---|
| fists | 6–10 | | blunt | | 5 | | | |
| knife (kept) | 14–22 | | blade | quick | 10 | 0.3 | 5 | as today |
| machete (kept) | 20–30 | | blade | bleed 0.25 | 10 | | | |
| spikedbat (kept) | 16–25 | | blunt | bleed 0.15 | 20 | | | |
| pipespear (kept) | 15–23 | | pierce | reach 2 | 5 | | | |
| sawmachete (kept) | 17–27 | | blade | bleed 0.3 | 10 | | | |
| bat (kept) | 15–24 | | blunt | stagger 0.25 | 20 | | | |
| nailbat (kept) | 20–31 | | blunt | stagger 0.2, bleed 0.2 | 15 | | | |
| prybar (kept) | 16–25 | | blunt | pry | 15 | | | |
| fireaxe (kept) | 21–32 | | chop | stagger 0.2, pry | 10 | | | |
| sledge (kept) | 25–38 | −10 | heavy | stagger 0.45, pry | 10 | | | |
| baton (kept) | 12–19 | | blunt | quick | 20 | | | |
| combatknife | 16–24 | +5 | pierce | quick, finds the gap (`MILDEAD.STAB`) | 15 | 0.35 | 18 | military, gun store, soldier dead |
| hatchet | 17–26 | | chop | quick, also a wood tool (`hunting.js ICE_TOOL` already names it) | 10 | 0.8 | 10 | hardware, cabin, campground |
| tomahawk | 19–28 | | chop | quick, pry | 10 | 0.7 | 30 | military, gun store |
| kukri | 19–29 | | blade | bleed 0.35 | 10 | 0.6 | 20 | gun store, house (rare) |
| katana | 24–34 | +5 | blade | bleed 0.3; req 3 | 10 | 1.2 | 45 | mall, house (collector, 0.005) |
| spear | 19–29 | | pierce | reach 2 | 5 | 2.2 | 15 | lodge, cabin, zealots; crafted (pipe + knife: wood 30, scrap 2) |
| pickaxe | 22–34 | −8 | pierce | stagger 0.2, pry; soldier dead ×0.9 | 5 | 3 | 12 | quarry, hardware, barn, factory |
| hammer | 11–17 | | blunt | quick, small | 15 | 0.6 | 4 | hardware, garage, house, workshop |
| etool | 17–26 | | chop | stagger 0.2 | 10 | 1.1 | 10 | military, barracks, campground |
| golfclub | 14–22 | | blunt | stagger 0.2 | 15 | 0.5 | 6 | house, lockers |
| riotshield (optional, off hand) | – | | – | +1 cover against shots from its facing; −10 aim with a long gun | – | 4.5 | 40 | police, prison |

---

## 5. Attachments (adds to gunmods' sights, suppressors, oil filter, brake, compensator, choke, extended mags, drum, tube)

**Slots:** `optic, mount, muzzle, mag, under, stock, grip, rail, tactical, bipod, sling`.

**Nesting:** a mod can carry `adds: [slots]`:
- `mount` adds `optic`.
- A rail handguard adds `grip, tactical, bipod`.
- `under` and `grip` share space; fitting one blocks the other.

**`PLATFORMS` (in `data-gunmods.js`) and `WEAPON_PLATFORM`:**

| platform | weapons | base slots |
|---|---|---|
| glock | pistol, compact9 (no muzzle) | optic, muzzle, mag, tactical |
| p1911 | pistol45 | optic, muzzle, mag, tactical |
| rimpistol | pistol22 | optic, muzzle, mag |
| revolver | revolver | optic (needs mount), grip |
| mp5 | smg | mount→optic, muzzle, mag, stock, tactical, sling |
| ar15 | carbine, ar | optic, muzzle, mag, stock, rail, under, sling |
| ar10 | dmr | optic, muzzle, mag, stock, rail, bipod, sling |
| m249 | lmg | optic, muzzle, mag (box/STANAG), stock, tactical; bipod built in |
| ak | ak | mount→optic, muzzle, mag, stock, rail, sling |
| bolt | huntrifle | mount→optic (ships with a mount and 3–9×), muzzle, mag, stock, bipod, sling |
| lever | leverrifle | mount→optic, stock, sling |
| rimrifle | rifle22 | optic, muzzle, mag, stock, sling |
| pump | shotgun | mount→optic, muzzle (choke), mag (tube), stock, tactical, sling |
| semi12 | semishotgun | optic, muzzle, mag (tube), stock, tactical, sling |
| dbl | dbshotgun, sawnoff (none) | muzzle (choke), stock, sling |
| amr | amr | optic, muzzle, mag, bipod (built in), sling |
| zip | pipegun | sling |

**Fit rules:**
- Muzzle devices and suppressors fit by **calibre** (`fits.cal`) on platforms that have a muzzle slot.
- Everything else fits by **platform** (`fits.plat`).

**New mods** (stats use gunmods' contract fields: aim, close, opt, fall, dmg, cap, capMult, noise ×, weight, value; plus `night`, `jam`, `short`):

| key | slot | fits | effect | kg | value | where |
|---|---|---|---|---|---|---|
| tritium | optic | pistols | aim +2, night +6 | 0.02 | 20 | police, gun store |
| rmr | optic | glock, p1911, rimpistol | aim +4, close +2 | 0.05 | 35 | gun store, police |
| holo | optic | ar15, ak (mount), mp5, semi12, m249 | aim +6, close +4, opt +1 | 0.3 | 55 | military, police |
| acog | optic | ar15, ar10, m249, ak (mount) | aim +6, opt +3, fall −0.5, close −4 | 0.45 | 90 | military |
| lpvo | optic | ar15, ar10 | aim +6, opt +2, fall −0.4, close −1 | 0.6 | 120 | military (rare) |
| tacscope | optic | ar10, bolt, amr | aim +7, opt +6, fall −0.8, close −14 | 0.9 | 160 | military |
| thermalscope | optic | any optic slot | aim +4, opt +2; at night that unit's shots ignore darkness | 0.7 | 260 | military 0.003 |
| scrapscope | optic | any optic slot (makeshift, dur 30) | aim +2, opt +2, close −6 | 0.4 | 6 | crafted |
| scopemount | mount | bolt, lever, pump, rimrifle, revolver | adds optic | 0.1 | 8 | gun store, lodge |
| sidemount | mount | ak | adds optic | 0.15 | 15 | gun store, raiders |
| quadrail | rail | ar15, ar10, ak | adds grip, tactical, bipod | 0.3 | 25 | military |
| mlok | rail | ar15, ar10 | adds grip, tactical; aim +1 | 0.2 (net −0.2) | 35 | military, gun store |
| can22 | muzzle | cal 22lr | noise ×0.35 | 0.2 | 40 | gun store |
| can9 | muzzle | cal 9mm, 45acp | noise ×0.5, jam ×1.2 | 0.3 | 60 | police SWAT, military |
| can556 | muzzle | cal 556 | noise ×0.55, aim +1, jam ×1.3 | 0.5 | 90 | military |
| can308 | muzzle | cal 308, 762x39 | noise ×0.6, jam ×1.3 | 0.6 | 110 | military, gun store |
| can12 | muzzle | cal 12ga, semi12/pump | noise ×0.7, close −2 | 0.7 | 80 | very rare |
| bottlecan | muzzle | any except 12ga/.50 (makeshift, dur 3) | noise ×0.6, aim −3 | 0.1 | 1 | crafted: bottle + scrap 1, field |
| solventcan | muzzle | 22lr, 9mm, 556 (makeshift, dur 40) | noise ×0.6, jam ×1.4 | 0.5 | 30 | crafted: machine shop, Mechanics 6, scrap 3, gunparts 1 |
| flashhider | muzzle | rifle calibres | aim +1; muzzle flash no longer lights the shooter at night | 0.1 | 6 | gun store, military |
| recoilpad | stock | pump, dbl, semi12, bolt, lever, amr | aim +2 (+3 shotguns and amr) | 0.2 | 8 | everywhere |
| collapsible | stock | ar15, mp5, ak, semi12 | aim +2, close +3 | 0.3 | 30 | military, police |
| precision | stock | bolt, ar10, ar15 | aim +3, opt +1, close −3 | 0.8 | 60 | military, gun store |
| foldstock | stock | ak, mp5, semi12 | close +4, aim −2, weight −0.4 | 0.3 | 25 | raiders, gun store |
| vertgrip | grip | rail or ar15 | aim +2, close +2 | 0.15 | 12 | |
| anglegrip | grip | rail or ar15 | aim +1, close +4 | 0.1 | 15 | |
| revgrip | grip | revolver | aim +3 | 0.05 | 10 | |
| weaponlight | tactical | tactical slot | at night works as a flashlight for this unit (`lights.js`, frees the off hand); +8 aim within 6 tiles at night; seen 3 tiles further | 0.15 | 18 | |
| laser | tactical | tactical slot | close +5, aim +1 within 6 tiles | 0.1 | 25 | |
| peq | tactical | tactical slot | with NVG: +8 aim at night, invisible | 0.2 | 120 | military |
| bipod | bipod | ar10, bolt, rimrifle, rail | +8 aim if the shooter didn't move this turn | 0.4 | 25 | |
| sling | sling | all | aim +1 if the shooter moved this turn | 0.15 | 5 | |
| m203 | under | ar15 (blocks grip) | 40 mm launcher, section 13 | 1.4 | 160 | military |

**Magazine "mods" become magazine items** (section 15).

**Starter parts** (`randomStarterMods`): the pool is mods worth ≤ 20, not military-only, that fit the gun: recoilpad, revgrip, sling, flashhider, vertgrip, anglegrip, scopemount, tritium, cheap mags.

**Enemy faction parts** (gunmods' table, extended):
- soldiers: acog, holo, vertgrip, weaponlight, peq 10%, can556 5%, 40-round mags, m203 on 1 in 8 ARs.
- raiders: reddot, oil filter, foldstock, sidemount, AK 45/drum.
- guards: weaponlight, rmr, reddot.
- militia: scopemount + hunting scope, recoilpad, bipod, sling.

---

## 6. Loot, trade, factions, crafting, AI, KITS

**Loot (agent C, `loot.js`):** own-dice tables, following the arrows pattern.
- `SITE_AMMO` / `AREA_AMMO`: entries `[chance, [boxKey, weight]…]`.
  - Gun store: hp, sp, slug, bird, subsonic.
  - Police armory: 9mm hp, slug, 5.56 fmj boxes.
  - Military armory and barracks: 5.56/.308 ap, tracer, match; .50 ball 0.02.
  - Lodge and cabin: sp, slug, bird.
  - Farmhouse: bird, slug, .22.
- `SITE_MODS` / `AREA_MODS` the same way.
- `ITEM_TAGS` for every new key, so `tools/loottest.js` passes its tag audit.
- Rare guns go into AREAS `gear` with the chances in section 3.

**Bodies (agent A):**
- `inventory.js enemyBody` (people): the existing `add("ammo", 3–10)` stays as is, for stream stability.
- On own dice (`hash01(seed, "ebody", u.id)`): a typed box of `u.load` when it isn't common. Count = the rest of the magazine (`u.mag`) + spare magazines (soldiers 0–2, others 0–1) × cap. Common loads add to generic ammo instead.
- Spare magazine *items* come in section 15.
- `deadsoldiers.js BODY.sup`: soldier dead get `a_556_fmj`/`a_556_ap` boxes marked `cond: "old"`.

**Trade:** boxes use cat `ammo` and mods cat `gunmod`, so TRADE_PREFS already apply (military ammo 1.3, raider 1.25, commune 0.8). Merchants add 1–2 boxes and 0–1 cheap mods to `visitors.js` wares (`TRAVEL_GEAR`).

**Crafting:** typed ammo comes from the reloading bench (section 12). Mods and guns in `crafting.js CRAFTS`:
- bottlecan (`gearIn` bottle, field)
- solventcan
- scrapscope (`gearIn` monocular, scrap 2)
- recoilpad (scrap 1, wood 10)
- sling (scrap 1)
- sawnoff (`gearIn` dbshotgun, Mechanics 1, 1 h)
- spear

**Autopilot and AI:**
- `ammo.js pickLoad(b, u)`:
  - Scores each type it has as mean (dmg × expected through-armour) over aware visible foes.
  - Keeps AP, API and slugs for foes with AC ≥ 3 or armoured ztypes. Otherwise HP/SP against soft targets.
  - Ties go to common.
  - Called by `aiUnit` (both sides; enemies have one type) only when reloading an empty magazine, or when an armoured foe is in sight and the loaded type is soft and the magazine is ≤ half.
- Departure packing: `parties.js launchExpedition` gets `packRounds(home, members)`. It packs boxes matching each member's calibre and `item.load` from the armory into pockets and pack, up to 1.5 kg a head. One line; it covers player and autopilot launches.
- `world.js combatPower`: a `common: false` gun with no matching rounds carried counts × 0.3.

**Enemy ammo by faction (`KIT_AMMO` in `data-ammo.js`), weights by calibre class:**

| kit | pistols | rifles | shotguns |
|---|---|---|---|
| soldiers | fmj .8, hp .2 | fmj .6, ap .35, tracer .05 | buck .7, slug .3 |
| raiders | fmj .55, hp .35, plusp .1 | fmj .75, sp .15, ap .05, tracer .05 | buck .7, slug .1, bird .2 |
| guards (police) | hp .8, fmj .2 | fmj .7, ap .1, sp .2 | buck .6, slug .4 |
| militia | fmj .7, hp .3 | sp .7, fmj .3 | slug .5, buck .4, bird .1 |
| survivors | fmj .8, hp .2 | sp .5, fmj .5 | buck .6, bird .3, slug .1 |
| zealots, fighters | as raiders, no AP | | |

- Rolled in `enemyUnit` on own dice (`hash01(seed,"eload",b.id,n)`).
- Effect on you: `hit.ammo` feeds the section 17 penetration roll, so a soldier's 5.56 AP gets through your ceramic plate 25% of the time against 3% for FMJ.

**Enemy label (ui/combat.js, agent D):** `enemyGunLine(u)` gives e.g. "Soldier 3 · Assault rifle (4× scope, suppressor) · 5.56 AP".
- Parts are shown when the enemy is in sight.
- Ammo is shown once they've fired within sight (`u.ammoSeen`) — pick-list P5 offers "always show".

**Starting colonists:** `ammo.js starterLoad(rng, item)`, called right after gunmods' `randomStarterMods` in the same call site. It sets `item.load` and stows a box. **Never AP, API or match.**
- Pistols: 80% common, 20% HP + 20 rounds.
- Revolver: 85% / 15% HP (12).
- Shotguns: 70% buck, 15% bird (10), 15% slug (5).
- Hunting and lever rifles: 60% common, 40% SP (10).
- .22: 70% / 30% HP (50).
- 5.56: common only.

---

## 7. File ownership, order, tests

Rule: **one owner per file per wave.** Shared edits are the Phase 0 merge lines only.

**Phase 0 (lead):** merge gunmags and gunmods; create stubs `data-guns.js`, `data-ammo.js`, `data-gunmods.js`, `data-kit.js`, `ammo.js` (neutral API), `gunstats.js`, `armour.js` (stub returning today's `armorMult`); add `cal`/`rel` to existing WEAPONS; add the count-stack fields to `valuation.js itemValue` and `inventory.js itemKg`; run the full suite.

**Wave 1 (4 agents in parallel):**
- **A, ballistics engine.** Owns:
  - New: `ammo.js`, `gunstats.js`, `armour.js` (sections 2 and 17), `data-ammo.js` (calibres, types, boxes, KIT_AMMO).
  - In `combat.js`, functions only: spendRounds, canFire, reload, fireRefusal, fire, hitMult, damage, playerUnit, enemyUnit, refitUnit, createBattle/createRaid box sources, endBattle sweep, `wearFielded`, `aiUnit` reload/unjam/pickLoad, `autoRaidTurn` unjam, plus jams (section 14).
  - Also: `deadsoldiers.js`, `middead.js bonebackMult`, `carriers.js swarmArmor`, `stealth.js shotNoise` (one line), `inventory.js enemyBody`/`armorMult`/`itemArmor`, `world.js combatPower`, `parties.js` (packRounds line), `breakoff.js` (off-screen armour wear).
  - Tests: `tools/ammotest.js`, `tools/armortest.js`, `tools/jamtest.js`.
- **B, roster content.** Owns `data-guns.js` (GEAR, WEAPONS, KIT_PATCH for guns, melee and launcher data), `data.js` LOCATIONS gear lines, the `combat.js` AREAS gear arrays (block at lines 3323–3361), `combat.js strike` and the `"melee"` case, the enemy AP-reset line for stagger, a bleed tick, `stealth.js CLUB`. Test: `tools/rostertest.js`. Re-runs `fighttest.js`, `combattest_sweep.js`, `calibrate.js`.
- **C, economy.** Owns `data-gunmods.js` content (if the gunmods agent has finished), `gunmods.js` platform, fit and nest logic plus starter and enemy pools, `loot.js`, `crafting.js`, `buildings.js` (reloading bench), `production.js`, `trade.js` tables, `visitors.js` wares, `data.js` TRADE_PREFS and the SUPPLIES additions (section 10), `vehicles.js repair` (car parts), `economy.js SCAV_FIND`. Tests: `tools/gunmodtest.js`, `tools/partstest.js`, `tools/reloadbenchtest.js`; updates `loottest`, `crafttest`, `tradetest`.
- **D, UI.** Owns new `ui/gunbuilder.js` and `ui/gunart.js`, `ui/sprites.js` (export a sized painter; `drawWeapon` looks), `ui/inventory.js`, `ui/combat.js`, `ui/ui.js` (modal route), `main.js` (action registration), `ui/keymap.js`, `ui/codex.js`, `ui/production.js`. Test: `tools/gunbuildertest.js`; updates `battleuitest`, `uitest`, `invtest`.

**Wave 2 (after A and B merge):**
- **E, carry kit.** Owns rigs, plates and magazine items (sections 15–17): `inventory.js` (slots, locations, moveItem, fitReason, ensureInv migration), `load.js`, `kit.js`, `data-kit.js`, the `combat.js playerUnit` mob line and the magazine source in reload (coordinate with A). Tests: `tools/rigtest.js`, `tools/magtest.js`.
- **F, launchers.** Owns `throwables.js` (landEffect blast override, arming, backblast), the `combat.js` `"launch"` act, `siege.js` AI rockets, launcher data via B's file. Test: `tools/launchertest.js`.
- **D continues** with UI for rigs, magazines and launchers.

**Wave 3 (after miltrucks lands):**
- **G, vehicle upgrades.** Owns `vehicles.js` upgrades, `combat.js` vehicle hooks, ambush odds in `byNumbersOdds`/`crossing.js`. Test: `tools/vehupgradetest.js`.

**Merge order inside a wave:** B → A → C → D. Every agent runs: `node tools/simtest.js`, `dettest.js`, `savetest.js`, `savecorpustest.js`, `typechecktest.js`, `combattest.js`, `fighttest.js`, `invtest.js`, `loottest.js`, `tradetest.js`.

**What each test checks (headless, printing passed/failed):**
- **ammotest:**
  - A common load gives exactly today's numbers (same seed, same battle result).
  - Typed boxes deplete in order and empties are swept.
  - Reload with another type spends 1 action.
  - `roundsOf` cache invalidation.
  - `.50` refuses to fire on common ammo.
  - `starterLoad` never gives AP.
  - Enemy typed drops match `u.load`.
  - Item value and weight are linear in count.
- **armortest:**
  - The penetration table in section 2 to ±1%.
  - Calibration: mean damage multiplier of FMJ against vest/plate is within ±0.05 of today's 0.88/0.76 — or the documented new target.
  - Ceramic shatters after the threshold; steel doesn't.
  - Repair lowers max durability.
  - Migration from quality to durability.
  - Armoured-dead `plateDur` drops and their body loot quality equals it.
- **jamtest:** 100k simulated shots per configuration land in their ranges (section 14); unjam action costs; AI clears jams.
- **rostertest:** every WEAPONS key has GEAR, cal, platform and sprite look; caps by platform; KITS keys valid; every new item has a loot source.

---

## 8. Risks and balance (pick-list for the user)

| # | Question | Options |
|---|---|---|
| R1 | Ammo storage | **Generic ammo plus typed boxes (recommended)** vs full per-calibre migration (72 files, 84 tools) |
| R2 | Per-hit armour (section 17) | Makes armour stronger against pistols and buckshot and weaker against rifle AP than today's flat 6%/point. Re-run `calibrate.js`; `ODDS` (`winOdds`) may need refitting. Choose: accept / tune blunt values to match today's averages / keep the flat model for by-the-numbers fights |
| R3 | Calibre pen vs worn armour | Rifles now beat vests: plate takes ×0.81 from 5.56 FMJ against ×0.76 before. On or off? |
| R4 | Melee reach 2 | Touches `adjacent` in the AI. On for spears only, or off? |
| R5 | Quick melee | One strike plus a move (proposed), or two strikes at −10 aim? |
| R6 | .50 BMG | Overpenetration (hits a second unit behind, 50%)? Fire on walls and doors? |
| R7 | LMG suppression (a near miss pins: −10 aim, no overwatch) | Yes / no |
| R8 | Typed rounds in by-the-numbers fights (AP against soldiers ×1.05) | Yes / no |
| R9 | Hunting uses `item.load` boxes (SP +10% big game, birdshot ×1.3 small) | Yes / no |
| R10 | Enemy ammo label | Shown after they fire, or always? |
| R11 | Starter extras | Starter rng draws come from gunmods' stream; new runs differ from old seeds |
| R12 | AK burst | Burst (ammo 2) or semi (ammo 1)? |
| R13 | Reload from a backpack costs 2 actions | Mags only (proposed), or also throws and meds (a nerf to today)? |
| R14 | Jams | Can cost a turn at a bad moment; an "Easy" toggle halving jam odds? |
| R15 | Launchers | Rocket noise and blast against your own walls during base defence: should AI raiders get RPGs at all? |
| R16 | Rigs | Add an EQUIP slot (31 references); is migration risk acceptable now? |
| R17 | Weight-based battle movement | Heavy kit makes armoured raiders and soldiers slower too — an intended nerf to enemies? |

---

## 9. Gun builder screen

**Where it opens:**
- `ui/inventory.js selBar`: a **Modify** button when the selected item is a ranged weapon.
- The weapon slot box in `doll`: a right-side "⚙" on the gun tile.
- The armory tile list.
- Not during a battle (`state.combat`); the raid search window is read-only.
- State: `ui.gunb = { loc, slot, hover }`, where `loc` is an inventory location string ("s:12:weapon", "armory:3:list:5", "cargo:7:list:2"). `ui.js pickModal` returns `["gunb", () => gunBuilderModal(state, ui)]` just before the `ui.inv` line, so it opens over the inventory.

**The drawing (`ui/gunart.js`):**
- `sprites.js` exports `painter(w, h)` and `toCanvas(p, up)`, with today's GW/GH as defaults (two-line refactor).
- Gun art uses a 64 × 24 pixel grid, upscaled ×8, with the same outline and palette as `drawWeapon` (metal `#9aa3ab`, gun `#2b2e33`, wood `#7a5230`).
- `PLAT_ART[platform] = { paint(p), anchors: { optic:[x,y], muzzle:[x,y], mag:[x,y], under, stock, grip, rail, tactical, bipod, sling, mount } }`.
- Parts are drawn as layers through `PART_ART[look](p, anchor)`. Looks: irons, reddot, holo, scope4, scope9, scope25, thermal, can_s, can_l, brake, comp, choke, oilfilter, bottle, stick10/20/30/40, drum, belt, tube_ext, stock_fixed / collapsible / precision / fold / pad, vgrip, agrip, light, laser, peq, bipod, sling, m203, rail, mount.
- Each mod has a `look` field. The image is cached by platform plus fitted looks (`cached` in sprites).

**Layout:**
- The canvas is `<img>`, about 512 × 192 px, centred.
- Slot boxes sit in two lanes: top lane for optic, mount, tactical, rail; bottom lane for muzzle, mag, under, grip, stock, bipod, sling. They are sorted by anchor x.
- An inline `<svg>` overlay draws `<line>`s from each anchor (scaled) to its box.
- Nested slots (from `adds`) appear only when their parent is fitted, with a dotted line from the parent's box.
- Each box shows the fitted part's name and a mini stat delta, or "empty socket".
- **Click a box:** a list of compatible parts, collected from the holder's pockets and pack, others present at the same place, and the place's storage (`storageFor(state, personPlace(holder))`). Each row shows deltas and "Fit"; plus a "Remove" row.
- **Hover a row:** the stats panel shows before → after.

**Stats panel** (from `gunStats(item)` and `gunStats(withMod(item, slot, cand))`):
- aim, close, best range / falloff, damage lo–hi (with the loaded type)
- magazine (fitted mag item, section 15), noise (× and earshot tiles)
- weight, worth tier (never a number), **reliability** ("jam 0.5% a shot · ~1 in 200"), and penetration of the loaded type
- an Ammo dropdown setting `item.load`

**Sim calls** (`gunmods.js`, owned by C):
- `fitAt(state, gunLoc, slot, partLoc)`: checks `fitsSlot`, takes the part from its location (inventory.js `itemAt`/`moveItem` internals), puts it in `gun.mods[slot]`, and returns a message.
- `stripAt(state, gunLoc, slot)`: children first; parts go to the holder's storage, else a pocket or pack, else refused.
- No time cost (pick-list: 1 work-minute).

**Interaction with the gunmods worktree:** its fit/remove UI doesn't exist yet. Agent D builds this screen as the **only** fit UI; the gunmods agent should expose `fitMod` / `stripMod` (item-level) and stop there.

**Test `tools/gunbuildertest.js`:**
- Every weapon key has a platform and art.
- Every anchor is on a painted pixel (`p.px`, headless) or within 2 px.
- The modal HTML has one box and one `<line>` per available slot; nested slots appear and disappear with their parent.
- Fit and strip round-trip the part between armory and gun.
- Displayed stats equal `gunStats`.

---

## 10. Splitting "parts" into kinds

**Recommendation:** the key `"parts"` stays and is **renamed to "Machine parts"** in `SUPPLIES.name`. Every building, generator, station, breakdown and relay cost reads it unchanged. Add three supply keys: `carparts`, `gunparts`, `electronics`. Kinds stay bulk supplies (unlike ammo boxes) because they are recipe inputs in `cost` / `in` objects.

| key | name | value | kg | cat (existing) | used for |
|---|---|---|---|---|---|
| parts | Machine parts | 8 | 2 | parts | buildings, generators, wells, stations, breakdown repairs, machine shop (unchanged) |
| carparts | Car parts | 7 | 3 | vehicle | `vehicles.js repair` (1 car part, or 2 machine parts as fallback); miltruck field repair from team cargo; vehicle upgrades; garage builds |
| gunparts | Gun parts | 10 | 0.5 | gunmod | gun repair (+0.2 quality per part, Mechanics 3, cap 1); mods (solventcan, mounts); reloading bench build and dies; pipegun (2 parts → 1 gun part + 1 machine part, optional) |
| electronics | Electronics | 12 | 0.3 | electronics | new: weapon light, laser, PEQ, NVG/thermal repair, hand radio; optional: radio station 6 parts → 3 parts + 3 electronics |

**Migration:** none needed. Old "parts" are machine parts; the new kinds start at 0.

**New supply keys need entries in:** `trade.js REF / RESERVE / LOT` (or a `SUPPLIES[k].trade` fallback), `jobs.js DELIVER_CAP`, `types.d.ts`, `ui/inventory.js SUPPLY_ICON`, the ledger. Everything else loops over `SUPPLY_KEYS` with `|| 0`.

**Finds with no new dice:** `sortParts(state, placeType, n, salt)` (C, in `loot.js`) splits a parts find already rolled into kinds by `PARTS_MIX[placeType]`:
- autoshop, gas, truckstop, wreck, roadcars, garage, motorpool: car parts 0.6
- factory, dam, workshop, warehouse, quarry: machine parts 0.8
- gunstore, police armory, military armory, barracks, milwreck: gun parts 0.6
- radiotower, univ lab, office, control, airport hangar, newswreck, mall: electronics 0.6
- elsewhere: machine parts 1

Called where parts are found: `scavenge.js searchHour`, `combat.js searchBox`, `economy.js` SCAV_FIND, deadsoldiers body, events.

**Factions:**
- TRADE_PREFS by existing category: vehicle (expansionist 1.6, raider 1.3, military 1.2), gunmod (military 1.3, raider 1.2, commune 0.6), electronics (military 1.5, traders 1.2, zealot 0.6), parts (fortress 1.4, expansionist 1.35).
- **The AI groups keep one generic count.** `trade.js groupStockKey(k)` maps part kinds to `f.stock.parts`. Their offer splits it by `KIND_MIX[type]` (military: electronics 0.3, gun parts 0.3, car parts 0.2). Buying a kind from them takes from `f.stock.parts`.

**Salvage:** a "Salvage" action next to "Break down for firewood" (`inventory.js salvageInfo`/`salvageAt`, plus `ui/inventory.js` buttons).
- Guns: floor(value/30)+1 gun parts + 1 scrap.
- Mods: 1 gun part if value ≥ 25.
- Phone, camera, console: 1 electronics. Laptop 2; NVG and thermal 3–4.
- Vehicles: "Strip for parts" at a base (`vehicles.js stripVehicle`): 3–8 car parts by condition, 20 scrap, its fuel; the vehicle is gone.
- Buildings: the existing demolish half-refund.

---

## 11. Vehicle upgrades (after miltrucks)

**Data:** `v.upgrades = { glass: 0|1, plating: 0|1|2, turret: null | { gun: "lmg"|"m2hb", item, mag } }`, with a table `VEH_UPGRADES` in `vehicles.js`. Building one is a garage job: a production queue entry, or a `crafting.js`-style vehicle recipe owned by G.

| upgrade | cost | hours, skill | weight / travel | battle | map |
|---|---|---|---|---|---|
| glass (Bulletproof glass) | car parts 4, scrap 12 | 16 h, Mechanics 5, garage | +120 kg payload | riders hit through windows (if miltrucks exposes riders or lets them fire out) take ×0.35 from pen ≤ 30, ×0.8 from pen ≤ 45, full above | ambushes on the road: enemy first-strike bonus ×0.85 |
| plating ×1 / ×2 | car parts 6, machine parts 2, scrap 40 per level | 24 h, Mechanics 6 | +250 kg a level, fuel ×1.15 a level, speed ×0.95 a level | vehicle cells give full cover (2); ramming and blast wear ×0.6 a level (`RAMMING.WEAR`, `settleVehicle`); rockets ×0.6 | `breakdownChance` ×0.8 a level |
| turret (trucks: truck, miltruck, hummer, van) | the MG item itself (lmg or m2hb, consumed into the mount; returned on strip), gun parts 3, car parts 2, scrap 15 | 20 h, Mechanics 7 | +60 kg (lmg) / +90 (M2) | a rider set as gunner (`u.gunner`) fires the turret from the vehicle cell: WEAPONS `turret_lmg` (lmg stats, aim +6 mounted, cap 200) or `turret_m2` (m2hb stats, pen 70, noise 6, cap 100), feeding from generic 5.56 or .50 boxes; the gunner is exposed at half cover (full with plating 2) and is the only rider who can be shot | `byNumbersOdds`: `mine += 4` (lmg) / 6 (M2) when the team rides; the enemy's ambush bonus (`THEY_AMBUSH`, the ×1.4) is cancelled; very loud: +Heat (`fieldheat.js`) on any fight |

- **Pre-fitted:**
  - Military and convoy vehicles: plating 1, glass 1, M2 turret 40%.
  - Raider technicals (pickups): lmg turret 50%, plating 0–1 (scrap).
  - Rolled on own dice when miltrucks creates owned vehicles.
- **Strip:** returns the MG, half the car parts and all the glass.
- **Rockets** (section 13) are the counter.
- **Save:** missing `v.upgrades` means `{}`.
- **Test** `tools/vehupgradetest.js`: costs, weights through to `vehicleCapacity`/fuel, gunner fire, odds bonus, strip refund.

---

## 12. Reloading bench

**Building:** "Reloading bench" **upgrades the existing Ammo bench in place**, using the hospital family/tier/upgrades pattern in `buildings.js`.
- Cost: machine parts 1, gun parts 3, scrap 20; 24 h; Mechanics 3 to build.
- Station `reload`, one operator, skill **Mechanics**.
- When its queue is empty it keeps making generic ammo exactly like the old bench (3 scrap → 8 a day), so the ammo economy doesn't change.
- Quiet: Heat ×0.25 of other stations.

**Inputs** are count-stack items, not new supplies (no trade-table blast):
- **Brass and hulls** (`brass`, a bag of 100, 1 kg, value 8). After a won tactical battle, about 60% of your side's fired rounds come back as brass into `pools[0]` (as with arrows; revolvers 100%); none after a loss or retreat. Also found at gun stores and ranges.
- **Powder** (`powder`, a 1 lb can, enough for 100 pistol / 40 rifle / 60 shotgun loads, value 20). Looted at gun stores, lodges and ranches. Craftable at the bench as **black powder**: firewood 90 + scrap 1 + food 2 ("saltpetre from the latrine"), Mechanics 4. Black-powder loads: jam ×1.5, noise +1, smoke.
- **Primers** (`primers`, a box of 100, value 15). Rare loot only (gun store 0.08 a search hour, military). Optional craft: match-head primers, Mechanics 8, misfire ×3.
- **Lead** is scrap (wheel weights): 1 scrap per 20 bullets.
- **Gun parts:** the bench's dies, plus 1 gun part per 500 rounds made (wear).

**Recipes** (per operator-day, +4% per Mechanics point; each 10 rounds use 10 brass + 10 primers + powder + 0.5 scrap):

| output | min Mechanics | per day |
|---|---|---|
| FMJ pistol (generic ammo) | 2 | 40 |
| FMJ rifle / SP | 3 | 25 |
| buckshot / birdshot / slug (hulls, lead) | 1 | 25 / 25 / 15 |
| HP | 5 | 30 |
| subsonic | 6 | 25 |
| match | 9 | 15 |
| AP | 10 | 10, also needs 1 machine part per 20 (steel cores) and a Machine shop at the base |
| .50 BMG | not craftable (pick-list: Mechanics 12, .50 brass from fired .50, 4× powder) | |

**Quality:**
- Boxes are typed and marked `cond: "hand"`, with `hq = 0.6 + 0.03 × Mechanics` (max 1).
- Jam ×(2.5 − 1.5×hq).
- Aim −1 below Mechanics 8.
- FMJ handloads go into generic ammo (quality-less), so the economy sees them.

**UI:** `ui/production.js` gets a recipe list grouped by calibre with type rows (inputs per 10, rate, skill lock) and standing "keep at least N rounds" orders, using production.js orders counting rounds of the box key in the armory.

**Autopilot:** if a bench exists, keep at least:
- 100 HP of the base's most common pistol calibre
- 25 slugs if any shotgun
- 60 AP of the main rifle calibre once soldiers or armoured dead have been met
- otherwise generic

**Owner:** C (`buildings.js`, `production.js`, `economy.js` station run, `crafting.js` black powder); D does the UI. Test `tools/reloadbenchtest.js`: upgrade keeps the generic output; rates, skill gates, input draw, brass pickup after a win only, handload jam factor.

### 12.1 As built (branch `w2-bench`, wave 2 agent C2)
- **Files.** New `src/sim/reloading.js` (RELOAD numbers, the upgrade, orders, the day's job, handload makes, brass, the governor, the other groups, merchants) and `tools/reloadbenchtest.js`. Data in `data-ammo.js` (LOAD_CLASS, LOADS, POWDER_PER10, RELOAD_FX, HAND_SUPPLIES / HAND_GEAR, RELOAD_SUPPLIES, RELOAD_GEAR). One-line hooks elsewhere.
- **Building.** `reload_bench` upgrades one ammo bench where it stands (the bunkhouse → barracks `from` + `target` pattern, not `family`: a base may have 3 ammo benches, and a family would merge their plots). Still an `"ammo"` station: with no order it can work it runs the ammo bench's recipe and its station order unchanged. `heat: 0.25` (mannedStations is now a weighted sum).
- **Inputs are supplies** (`brass`, `powder` in charges, `blackpowder`, `primers`, `matchprimers`), like rounds: a station recipe draws stock, a battle's pools take brass back as they take arrows, trade prices them by key. Their item forms (bag / can / box, count stacks of 100) are the loot (own dice: loot.js SITE_RELOAD / AREA_RELOAD, rolled separately so older finds are unchanged) and are opened into the stock at a base (ammo.js unbox). One generic brass (tracked by calibre only for the log).
- **Handloads are their own supply keys** `a_<cal>_<type>_hand` (25: every loadable calibre/type; no .22 LR rimfire, .50, tracer, +P, less-lethal). A key travels with the rounds through every stock, pack, cargo, trade and pool with no extra plumbing; a gun loaded with a type fires both (rounds.js withHand: factory first, then handloads, in each holder). FMJ / 00 buck loaded with smokeless powder and factory primers go into the factory key. The make of each hand key (hq, black-powder share, match-primer share, share loaded below Mechanics 8) is a colony-wide average in `state.handloads`; the battle copies it (`b.handQ`) and `noteHandLoad` sets `u.loadCond/loadHq/loadBp/loadMp/loadAim` for the round fired next (gunfire.js rollTrigger and each action). Rejected: a per-key hand share on each stock record (every transfer would have to carry it).
- **Numbers.** Rates and Mechanics as the table (+4%/point); per round 1 brass, 1 primer, powder 1 / 2.5 / 1.67 charges (pistol / rifle / shotgun), ceil(n/20) scrap, AP ceil(n/20) machine parts + a machine shop; a gun part per 500 rounds. Black powder: firewood 90 + scrap 1 + food 2 → 100 charges, Mechanics 4, at a reloading bench; match-head primers: scrap 1 → 50, Mechanics 8. Jam × (2.5 − 1.5 hq) × (1 + 0.5 bp) × (1 + 2 mp); aim −1 × lo; black powder +1 noise. Brass: 60% of fired rounds (revolvers 100%) after a win (raids: extracted from a cleared site).
- **Governor.** Orders (by "ai"): 100 HP of the main pistol calibre, 25 slugs with a shotgun, 60 AP of the main rifle calibre once an armoured enemy was met (`state.metArmour`, noted at a battle's end). Upgrades an ammo bench once it holds 100+ brass, powder and primers and 6+ gun parts. Buys powder and primers below 300 (needs 1.4 / 1.9), keeps them with an ammo bench, sells them with neither.
- **Pulling rounds** (user, 2026-10-08). Pull orders (`base.reload.pulls`: "pull this round key down to N", any calibre, factory or handload) are worked when the bench has nothing to load: 60 rounds a day (+4%/Mechanics, Mechanics 1); a round gives its case, its charges (pistol 1, rifle 2.5, shotgun 1⅔, .50 BMG 10, .22 LR 0.3), 80% of a primer (none for rimfire, no case either) and a scrap per 20 bullets (carried in `reload.lead`). The governor pulls every round key of a calibre no gun at the base (or on a team from it) shoots down to 20 (a trade reserve); the parts feed its own load orders. A group with a workshop and under 100 brass pulls the share of its one ammo count that its kind's calibre mix has in calibres none of its arsenal's guns shoot (2% of it a day, at most 30, keeping 10 a head).
- **Other groups.** Brass from their fights (30% of rounds spent); with a workshop they load up to min(40, 1.2/head) rounds a day into `f.stock.ammo`; with 30+ brass and short of powder/primers they buy from a traders or military group (scrap, at most half their spare) every 10 days; traders and military groups restock powder and primers to sell. Arms-dealer merchants carry 100–300 powder and 100–400 primers.

---

## 13. Grenade launchers and rockets

**Weapons** (B data, F logic; all military loot):

| key | name | type | cap | kg | value | req | found |
|---|---|---|---|---|---|---|---|
| m79 | Break-action grenade launcher | standalone, `launcher: "40mm"` | 1 | 2.7 | 180 | shooting 6 | military armory 0.01, milwreck, soldier dead 0.01 |
| m203 | Underbarrel launcher | `under` slot on ar15 | 1 | 1.4 | 160 | 6 | military, soldiers' ARs |
| m32 | 6-shot revolver launcher | standalone | 6 | 5.3 | 400 | 8 | military 0.002 |
| at4 | Single-shot rocket tube | `oneShot` (the tube is the round; fired, it becomes "spent tube" junk) | 1 | 6.7 (bulky) | 300 | 4 | military 0.003, convoy trucks |
| rpg | Reloadable rocket launcher | `launcher: "rocket"` | 1 | 6.3 (bulky) | 350 | 8 | military 0.002, raider armory rare |

**Rounds** (count-stack boxes, not common):

| round | effect | kg | value |
|---|---|---|---|
| 40 mm HE | `GL_HE = { r: 1.5, dmg: [24,34], struct: [35,50], wake: 14, noise: 4 }` | 0.23 | 15 |
| 40 mm buck | a shotgun shot at a unit, 28–40, opt 3 | 0.23 | 8 |
| 40 mm smoke | `SMOKE` | 0.23 | 10 |
| 40 mm illumination | `FLARE` r 7 | 0.23 | 6 |
| rocket | `ROCKET = { r: 2, dmg: [55,80], edge: [30,45], struct: [180,260], vehicle: 70, wake: 22, noise: 6 }`; Heat +15 on a raid | 2.6 | 60 |

**Firing:** a new `combatAct` `"launch"` targets a cell.
- 40 mm reuses `throwBlind` / `throwLanding` / `scatterChance`, with `T = { scatter: −15 }` (better than a throw), range 20 (m79) or 16 (m203). Arcs over walls like a throw.
- Rockets need LOS, range 14.
- `landEffect(b, u, T, x, y)` gets `T.blast` as the blast table: one line, `const B = T.blast || (T.fx === "frag" ? FRAG : BLAST)`.
- A rocket's `wreck` also breaks gates and walls, rams (`siege.js`), and the battle vehicle (`settleVehicle` wear +70, ×0.6 per plating level).

**Arming and safety:**
- **Arming:** HE and rockets don't explode closer than 3 tiles; they hit as a slug (15–25 on the unit, no blast).
- **Backblast** (rockets): units within 2 tiles behind the shooter (±45°) take 10–20. Firing from an enclosed interior cell: the shooter takes 8–14 and loses their next action.
- **Reload:** 1 action; a launcher holds 1 (m32: 6).

**Enemies:**
- Soldiers: an m203 on 1 in 8 ARs with 2–4 HE; an RPG 1 in 20 battles at power ≥ 8.
- AI uses `blastSpot(b, u, range, r, { need: 3 })`, which already avoids its own side within r+1.
- New rules for the AI: never inside arming range; never with a friendly in the backblast cone; rockets also take siege targets or your vehicle (need 1).

**Test `tools/launchertest.js`:** arming range dud, backblast, struct damage breaks a gate, blast avoids the AI's own side, indirect fire over a wall, AT4 consumed.

---

## 14. Jams and malfunctions (owner A, inside gunmags' fire/canFire code)

**Per-shot jam chance:**
`jam = rel × fq × fa × fm × fw × fd`, capped at 12%.

- `rel`: platform base % (section 3).
- `fq` (condition): 1 + 2 × (1 − q). q is quality; makeshift guns use dur/maxDur. So q 0.7 → 1.6, q 0.4 → 2.2.
- `fa` (ammo): factory 1; handload 2.5 − 1.5×hq; old/salvaged 3.
- `fm` (mods): product of mod `jam` values (suppressors 1.2–1.4, drum 1.5, 40-round stick 1.15, oil filter 1.5).
- `fw` (weather): rain or mud 1.3, storm 1.5, outdoor battles only (`weather(state, hour, tile)`).
- `fd` (fouling): 1 + min(0.5, item.fouled / 400). `item.fouled` counts shots and is reset by cleaning.

Examples:
- New AR, factory ammo: **0.5%**.
- Worn pipe gun (20% dur left, fq 2.6) with poor handloads (fa 2.5): 1.2 × 2.6 × 2.5 ≈ **7.8%**.
- Revolvers, double-barrels, bolt, lever and pump guns **misfire** instead: the shot and its action are lost, with no jam state.

**Kinds** (gas and magazine-fed guns):
- 70% stovepipe: **Unjam**, 1 action.
- 25% double feed: Unjam 2 actions, or a Reload clears it (drops the magazine).
- 5% hard jam: 2 actions and −0.05 quality.

**Rules:**
- `u.jam = { kind, ap }`. `canFire` is false while jammed; `fireRefusal` says "Jammed (stovepipe): Unjam (J)". `combatAct "unjam"`.
- `aiUnit`, `autoPlayerTurn` and `autoRaidTurn` clear jams first, the same way gunmags handles `magEmpty`.
- Enemies jam too. Their `u.q` is rolled 0.4–0.85 on own dice and their dropped gun gets that same quality.

**Maintenance:**
- The armory's daily upkeep cleans guns (fouled → 0) when anyone is on the Operate or Craft roles; free.
- "Repair gun" uses gun parts (section 10).

**UI (D):** "JAMMED" badge on the unit card, an Unjam button and J hotkey, reliability in the gun builder and tooltip.

**Test (jamtest):** Monte Carlo per configuration within ±10% relative; unjam AP costs; the bot clears; misfire platforms never enter `u.jam`.

---

## 15. Magazines as items (wave 2, owner E; built on gunmags' counter)

**Recommendation: physical magazines, virtual rounds.** Magazine items decide capacity, how many reloads a fighter has, and which ammo type is loaded. The rounds themselves stay counted in the pools and boxes, as in gunmags (fired rounds leave the pools at the shot). This keeps `autoResolveCombat`, autopilot reserves and economy counts correct. Each magazine holds **one type** (no mixed stacking).

**Items:** `mag_<plat>_<cap>`, `{ mag: { plat, cal, cap }, small: true, count: false }`, instance field `item.load`.

| magazine | cap | kg (empty) | value |
|---|---|---|---|
| Glock 9mm | 15, 17, 33 | 0.07 / 0.08 / 0.18 | |
| 1911 .45 | 7 | 0.08 | |
| .22 | 10, 25 | 0.05 / 0.09 | |
| MP5 9mm | 30 | 0.12 | |
| STANAG 5.56 | 20, 30, 40, 60 (quad), 100 (C-Mag drum) | 0.1 / 0.12 / 0.15 / 0.4 / 1.2 | 4 / 6 / 10 / 25 / 70 |
| AK 7.62×39 | 30, 45, 75 drum | 0.33 / 0.4 / 1.3 | |
| AR-10 .308 | 10, 20 | 0.12 / 0.15 | |
| bolt .308 detachable | 5, 10 | 0.1 / 0.15 | |
| .50 | 10 | 0.5 | |
| M249 belt box | 100 | 0.4 | |

**Weight:** a loaded magazine weighs empty weight + cap × round kg (e.g. STANAG 30: 0.12 + 0.36 = 0.48). Loaded magazines count rounds from the pool, so the pool's share of those rounds' weight is moved to the person (`load.js` pool weight minus loaded-magazine rounds) — no double counting.

**Fitted magazine:**
- `gun.mods.mag` is a magazine item. A gun with none has an implicit standard magazine (`WEAPONS.cap`), for old saves and convenience.
- gunmods' extended-mag and drum "mods" **become magazine items** (gunmods is unreleased, so convert its data now; no save migration).
- Tube extensions stay mods (internal magazines).

**In battle:**
- `u.mags = [{ item, n, where: "gun" | "rig" | "pocket" | "pack" }]`, built in `playerUnit` from the fitted magazine plus spare compatible magazines carried. Each starts at `n = cap`, bounded by `roundsOf` in its own load type.
- **Reload:** the next loaded magazine; 1 action from rig or pocket, 2 from the pack. Choosing a magazine with another type switches `u.load` (this is the section 1 type-switch).
- The emptied magazine is retained by default (into the slot the fresh one came from). The optional fast drop (R13) leaves it on the ground: picked up after a won fight, lost otherwise.
- **No loaded spares:** "Top up" refills the fitted magazine for 2 actions.
- **Internal magazines** load round by round: Reload (1 action) adds pump 4, lever 4, bolt 3 (5 with a stripper clip), revolver 2 (full with a speedloader).
- Speedloaders (`speedloader`, 0.05 kg, value 6, cap 6) and stripper clips (`stripper308`) sit in rig or pistol pouches; each is used up once per battle and refilled free afterwards.

**Out of battle:** loading magazines is free and abstract. `parties.js packRounds` also packs magazines: up to 4 rifle or 3 pistol magazines a gun from the armory into rig, then pockets, then pack.

**Loot:** found guns come with 0–2 standard magazines (own dice); loose magazines through AREA/SITE tables. Enemies carry 1–3 (soldiers 3–5 in rigs), which drop with their load type set.

**Gun builder:** the mag slot lists compatible magazine items by platform and shows cap and load type.

**Test `tools/magtest.js`:** reload sources and AP costs, retention, top-up, internal-magazine increments, speedloader, implicit magazine for legacy guns, weights.

---

## 16. Rigs, tactical vests, plate carriers (wave 2, owner E)

**Slot model:**
- New EQUIP slot **`rig`** (`EQUIP_SLOTS`, `SLOT_NAMES.rig = "Rig"`, `ensureInv` adds `s.gear.rig = null`).
- A rig's pouches use the existing **`item.contents`** array, with kinds per index from `GEAR[key].pouches`. `itemLoad`, `itemValue`, `carriedKeys` and firewood breakdown therefore already include them.
- New location `"s:<id>:rig:<i>"`.
- `rigOf(s)` returns `gear.rig`, or the armor-slot item when it has `pouches` (tactical vest, plate carrier). Fitting a chest rig over a pouched armour piece is refused.

**Pouch kinds:**
- rifle: rifle magazines, stripper clips
- pistol: pistol magazines, speedloaders
- grenade: anything with `throw`, 40 mm rounds
- radio: radios
- admin: small items — meds, IFAK (bandage kit), canteen, flashlight, puritabs, ammo boxes ≤ 0.5 kg

| item | slot | armour | pouches | carry | kg | value | where |
|---|---|---|---|---|---|---|---|
| chestrig (new) | rig | – | 4 rifle, 2 pistol, 1 grenade, 2 admin | +2 kg | 0.8 | 30 | military, gun store, soldiers |
| tacvest (new) | armor | AC2 soft | 3 rifle, 2 pistol, 1 grenade, 1 radio, 1 admin | +2 | 3.2 | 70 | police, SWAT, guards |
| makeshiftrig (new, crafted: `gearIn` backpack + scrap 1) | rig | – | 2 rifle, 1 pistol, 1 grenade, 1 admin | +1 | 0.7 | 6 | raiders, crafted |
| plate (kept key) | armor | AC2 backer + inserts | 2 rifle, 1 pistol, 1 grenade, 1 admin; `inserts`: front, back | +1 | 1.5 empty | 60 + plates | military |
| vest (kept key) | armor | AC2 soft | none (a chest rig goes over it) | | 4 | 45 | as today |
| ceramicplate | insert | AC5, dmax 45, shatters | | | 2.5 | 40 | military, soldier dead (damaged) |
| steelplate | insert | AC4, dmax 80, patchable, spall | | | 3.5 | 25 | gun store, raiders; crafted (scrap 8, Mechanics 4) |
| softinsert | insert | AC2, dmax 35 | | | 1 | 15 | police, military |
| canteen (new) | pack/admin | holds 1 water for drinking first | | | 0.3 (+1 full) | 4 | |

**Battle speed:** rig pouches are 1 action. Pack is 2 for magazines (R13 decides whether that also applies to throws and meds).

**Carry and weight:**
- `carryBonus` adds `carryOf(gear.rig)` and the armour's carry.
- `itemLoad` adds `inserts`.
- A fully kitted soldier: carrier 1.5 + 2 ceramic 5 + helmet 1.5 + 6 STANAG magazines 2.9 + rifle with optic 4 + 2 grenades 0.9 + canteen 1.3 + IFAK 0.5 + radio 1 + pack 2 + contents ≈ **25–30 kg**.

**Battle movement:** today `mob` is fixed at `MOVE = 5` and `u.load` (armour power) only feeds `escapeOdds`. E changes `playerUnit` and `enemyUnit`:
- mob by **worn** kg band: Light ≤ 18 → 5, Medium ≤ 28 → 5 (dash −1), Heavy ≤ 38 → 4, Overloaded → 3.
- `u.load` becomes kg, so `escapeOdds` reads kg.
- Enemy soldiers in full kit move at 4.

**Search coverage:**
- `hunting.js carriedItems`, `stealth.js findCarried`, `kit.js hasOn`, `combat.js carriedKeys` and the throw/meds search must include rig contents.
- `inventory.allCarried(s)` becomes the one iterator; those four call sites switch to it.

**Autopilot and enemies:**
- `bulk.js equipBest` wears the best rig and carrier and fills inserts with the best plates.
- Enemies wear rigs: soldiers chest rig or carrier; police tactical vest; raiders makeshift rig 30%. Contents are magazines and grenades from `KIT_PATCH.rig` and drop with the body.

**UI:** a simpler slot list. A "Rig" column in the doll with one box per pouch, labelled by kind icon; insert boxes inside the carrier tile (front/back). No Tarkov grid.

**Migration:**
- `ensureInv` `INV_VERSION` → 2.
- Old `plate` items without `inserts` get 2 ceramic inserts at the item's quality. The carrier's own power becomes the backer's (AC2).
- `vest` is unchanged.

**Risks:** EQUIP slot plus `contents` semantics touch 31 + 90 references. `rigtest.js` must cover moveItem to and from pouches, fitReason, weights, packing, saves round-trip, and `invtest` and `raidtest` must stay green.

---

## 17. Per-hit armour durability (owner A: `armour.js`; E for inserts)

**Fields:**
- GEAR armour pieces get `ac` and `dmax` and a material: `soft | steel | ceramic | hard | padding`.
- Item fields: `ad` (current), `admax` (max after repairs), `broken`.
- **Lazy migration:** `ad = dmax × quality`; makeshift: `dmax × dur/GEAR.dur`.

| piece | AC | dmax | material | notes |
|---|---|---|---|---|
| vest | 2 | 40 | soft | |
| tacvest | 2 | 45 | soft | |
| softinsert | 2 | 35 | soft | |
| steelplate | 4 | 80 | steel | |
| ceramicplate | 5 | 45 | ceramic | |
| scrapvest | 3 | 60 | steel | |
| tirevest | 1 | 25 | padding | |
| sportspads | 1 | 20 | padding | |
| padding, shinguards | 1 | 12 | padding | |
| kneeguards | 1 | 15 | hard | |
| riotarms, riotlegs | 2 | 20 | hard | |
| bikehelmet | 1 | 20 | hard | |
| footballhelmet | 1 | 15 | hard | |
| riothelmet | 2 | 25 | hard | |
| milhelmet | 3 | 30 | hard | |

**Hit location** (cheap weighted roll in `damage` for people):
- Shots: torso 55, head 15, arms 15, legs 15.
- Melee and bites: torso 40, arms 35, legs 15, head 10.
- **Crits always hit the head.**
- Torso is covered by the carrier's front insert (back insert when shot from behind), else its backer, a vest or makeshift armour. Head by the helmet, arms and legs by their pieces.
- Uncovered locations take the HP/SP soft bonus.

**Per hit:**
- Penetration roll as in section 2. Durability loss = raw dmg × round `ad` × material (ceramic 1.3, steel 0.5, soft 1, hard 0.8, padding 1.5) / 10, × 0.5 if it penetrated.
- Bites and claws: `ad` 0.2 on plates and hard pieces, 0.8 on soft and padding.
- **Ceramic shatters** when `ad < 30% dmax` and a hit with pen ≥ 30 lands, or after 6 hits with pen ≥ 30. It then protects nothing; the log says "{name}'s front plate shatters!".
- **Steel** never shatters. A stopped rifle hit spalls 30% of the time: 3–6 damage to an unarmoured location.
- **Tough** trait stays a separate ×0.75.
- **Swapping a plate** in battle: 2 actions from the pack, 1 from the cargo next to the vehicle. At camp, free.

**Wear:**
- `wearFielded`/`wearSlot` stays for weapons and makeshift weapons only. For armour with `ac` it is replaced by per-hit wear.
- **By the numbers** (`autoResolveCombat`, `breakoff.js fightByNumbers`): each hurt person's armour takes `absorbOffscreen(s, dmg, enemyKind)`, a location-weighted durability loss of dmg × 0.6 × the enemy kit's typical `ad`.
- **Enemy armour wears too:** `u.pieces = [{ key, ac, ad, dmax }]`, and body loot carries the remaining `ad`.
- **Armoured dead:** `plateDur` (section 2).

**Repair** (a base workbench craft, C):

| piece | inputs | skill |
|---|---|---|
| soft armour | scrap 2 + a kevlar repair kit item (police and military loot, value 20) | Mechanics 3 |
| helmets and hard pieces | scrap 2 + machine parts 1 | Mechanics 3 |
| steel plates | scrap 4 + fuel 1 (welding) | Mechanics 3 |
| ceramic | cannot be repaired | |

- Each repair restores up to `admax` and lowers `admax` by restored × max(0.08, 0.25 − 0.01 × Mechanics).

**UI (D):**
- Durability bars (`ad/admax`, green / amber / red; "BROKEN") on doll slots, insert boxes and the battle unit card (front plate and helmet as small bars).
- Log lines: "Plate broken!", "{name}'s helmet stops it".
- An end-of-battle "Damaged gear" list.
- Tooltip: "AC5 ceramic · 32/45 · stops 5.56 FMJ 66%".

**Test (armortest, section 7):** plus a save round-trip of `ad`/`admax`, a check that the by-the-numbers wear path runs, and that the enemy loot `ad` equals the end state.

---

### Critical files for implementation
- C:\Dev\BrokenState\prototype\src\sim\combat.js (WEAPONS/KITS/AREAS, and gunmags' spendRounds/canFire/reload/fire/hitMult/damage/playerUnit/enemyUnit/aiUnit)
- C:\Dev\BrokenState\prototype\src\sim\data.js (GEAR, SUPPLIES, LOCATIONS, TRADE_PREFS; the Phase 0 merge line)
- C:\Dev\BrokenState\.claude\worktrees\gunmods\prototype\src\sim\gunmods.js (mods contract, platforms, fit/strip)
- C:\Dev\BrokenState\prototype\src\sim\inventory.js (enemyBody, itemKg/itemArmor/armorMult, EQUIP_SLOTS, ensureInv migration)
- C:\Dev\BrokenState\prototype\src\sim\deadsoldiers.js (MILDEAD armorVs)
- C:\Dev\BrokenState\prototype\src\ui\inventory.js and C:\Dev\BrokenState\prototype\src\ui\sprites.js (gun builder entry points, painter)
- Also: C:\Dev\BrokenState\prototype\src\sim\throwables.js (landEffect/blastSpot), C:\Dev\BrokenState\prototype\src\sim\buildings.js (ammo_bench → reloading bench), C:\Dev\BrokenState\prototype\src\sim\loot.js (own-dice tables), C:\Dev\BrokenState\prototype\src\sim\trade.js (REF/RESERVE/LOT), C:\Dev\BrokenState\prototype\src\sim\load.js, C:\Dev\BrokenState\prototype\src\sim\vehicles.js


---

## Sections 18 and 19: helmets and hearing, and gun safes and gun cases

**Name-alignment caveat.** I didn't write sections 0–17, so I couldn't check their exact names. This text uses the names from your briefs: AC (armour class 1–6), dmax / dur (durability points), the section 17 hit-location zones (torso / head / arms / legs), item.mods for fitted parts, the section 9 builder's platform slot-layout table, the section 10 part kinds (car / machine / gun / electronics), and the section 7 waves. Where the saved text uses different identifiers, rename to match. Everything below is checked against dev at d1fbfa6 and the gunmods worktree's in-progress gunmods.js.

---

## 18. Helmets, face shields, NVG mounts and ear protection (with deafening)

### 18.1 What exists today
- **Head slot.** `ARMOR_SLOTS = ["head","armor","arms","legs"]` (inventory.js:28). armorPower adds every piece's `power × (0.5 + 0.5·quality)`, capped at `ARMOR_CAP` 5.5. armorMult = `1 − 0.06·power`.
- **Helmets in GEAR (keys kept).**
  - bikehelmet: 0.7 power, 1.5 kg
  - riothelmet: 1.2 power, 1.8 kg, "with a visor"
  - milhelmet: "Combat helmet", 1.4 power, 1.5 kg (this is already the PASGT/ACH-style helmet)
  - footballhelmet: 0.4 power, makeshift, dur 10
- **NVG and thermal.** They only work from the off hand: stealth.js:148 and :592 `u.nvg = tool.key === "nvg" || "thermal"`.
- **Hearing.**
  - The only hearing rule is stealth.js detectRange: a person facing away detects at `STEALTH.BEHIND_DETECT` 0.5 of the range ("what they hear").
  - Shots raise `b.noise` and wake things through `alertNear` (combat.js fire).
  - The Nightmare scream (middead.js scream) panics people within `NM.RANGE` 6 unless they pass `hold = NM.HOLD 0.3 + nerve + NM.NEAR`.
- **Dead soldiers.** MILDEAD already gives them a milhelmet (35% on the body), and `armorVs` lets a crit bypass the armour ("a round under the helmet's rim").

### 18.2 Helmet roster (section 17 conventions: AC, dmax, per-hit wear)

| key | name | AC (crown) | dmax | kg | value | face | mounts | hearing muffle | where |
|---|---|---|---|---|---|---|---|---|---|
| hardhat (new) | Hard hat | 1, blunt and bites only, no ballistic | 15 | 0.4 | 6 | none | ears, light | 0 | hardware, factory, dam, quarry, workshop/warehouse areas |
| footballhelmet (keep) | Football helmet | 1 | 12 (makeshift) | 1.5 | 4 | built-in cage: bites and blows only | none | −1 | schools, lockers |
| bikehelmet (keep) | Motorcycle helmet | 1 | 20 | 1.5 | 15 | built-in visor: bites and blows only | none (full shell) | −2 | towns, garages, houses |
| riothelmet (keep) | Riot helmet | 2 | 30 | 1.8 | 35 | built-in riot visor: bites and blows; AC1 vs shots | light | −2 | police, prison, riot dead |
| milhelmet (keep) | Combat helmet (ACH) | 3 | 40 | 1.5 | 45 | none | nvg (shroud built in), light, ears (headset under the shell) | 0 | military, barracks, soldier dead |
| highcut (new) | High-cut ballistic helmet | 4 | 45 | 1.2 | 110 | ballistic visor slot | face, nvg, light, ears | 0 | military only, rare (barracks 0.015, milwreck 0.02, KITS soldiers 15%) |

- **power for armorPower.** Set it equal to `AC × 0.35`, so ACH is about 1.05–1.4 and high-cut 1.4. That keeps the head's share of the 5.5 cap modest.
- **Durability and saves.** Per-hit wear follows section 17. Save migration of quality to dur also follows section 17: `dur = round(dmax × quality)`.

### 18.3 Helmet attachments
They live in `item.mods` on the helmet, the same field the gunmods branch uses. That means itemLoad, itemValue and save already carry them, because gunmods extended inventory.js itemLoad and valuation.js itemValue to count `mods`. The mounts are face / nvg / light / ears, added to the section 9 platform table as `helmet:<key>` platforms.

| key | mount | effect | kg | value | fits | where |
|---|---|---|---|---|---|---|
| ballvisor (new) | face | AC3 face cover, dmax 25, breaks like ceramic ("Visor cracked!" → AC0 and −4 aim until taken off; cannot be repaired). Down: −2 aim, −1 sight; fogged (see 18.5) another −3 aim | 1.0 | 60 | highcut | military, rare (0.01) |
| riotvisor (new, loose) | face | Bites and blows to the face ×0.4; shots unaffected (AC1); dmax 20 | 0.5 | 10 | hardhat, highcut | police armory 0.06 |
| nvgmount (new) | nvg | Lets the nvg item sit on the helmet instead of the off hand (milhelmet and highcut have the shroud built in; this mount is for the hardhat only, a hobbyist rig) | 0.25 | 15 | hardhat | hardware 0.01, barracks |
| nvg (existing item, fitted) | nvg | Night vision exactly as from the off hand; the off hand stays free for a flashlight, med kit or radio. A helmet-mounted thermal is not allowed (it's a handheld monocular) | 0.5 | — | milhelmet, highcut, hardhat + nvgmount | — |
| helmetlight (new) | light | A hands-free light, like a flashlight (lights.js: sight 9, noticed +3); packLights counts it as carried | 0.1 | 10 | hardhat, riothelmet, milhelmet, highcut | hardware, police, barracks |
| earmuffs / eardef / commset (18.4) | ears | see 18.4 | — | — | hardhat, milhelmet, highcut | — |

**Slot conflict (the user's point).** Full-shell helmets (bike, riot, football) have no ears mount. With one on, only earplugs (a pocket item) work, so a riot cop under fire is deafened, while a high-cut helmet takes a headset. With no helmet, earmuffs, eardef and commset go in the head slot itself (power 0).

### 18.4 Ear protection and deafening

| key | slot | cut | HEAR | other | kg | value | where |
|---|---|---|---|---|---|---|---|
| earplugs (new) | pocket or pack, works from there | 3 | −3 | dur 6 battles (a strip of pairs) | 0.01 | 1 | gun stores, hardware, factory, SITE_FINDS |
| earmuffs (new, passive) | ears mount or head slot | 4 | −3 | — | 0.3 | 8 | gun stores 0.08, hardware, factory, dam, quarry |
| eardef (new, electronic) | ears mount or head slot | 4 | +2 | dur 30 battles; recharged by a craft that uses 1 batteries item | 0.35 | 30 | gun stores 0.05, police armory 0.04 |
| commset (new, military headset) | ears mount or head slot | 4 | +3 | Team link (below); dur 30, batteries | 0.4 | 70 | barracks 0.03, milwreck 0.03, MILDEAD soldier body 0.04, KITS soldiers 30% |

**Loudness of an event (bang).**
- A shot: `WEAPONS[w].noise × gunMods(item).noise`, × 1.5 indoors (`b.raid.interior`, building maps).
- Blasts: frag/pipebomb 5, 40 mm HE 5, rocket 7 (the backblast cone counts as d = 0).
- The .50 BMG uses its section 3 noise (~6); the truck turret burst is 4.
- The Nightmare scream: `NM.NOISE` 4.

**Exposure for each listener within 4 tiles.** `e = bang + (1 if they are the shooter) − 0.5·dist − cut(ear protection)`.
- **Deaf** if e ≥ 3.5: `u.deaf = min(3, u.deaf + (e ≥ 5 ? 2 : 1))` turns.
- **Dazed** if e ≥ 6: −10 aim for this turn and the next (`u.dazed`).
- `u.deaf` ticks down at the start of the side's turn (startPlayerTurn, and the enemy-phase start).

**Sanity check of the numbers.**
- An unprotected rifle shooter outdoors: e = 4, so deaf for 1 turn after each shot.
- 9mm outdoors: 3, nothing. 9mm indoors: 4, deaf.
- A teammate's shotgun indoors, adjacent: 4.5 + 0 − 0.5 = 4, deaf.
- .50 shooter: 7, dazed. Grenade 2 tiles away: 4, deaf.
- Suppressed rifle: 1.2 + 1 = 2.2, nothing.
- With muffs or plugs, every one of these drops below 3.5 except the .50 and rockets up close.

**HEAR (the new player-side hearing).**
- Base 6 tiles. Add the helmet muffle (table above) and the ear item's HEAR; it is 0 while deaf.
- `heardGhosts(b)`: an enemy that moved or shot this turn, is not seen, and is within HEAR of an active, non-deaf player unit gets a "heard" ghost marker. It extends the existing `b.ghosts`/enemyGhosts with a `heard` flag; the UI draws "?" with a sound arc.
- Today your side only knows what it sees. This is the payoff for ear protection, at the cost of slower full-shell helmets.

**What deafening does.**
- **Your people.**
  - No heard markers while deaf.
  - Nightmare scream: hold +0.15 with plugs or muffs, +0.2 with electronic (it clips loud sounds), +0.25 while deafened.
  - Dazed: −10 aim.
- **Enemy humans.**
  - In stealth.js detectRange the behind arc becomes `BEHIND_DETECT × hearMult(e)`, where hearMult = 0 while deaf (detect only from 1 tile), 0.75 with an electronic set, 0.3 with plugs or muffs.
  - So a shotgun blast indoors makes guards easy to take down from behind for a turn or two.
- **The dead** aren't affected.

**Commset team link.** If two or more of your units wear one, a linked unit gets +5 aim at a target that another linked unit also sees ("callouts"), and escapeOdds gets +5. Soldier enemies with commsets get the same.
- It isn't a map radio: radio.js stays with milradio and handradio. Making the commset count as a team radio inside 2 tiles of a milradio carrier is on the pick-list.

**Permanent hearing loss (off by default, a pick-list option).**
- `s.hearing` 1 → −0.02 per unprotected event with e ≥ 6.
- Below 0.85: HEAR −1. Below 0.7: HEAR −2 and a "Hard of hearing" status icon.
- No healing. A single `HEARING.PERMANENT = false` switch.

### 18.5 Face zone, bites, visor fog
- **Face zone.** Add FACE as a sub-zone of the section 17 head hit: of head hits, 0.35 go to the face and 0.65 to the crown.
  - The crown uses the helmet's AC and dur.
  - The face uses the face cover: ballvisor (AC3) or built-in or riot visors (bites and blows only); with none, full damage.
- **Bites and claws** (zombie melee) to the head:
  - With face cover: ×0.4 (riot or built-in) or ×0.3 (ballistic), 0.2 dur per bite.
  - Crown: AC-based per section 17, with bites barely wearing hard shells.
- **Dead soldiers' heads.** Their face zone is unprotected, so face-zone hits do full damage. Keep MILDEAD's crit bypass as it is (a crit is then "the face or under the rim"); no double counting, because armorVs already returns 1 on crit.
- **Visor up/down.** A free toggle in battle (`u.visorUp`): up means no face cover and no aim or sight penalty.
- **Fog.** At battle creation, `b.visorFog = weather(state, hour, tile).temp <= 0 || rain` (weather.js already returns temp and rain). A ballistic or riot visor that is down while `b.visorFog` is set costs another −3 aim.

### 18.6 Wiring, enemies and loot
- **New module src/sim/hearing.js:** `HEAR`, `bangOf(b, a, w)`, `deafen(b, x, y, bang, shooter)`, `hearRange(u)`, `hearMult(u)`, `heardGhosts(b)`, `earHold(u)`, `tickEars(b, side)`.
- **New module src/sim/helmets.js:** `HELMETS` (AC, dmax, face, mounts, muffle), `HELMET_ATTACH`, `helmetMods(item)`, `helmetFitReason/fitHelmetMod/removeHelmetMod`. Either copy the gunmods.js fitMod pattern or call a generic `mountFit` if section 9 created one.
- **GEAR rows.** Add them as one `Object.assign(GEAR, {...})` block at the end of data.js, like the hunting block at data.js:489, so they don't conflict with other agents' GEAR edits.
- **One-line hooks.**
  - combat.js fire, the doubletap path, and the section 13 launcher/turret fire paths: `deafen(b, a.x, a.y, bangOf(b, a, w), a)`.
  - throwables.js landEffect blast branch: `deafen(...)`.
  - playerUnit and refitUnit: set `u.hear`, `u.earCut`, `u.faceCover`, `u.link`, and `u.nvg` from the helmet mount.
  - stealth.js lines 148 and 592: `u.nvg = offhandNvg || helmetNvg(s)`.
  - stealth.js detectRange: multiply in `hearMult(e)`.
  - middead.js scream: `hold += earHold(f)`.
  - shotOdds: `− (a.dazed ? 10 : 0)`, `− visorAim(a, b)`, `+ linkAim(b, a, t)`.
  - lights.js packLights: treat a helmetlight as a carried light.
- **Enemies** (enemyUnit adds `helmKey`, `earKey` per kit next to section 17's armour pieces):
  - Soldiers: milhelmet 60%, highcut 15%, commset 30%.
  - Guards/police: riothelmet 30%, eardef 10%.
  - Raiders: bikehelmet 15%, hardhat 10%, earmuffs 10%.
  - Militia: hardhat 10%.
  - Bodies drop them (inventory.js enemyBody) at their post-fight dur.
- **Loot.**
  - LOCATIONS gear: hardware/factory/dam/quarry get hardhat and earmuffs; gunstore gets earmuffs and eardef; police gets riotvisor and eardef; military and crash_mil get highcut, commset, ballvisor and nvgmount.
  - Raid AREAS rows the same way.
  - SITE_FINDS: earplugs.
  - loot.js ITEM_TAGS: hardhat [tools, industry], earmuffs [guns, tools, industry], eardef [guns, police], commset/highcut/ballvisor [military], riotvisor [police, prison], helmetlight [tools, police, military].
  - TRADE_PREFS: military 1.5 on armor/electronics already covers them; commset and eardef use cat "electronics".
- **UI.**
  - The equipment screen opens a helmet in the section 9 builder (helmet silhouettes with leader lines to face / nvg / light / ears).
  - The battle unit panel shows "DEAF 2" or "DAZED" chips, a Visor up/down toggle, and "?" heard markers on the map.
  - ui/soundcues.js: while the selected unit is deaf, battle cues play at 30% volume with a short ring.

### 18.7 Owner, wave and tests
- **Owner:** the armour/rig agent (the section 16–17 owner), in the wave after section 17 lands, because it depends on the head zone, AC and dmax.
- **Files:** hearing.js and helmets.js (new); the data.js tail block; one-line hooks in combat.js, stealth.js, middead.js, throwables.js and lights.js; ui/inventory.js plus the builder platform entries; ui/combat.js chips and toggle; ui/soundcues.js.
- **Conflict risk:** combat.js fire is also touched by the jam and launcher agents. Keep this agent's edits to single call lines placed after `spendRounds`.
- **Test, tools/heartest.js (headless, prints passed/failed):**
  - The bang and e table above (rifle outdoors deafens, suppressed doesn't, muffs prevent it, .50 dazes).
  - deaf ticks down.
  - detectRange behind arc against deaf, electronic and plugged guards.
  - Heard ghosts appear only within HEAR and not while deaf.
  - Scream hold bonuses.
  - Face zone: bite to the face with and without a visor; the ballistic visor cracks at 0 dur.
  - Full-shell helmets reject ear mounts.
  - NVG on a helmet frees the off hand.
  - visorFog aim.
  - Save round-trip with helmet mods.
  - loottest tags pass.

---

## 19. Lootable gun safes and gun cases

### 19.1 What exists to build on (dev)
- **locks.js.**
  - `LOCKS.safe` (diff 4, force false, loot "safe") and `LOCKS.cage` "Gun cage" (diff 3).
  - Placement per raid area through `RULES` (e.g. armory → cage 45%; office/control → safe 8–12%).
  - buildingmaps.js `boxLock: ["safe", p]` on gun-shop offices (0.25), the police "Chief's office" (0.3), records rooms and so on.
  - Opening via `openOdds` / `openLock`, with methods key / pick / force, `PICK`, `FORCE` and `SMASH` costs, and Heat.
  - Extras via `LOCK_LOOT` and `lockedLoot` (hash01 rolls, never world dice).
  - The raid bot uses `autoLock`; the headless search uses `lockedSearchHour`; ui/locks.js shows the odds.
- **Raid Heat.** `raidTurn` adds 1.2 a turn + `b.noise` + 0.6 × infection, with a new stage every 25 (more dead spawn), and `BOT_LEAVE.HEAT` is 40. Costs below are priced in that currency.
- **Theft and fire today.** Raids and break-ins steal only base supplies (factions.js:680/691 `steal(base.stock …)`, halved by a storehouse). Deserters keep their own gear and may take supplies. Arson (mentalbreaks.js) burns a building, not the armory. So nothing steals or burns stored guns yet.

### 19.2 New containers and lock tiers (in LOCKS, new `tier` field)

| lock kind | name | tier | diff | force (pry) | dial / keypad | where (RULES / buildingmaps boxLock) |
|---|---|---|---|---|---|---|
| gunsafe1 | Gun cabinet | cheap | 2 | yes (crowbar) | key lock | house 6% in suburb/rural tiles (2% city), farmhouse 15%, cabin area 20%, motel 3% |
| gunsafe2 | Gun safe | mid | 4 | no | 50/50 dial / keypad | gunshop back room (replaces the office "safe" there, 0.5), the police Chief's office (replaces "safe" 0.3), lodge/ranch farmhouse 12%, cabin 8% |
| gunsafe3 | Armoury safe | high | 5 | no | keypad 70%, dial 30% | police armory 30% (beside the cage), prison armory 25%, military armory 35%, milwreck crate 10% |
| guncase (container) | Hard rifle or pistol case | — | 1 if locked | yes (any blade or crowbar, quiet) | cheap lock 40% | see 19.4 |

- Gun safes are a new box kind, `gunsafe`: 1×1, unmovable, `botSkip` false. They need a sprite in ui/isoview.js and the 2D battle view: a tall dark steel box with a dial or keypad.
- The inspect tooltip shows "Gun safe, mid tier, dial". This uses the existing ui/locks.js tooltip.

### 19.3 Opening methods
All methods are added to `openOdds` and `openLock`; the existing key / pick / force stay.

| method | needs | chance | actions | noise / Heat | notes |
|---|---|---|---|---|---|
| combination | a note found this raid (`R.combos` has this box) | 100% | 1 | silent | When a safe is placed, roll the chance that its combination exists: cheap 25%, mid 15%, high 8%. It is hidden in another container of the same building (that search logs "a note: 24-12-36, for the safe in the bedroom") or, 5%, on a human kit body. |
| key (existing) | the site key | 100% | 1 | silent | Cheap and mid only (high-tier safes have no key). |
| crack (dial) | Stealth ≥ 6 | 0.04 × Stealth − 0.10 × (tier − 1), between 0.05 and 0.6 | 2 (the whole turn) | Heat +1 | Mid at Stealth 10: 30%; high: 20%. Stealth XP like a pick. |
| bypass (keypad) | 1 electronics part (generic "parts" until section 10 lands) + Mechanics | 0.30 + 0.05 × Mechanics − 0.15 × (tier − 2) | 1 | silent | The part is used on success, 50% chance on a miss. |
| pry (existing force) | crowbar / pry weapon | the existing FORCE formula | 1 | Heat +6, wakes within 8 | Cheap only. |
| drill | `powerdrill` (new GEAR tool, 2.2 kg, value 25, dur 3 safes) | sure, by progress | progress per action 1 + 0.05 × Mechanics; needs cheap 2 / mid 6 / high 12 | noise 2 an action (adds to b.noise, so about +2 Heat each), alertNear radius 8 each turn | A progress bar on the box ("Drilling 4/6"); work can be split across turns and people. |
| grind | `anglegrinder` (new, 3 kg, value 35, dur 4) | sure | needs half of drill | noise 3 an action, alertNear 11 | Sparks are seen at night (+2 detect for the grinder's user). |
| blow | pipebomb or frag (later: breaching charge / 40 mm) | mid 100%, high 70% | 1 to set; goes off at the start of the next player turn | the existing pipe-bomb landEffect: +10 Heat, wake 14, blast hurts within 1.5 | Damages contents: each gun −0.3 quality (minimum 0.2), 30% of ammo and supplies destroyed, glass valuables (scotch/wine) destroyed. |

**Is it worth it in raid Heat?** (base 1.2 a turn + noise)
- **Mid safe, drilled.** 6 actions = 3 turns ≈ 3.6 + 6 = about 10 Heat plus three alerts. That's about 0.4 of a stage, for an expected haul worth about 150 base value (19.5).
- **Gun cage, for comparison.** About 55 value for about 6–12 Heat (one or two crowbar tries).
- **High safe, drilled.** About 19 Heat (nearly a stage) for about 300 value. Grinding halves the time but raises the wake radius.
- **Blowing.** About 11 Heat and 1 turn, but the contents are damaged.
- **Cracking.** Quiet (+1 a try) but a gamble at 2 actions a try.

The curve is intended: patient and quiet, or fast and loud.

### 19.4 Gun cases (an item, so the portable case comes for free)
- **New GEAR rows.**
  - `riflecase`: 3.5 kg, value 12, bulky, holds 1 long gun + 2 small items (mags or ammo boxes later).
  - `pistolcase`: 1 kg, value 6, small, 1 handgun + 2 small.
- **Storage.** A case uses `item.contents`, like a pack, so itemLoad and itemValue already count what's inside. `item.locked` marks a locked case.
- **Opening.**
  - In a raid: 1 action with any blade or crowbar, Heat +1.
  - At a base or camp: free and silent.
  - So a looter can carry a locked case home rather than open it under Heat.
- **Where cases turn up (rolled by `rollGunCase`).**
  - AREAS house 0.02 (closets), farmhouse 0.04, cabin 0.05, gunshop 0.08.
  - Locked cars: LOCK_LOOT.car 0.04 (trunks).
  - Miltrucks branch cargo 0.15.
  - airport hangar 0.01.
- **Carrying.** A gun inside a case isn't fielded: it doesn't wear (wearFielded skips it) and it can't be fired. Taking it out costs 1 action from the pack, 0 at base.
- **Protection value.** It only matters if section 14 adds a dirt / rain factor, in which case cased spares stay clean. Today there is no weather wear, so the case is mainly a loot container plus weight.

### 19.5 Contents: one extensible loot function
New file src/sim/gunsafes.js:

```js
export const GUN_STASH = { cheap: {...}, mid: {...}, high: {...}, pistolcase: {...}, riflecase: {...} };
export function rollGunStash(roll, tier, siteType, opts = {}) // roll = hash01 closure (locks.js style); returns { gear: [], sup: {} }
const EXTRAS = [];
export function registerStashExtra(fn)  // fn(ctx, out): later stages add typed ammo, magazines, fitted attachments
```

| tier | guns (weighted, existing keys) | count | supplies today (generic) | other |
|---|---|---|---|---|
| cheap | huntrifle 3, shotgun 3, leverrifle 2, revolver 1 | 1, 35% a second | ammo 10–30 | valuables 15% (coins, watch, goldring) |
| mid | pistol 3, revolver 2, huntrifle 2, shotgun 2, leverrifle 2, carbine 1 | 2–4 | ammo 30–80 | valuables 50% (coins, goldchain, watch); a site key 20%; blueprint rolls ×3; **rare 8%**: suppressed pistol (pistol + pistolcan fitted) or scoped .308 (the section 3 key, otherwise huntrifle + scope4x) |
| high, police / prison | pistol 3, carbine 3, shotgun 2 | 2–5 | ammo 80–200 | riflecan 15%, riothelmet 20%, eardef 10% |
| high, military | ar 3, carbine 2, DMR (section 3) 1 | 2–4 | ammo 100–250 | frag 20%, highcut 5%, grenade launcher (section 13 m79 key) 4%, .50 rifle 0.5% only if section 3 allows it here |
| pistolcase | pistol 3, revolver 2 | 1 | ammo 6–15 | — |
| riflecase | huntrifle 5, leverrifle 2, shotgun 2, carbine 1 (police / military sites only) | 1 | ammo 5–20 | — |

**Plugging in.**
- `lockedLoot` sends gunsafe1/2/3 to `rollGunStash` instead of `LOCK_LOOT`, and their supply amounts are not multiplied by the ×1.5 lock bonus.
- Gun quality: cheap 0.6–0.9, mid and high 0.75–1, so safes are the clean-gun source.
- Later stages register extras rather than editing the tables:
  - typed ammo (section 2: converts `sup.ammo` into calibre stocks for the guns rolled)
  - mags (section 15: 0–2 per gun)
  - attachments (gunmods / section 5: `randomStashMods(roll, item, tier)`: mid 40% one part, high 60% up to two)

### 19.6 Headless, bot and autopilot
- **Headless search** (`lockedSearchHour`, locks.js:431): add an abstract gun safe find, at the site's chance per hour, for site types matching 19.2. The team picks its best method: a drill or grinder carried means opened at +8 Heat (high-tier safes +15); otherwise a crack chance with +1 Heat; otherwise it stays shut. With an explosive and Heat under 30, blow it.
- **Raid bot** (`autoLock`):
  - key or combination first;
  - bypass if it has a part and chance ≥ 0.4;
  - crack only if Stealth ≥ 8, Heat < 40 and fewer than 3 tries;
  - drill or grind only if the projected Heat at the end, `R.heat + turns × (1.2 + noise)`, stays under 35 and no aware enemy is within 8;
  - never blow (to protect contents), otherwise `botSkip`.
- **Autopilot.**
  - Search and raid trips to rural or suburban, gun-store, police or military targets pack a powerdrill from the armory (kit.js SEARCH_KIT, under KIT_KG).
  - Locked cases found are opened at base. The armory's existing equip logic (bulk.js equipBest) then picks up the guns.

### 19.7 Optional extras (verdicts)
- **Base gun locker:** not worth it now. Nothing steals or burns armory guns today (19.1), so it would protect against nothing.
  - If wanted: add a building `gunlocker` (utility plot, scrap 20 + 2 machine parts, max 1), together with a new rule that deserters take one armory gun 30% of the time and a break-in takes 10% of armory guns unless a gunlocker exists. I'd list it on the pick-list, not build it by default.
- **Portable gun case:** worth it, and it costs nothing extra, because it is the same item as 19.4.

### 19.8 Can this be an early stage? Yes.
- It runs entirely on today's generic ammo, the existing gun keys, the existing LOCKS / openLock / lockedLoot machinery, and generic "parts" for the keypad bypass.
- Later stages plug in through `registerStashExtra` and new GUN_STASH keys. Nothing has to be rewritten.

### 19.9 Owner, wave and tests
- **Owner:** a separate agent in wave 1, the earliest wave. It is independent of the ammo and armour models.
- **Files it owns:**
  - src/sim/gunsafes.js (new)
  - locks.js: new LOCKS rows, RULES rows, openOdds and openLock methods, the autoLock rules, lockedSearchHour, and the drill-progress state on `t.lock.prog`
  - buildingmaps.js boxLock rows: gunshop office, Chief's office, armories
  - ui/locks.js: the method buttons with actions, turns, Heat per turn, wake radius and odds, plus the drill progress bar
  - the gunsafe sprite in ui/isoview.js
  - kit.js SEARCH_KIT (adding powerdrill)
- **Shared edits (small, rows only):**
  - combat.js AREAS gear rows: powerdrill in garage 0.04, workshop 0.05, hardware areas; anglegrinder in workshop 0.03, factory; the cases.
  - data.js tail `Object.assign(GEAR, …)` block: powerdrill, anglegrinder, riflecase, pistolcase.
  - loot.js ITEM_TAGS.
  - The ammo agent also edits AREAS loot rows, so this agent lands first and the ammo agent rebases.
- **Test, tools/gunsafetest.js (headless, passed/failed):**
  - placement rates per area and site over many lockRaid seeds (±30% of target);
  - openOdds for every method and tier, including the skill gates;
  - drill progress and the Heat added over turns match 19.3 within ±2;
  - blow opens the safe and damages contents as specified;
  - combination notes are placed and found;
  - rollGunStash distributions per tier, and a registered extra is applied;
  - a locked case can be carried, then opened at base for free;
  - a cased gun isn't fielded and isn't worn;
  - the bot never starts a drill past the Heat cap and never blows a safe;
  - lockedSearchHour opens safes only with a drill or a successful crack;
  - save round-trip (a case with contents, a lock with progress);
  - loottest tags pass.

---

## 20. User decisions on the pick-list (2026-10-07) and new requirements

Answers (R numbers from section 8):
- R1 ammo storage: FULL PER-CALIBRE (user confirmed 2026-10-07: "every calibre its own box"). Every round, common FMJ/00 buck included, is a box per calibre and type; a 9mm gun cannot fire 5.56. This is the section 1 "rejected alternative" (572 refs in 72 src files, 84 tools). Approach: keep the supply key "ammo" only as a legacy/abstract value used by the AI groups (f.stock.ammo), upkeep reserves and by-the-numbers fights through an adapter (ammoCount(holder) = sum of all boxes; spendAmmo(holder, n) draws boxes by the holder’s guns’ calibres), migrate player stocks/cargo/pools of "ammo" into calibre boxes split by the guns the colony owns (save migration), make trade/loot/production produce calibre boxes (SITE ammo by site type: gun store mixed, police 9mm/12ga/5.56, military 5.56/.308, farms 12ga/.22/.30-30), and make the ammo bench produce the calibres of guns at the base. Agent A owns the adapter + battle side; agent C owns economy/trade/loot/production migration; a dedicated migration test (tools/ammomigrationtest.js) proves old saves load with the same total rounds.
- R2 per-hit armour: accepted ("armor is better against some ammo types versus others"): sections 2 and 17 as written.
- R3 rifles beat soft/light vests: ON.
- R4 spears: reach 2 tiles AND can be THROWN up to 5 tiles (new: a "throw" for spear-class weapons through throwables.js aim/scatter; the spear lands on the target cell, the thrower is unarmed (fists or a sidearm) until picked up again; picked up after a won fight; damage = melee dmg, pierce class).
- R5 quick melee: yes, as proposed (one strike plus a move).
- R6 over-penetration: YES, by ammo type. .50 BMG always, high-power rifle rounds (.308 FMJ/AP, 5.56 AP, 7.62x39 AP) by chance: a hit that penetrates (or kills) carries on along the line to the next unit (either side) with reduced damage (x0.6) and its own hit roll; light cover in between (crates, fences, car doors, interior walls) is penetrated by .50 and AP. Shows in the shot line and fx.
- R7 suppression: a new ACTION "Suppress" (target an enemy human or an area cone): fires a burst/auto stream (mag-hungry; MGs and full-auto best), no damage roll or a small one, targets in the cone are "suppressed" until their next turn end: -20 aim, cannot overwatch, AI prefers hunkering/cover. NO effect on the dead (zombies, special dead). Enemy humans can suppress you too (MG-armed soldiers/raiders).
- Overwatch overhaul: overwatch becomes sustained: the unit reacts to EVERY enemy that moves within its range and sight until its own next turn, or until its magazine is empty (or it jams). Each reaction keeps the reaction aim penalty; a high-capacity gun (LMG, drum, belt) is the best overwatch gun. Fire mode applies to reactions.
- R8 typed rounds in by-the-numbers fights: YES.
- R9 hunting uses loaded type: YES.
- R10 enemy ammo label: NEVER shown (user, 2026-10-07). The enemy line shows the gun and its parts, not the loaded ammo type; the player learns it only from effects (log: "the round goes through the plate").
- R11 starter extras change old seeds: YES (accepted).
- R12 fire modes: AK and other automatic weapons (ar, carbine?, smg, ak, lmg, m249, turret) get selectable FIRE MODES, toggled per unit (free action, hotkey): single (1 round, best aim), burst (2-3 rounds by gun, aim penalty, more damage chances), full auto (10-15 rounds by gun, worse aim, best for suppression/overwatch). Each round in a burst/auto rolls its own hit at the mode's aim; recoil grows per round. Semi-only guns (pistols, carbine if semi, dmr) single only. The old "assault rifle fires 2 a shot" becomes its burst mode.
- R13: magazines from a backpack cost 2 actions, from a chest rig (or rig pouch / pocket) 1 (user, 2026-10-07). Throws and meds unchanged.
- R14: NO easy-jam toggle (user, 2026-10-07).
- R15 enemy launchers: raiders (and any AI group) USE whatever they get: weapons, launchers, attachments, ammo they loot, steal, buy or capture go into the group's ARSENAL and are issued to their fighters. They use them against other AI groups, the dead and the player. Needs: a per-faction arsenal (f.arsenal: gear items + typed ammo), filled by their scavenging, raids on others (including stealing from the player), trade, battlefield pickup after wins; enemyUnit draws KITS from the arsenal first, KITS defaults after; the abstract AI-vs-AI and AI-vs-horde fights (conflicts.js, hordes) read the arsenal's power (combatPower of issued gear, launchers big vs hordes and walls). A raider group that captures an RPG can use it on your gate.
- R16 rigs now: YES (wave 2 as planned).
- R17 heavy kit slows enemies too: YES.

Ownership: fire modes, sustained overwatch, suppression, over-penetration -> agent A (combat.js fire paths; after gunmags merges). Spear throw -> agent B (data) + F (throwables). Faction arsenal -> new agent H in wave 2 (factions.js, conflicts.js, aiscav.js, enemyUnit draw; coordinate with A on enemyUnit).

---

## 21. Repairing gear at the workbench (user request 2026-10-07), Tarkov-like max-durability loss

Today nothing is repaired: makeshift items have `dur` (uses left) and break at 0 (crafting.js wear/wearSlot/wearAfterFight); guns lose `quality` (0.4–1) when fired above skill; section 17 adds per-hit armour durability `ad`/`admax`.

**Field contract (fixed now so A2 and C agree):**
- Condition lives in one place per item kind:
  - armour pieces with `ac` (section 17): `item.ad` current, `item.admax` current max (missing -> GEAR dmax). Plates, helmets, vests, padding.
  - guns and attachments: `item.quality` current, `item.qmax` current max (missing -> 1).
  - other wearing gear (makeshift weapons, tools, packs, bandage kits are consumables and NOT repairable): `item.dur` current, `item.maxDur` current max (missing -> GEAR dur).
- `repairInfo(item)` / `repairItem(state, base, item, by)` live in a new `src/sim/repair.js` (owner C). A2's armour.js only reads/writes `ad`/`admax`; jams (section 14) read `quality`.

**Rules:**
- Where: at a base with a Workbench (find the existing workshop/workbench building in buildings.js; if none, the machine shop; otherwise add a cheap "Workbench" utility building: scrap 15, 8 h). A field repair kit item (`repairkit`, 1 kg, value 25, dur 5 uses) allows a worse repair anywhere (half the restore, double the max loss).
- Who: a person on the Craft role (or a queued job) with the right skill: Mechanics for guns, attachments, hard armour, steel plates, tools; a new-or-existing Tailoring-type skill if one exists, else Mechanics, for soft armour (vests, padding). Skill gates: guns Mechanics 3, AP-rated armour AC4+ Mechanics 5.
- Inputs by kind (the section 10 part kinds):
  - guns: 1 gun part per 0.2 quality restored (+ 1 scrap)
  - attachments: 1 gun part (optics: 1 electronics)
  - soft armour: a kevlar repair kit item (police/military loot) or 3 cloth/scrap for makeshift padding
  - helmets and hard pieces: machine parts 1 + scrap 2
  - steel plates: scrap 4 + fuel 1 (welding)
  - ceramic plates: cannot be repaired (replace)
  - makeshift weapons and tools: scrap 1–3 + firewood for wooden ones
- Time: 1–4 work-hours by kind; a repair queue on the base (like production orders).
- **Max loss (Tarkov):** each repair restores up to the current max, and the max drops by `restored × max(0.08, 0.25 − 0.01 × skill)` (workbench) or ×2 with a field kit. A Mechanics-12 repair loses ~13% of what it restores; Mechanics 3 loses 22%. The max never rises again. An item whose max falls below 20% of the GEAR max is "worn out" (can't be repaired; still usable until broken; salvage it for parts, section 10).
- Value and stats: itemValue scales with current/GEAR max and also with max/GEAR max (a worn-out max sells low). Jams read quality; armour protection reads ad/dmax (section 17).
- UI: "Repair" button on an item in the inventory/armory and the gun builder: shows cost, time, who will do it, restored amount and the new max ("Max durability 45 -> 41"). A base "Repairs" list (queued). Durability bars show current and max (a darker band for the lost max).
- Autopilot: queue repairs for gear below 60% when the parts are there, best fighters' gear first.
- Test: tools/repairtest.js (inputs drawn, skill gates, max loss formula, field kit worse, ceramic refused, worn-out refused, save round-trip of qmax/admax/maxDur, value falls with max).
- Owner: C (wave 1), with repair.js; A2 owns the armour durability fields' wear side.

---

## 22. Sniper rifles with scopes and bipods (user request 2026-10-07; agent B data, C mods, D art)

Add dedicated sniper rifles, found already fitted with a scope and a bipod (item.mods set when generated: loot, enemy KITS, gun safes, military trucks), on top of section 3's dmr and amr:

| key | name | cal | dmg | opt | fall | aim | close | cap | noise | kg | value | req | power | jam % | platform | fitted when found | found |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sniper (new) | Bolt-action sniper rifle (M24-style) | 308 | 30–40 | 15 | 1.2 | +9 | −14 | 5 | 3 | 5.5 | 220 | 11 | 8.5 | 0.1 | bolt | tacscope + bipod (always) | military armory 0.01, police SWAT armory 0.005, soldiers strong (1 in 10 at power 8+, "Sniper" label, keeps distance), gun safes high-military 3% |
| dmr (section 3) | Marksman rifle (AR-10) | 308 | as section 3 | | | | | 20 | | | | | | | ar10 | acog or tacscope 60%, bipod 40% | as section 3 |
| amr (section 3) | .50 BMG anti-materiel rifle | 50bmg | as section 3 | | | | | 10 | | | | | | | amr | tacscope always, bipod built in | as section 3 |
| huntrifle (kept) | Hunting rifle | 308 | unchanged | | | | | | | | | | | | bolt | (scope part of its base stats; may take a bipod) | as today |

- `brace` rule (section 3) applies: sniper −15 aim if it moved this turn; with a bipod deployed (+8 if the shooter did not move, from section 5) it is the best long-range gun short of the .50.
- `heavy`: no. `pierce`: no (only the .50).
- A "sniper" enemy behaviour (agent A2 or B, in the enemy AI): a unit with WEAPONS[w].sniper prefers a far cell with cover and line of sight (scoreCell bonus for distance 10–15), never closes in, and goes on overwatch when nothing is in sight.
- Hunting: the sniper's `hunt` override `{ big: 1.25, small: 0.4 }` (a scope helps on big game).
- Gun builder art: the bolt platform drawing with a long barrel variant (`look: "sniper"`).
- Test: rostertest checks the sniper always comes with tacscope + bipod fitted from every source, and the brace penalty.

---

## 23. Military starting vehicles (user request 2026-10-07; agent G)

"Military bases start with 1 mil truck and 1 humvee with machine gun on top":
- (a) AI groups of the military type start owning a miltruck and a Humvee (plating 1, glass 1, `turret: { gun: "m2hb" }`) at their home base, usable by their raids/convoys/defence; by-the-numbers bonus as section 11.
- (b) Every National Guard base site's motor pool has one working miltruck and one M2-turret Humvee among its trucks, guarded, claimable via foundcars.js.
- The turret fires once the turret wave lands (needs B's m2hb, A2's fire modes); until then it is drawn and shown as not yet usable.

---

## 24. Explosions vs gear (user request 2026-10-07; agent F in wave 2, with G for vehicles)

- Launchers' blast: high damage at the impact cell, less in the splash (AoE). 40 mm HE: impact 34–46, splash (r 1.5) 16–24. Rocket: impact 70–95 (and struct/vehicle damage), splash (r 2) 30–45. Frags and pipe bombs keep today's numbers (no impact cell).
- Blowing up a vehicle (its condition reaches 0 from blasts, or a rocket hit that wrecks it): 50–80% of the items in its cargo/trunk are destroyed at random, and every remaining item with durability (quality/qmax, ad/admax, dur/maxDur per section 21) loses 20–60% of its current value; riders take blast damage.
- Blowing up an enemy (killed or hit by a blast): every item on them with durability takes 15–50% damage (scaled by the blast damage they took), so looted gear from a body killed by explosives is worn; ammo boxes on them lose 0–40% of their rounds (cook-off); a throwable on them may go off (10%: a frag/molotov in their pocket explodes at their cell).

---

## 25. Amendment after dev 75793c5 (another session's "durability on all gear" + crafting benches, 2026-10-07)

dev now has: GEAR_DUR (real weapons, armour, kits wear; dur = uses), item.durMax, crafting.js itemDur / itemDurMax / wear / wearSlot / wearHeld / craftedDur / durUnit, found gear part-worn 30-100% (inventory.js newItem FOUND_DUR, hash-rolled), starting/recruit gear 55-100%, a Crafting skill, crafting bench -> workbench -> master workbench (buildings.js family "bench"; the hub starts with a crafting bench), a "spear" (Steel spear) GEAR + WEAPONS key.

This REPLACES the section 17/21 field contract: **one condition field for all gear: item.dur / item.durMax** (via crafting.js itemDur/itemDurMax/wear).
- Armour (section 17): an armour piece's durability points ARE dur/durMax. Rescale its GEAR dur to the section 17 dmax (vest 40, plate 50, milhelmet 30 ... as the table; GEAR_DUR already close). Per-hit wear (armour.js) replaces the per-fight wearSlot for pieces with `ac`; no separate ad/admax fields.
- Guns: dur/durMax are uses (wear per fight / shots, as dev does); quality (0.4-1) stays the gun's precision/make (crafting quality roll). Jams (section 14) read both: fq from quality AND condition dur/durMax (a worn gun jams more).
- Repair (section 21): restores dur up to durMax and lowers durMax by the Tarkov formula; the workbench family already exists (crafting bench tier 1 = field-grade repairs only?, workbench = full repairs, master workbench = smaller max loss, e.g. ×0.7). Use the Crafting skill for soft goods (vests, padding, packs) and Mechanics for guns/hard armour/plates/tools.
- Section 4 melee: "spear" already exists (Steel spear): agent B gives it reach 2 + throw 5 rather than adding a new key; pipespear is the makeshift spear.

---

### 19.10 As built (branch `gunsafes`)
- **Files.** New `src/sim/gunsafes.js` (GUN_STASH, rollGunStash, registerStashExtra, blastContents, gun cases, GUN_FINDS, SEARCH_TOOLS, openCaseAt) and `tools/gunsafetest.js`. Gun-safe code in `locks.js` sits in one block at the end of the file (LOCKS rows via `Object.assign`, SAFE numbers, placeGunSafes, safeOdds, openSafe, safeTurn, autoSafe, gunSearchHour); the existing functions only gained one-line hooks.
- **Placement.** An existing container of the area is turned into the safe (kind and cell `gunsafe`), so map layouts and world dice stay put. Street maps use SAFE_RULES by area and site; building maps use `room.gunSafe` (gun shop office 0.5, Chief's office 0.3, armories at the site's rate) plus one roll a home building.
- **Noise.** Drill noise is 1 an action and grinder noise 1.5 (2 and 3 a turn of two actions), so the Heat sums in 19.3 hold (mid drilled 9.6, high 19.2). The table's "noise 2 an action" would double them; the bot's projection `R.heat + turns × (1.2 + noise)` uses the per-turn noise.
- **Not built.** The base gun locker (19.7). Cases do not take a gun put back in by hand (the case is a loot container; "Open case" empties it). Ammo in a case sits on `item.sup` and is not counted in itemLoad / itemValue.
- **TODO for later stages.** GUN_STASH comments name dmr, m79, highcut, eardef, riflecan, scope4x / pistolcan fits (register extras or rows); miltrucks cargo calls `rollGunCase` at 0.15.

---

## 26. Group arsenals: everyone only has what their group gathers (user, 2026-10-07; agent H)

"Raiders use what they capture as the game goes on. Every survivor AI or player led only has the resources their group gathers and uses for different tasks." Supersedes R15's arsenal note:
- Each AI group holds real goods: f.arsenal (weapons with their mods and condition, armour, throwables, launchers, ammo boxes by calibre once agent A lands, vehicles = f.vehicles) next to its supplies stock.
- Inflows: its own scavenging (aiscav.js), crafting/production, trade and radio deals, battlefield pickup after won fights (the losers' gear, the dead's gear), raids on other groups / caravans / your bases (stolen goods), captured vehicles.
- Outflows: gear issued to fighters who die and are not recovered, wear and breakage, ammo spent, trade, theft by others.
- Allocation by task: home defence keeps a share; raids, caravan escorts (caravans2 already sizes escorts by what the sender can spare), scavenging parties, hunting draw from what is left. Their battle units (combat.js enemyUnit for a group's people) are armed FROM the arsenal (best kit to the best fighters), not from KITS; KITS stay only for people with no group (wanderers, the dead's leftovers) and as the starting arsenal of a new group.
- By the numbers: a group's strength reflects its arsenal (guns, armour, launchers, vehicles), not a flat number.
- People: groups have only the people they have; raids and escorts send real people from the population and casualties are real.

---

## 27. Wave 2 brief: what wave 1 actually built (read before sections 12–18; dev 557d5a2, 2026-10-08)

Where the as-built code differs from the plan, the code wins:
- **Ammo (A):** rounds are SUPPLIES keys `a_<cal>_<type>` (data-ammo.js ROUND_SUPPLIES; boxes in AMMO_GEAR are the item form). API in `rounds.js` (record level) and `ammo.js` (roundsOf, takeBattleRounds, loadsFor, pickLoad, enemyLoad, settleAll, packRounds, starterLoad, roundNeeds, benchRounds...). Generic "ammo" survives only as an abstract count (AI groups' f.stock.ammo, plans, by-the-numbers). `u.load` = loaded type key; the armour weight is `u.armLoad`. Ammo bench (production) already makes common rounds per calibre (`benchRounds`). Beanbag/rubber less-lethal types exist.
- **Magazines today:** gunmags counter (u.mag/u.magMax, magCap from WEAPONS cap × gunMods capMult + cap); reload act takes act.ammo (switch type, 1 action); extended mag / drum / tube are still ATTACHMENTS (gunmods.js, mount "mag").
- **Condition:** ONE field item.dur / item.durMax (+ item.durBase for repairs) for all gear (section 25). repair.js (bench family; Tarkov max loss), autopilot repairs.
- **Armour (A2, armour.js):** per-hit, AC + dur, hit locations (torso/head/arms/legs; crits to the head), ceramic shatters / steel spalls; vest AC2, plate (plate carrier, single piece, ceramic AC5 dmax 45), helmets bikehelmet/riothelmet/milhelmet/footballhelmet/rivethelmet with AC. Enemy pieces wear; loot keeps dur. riothelmet has `visor: true` (flashbang reads it). Flashbang reads `u.earCut` (0–1) for ear protection.
- **Battle:** gunfire.js (fire modes {single,burst,auto}: {rounds, aim}, jams + unjam, suppress, over-penetration, sustained overwatch), u.stun (shared by flashbang, taser, baton), medics.js (heldDown states: down/stab/ko/surr/tied), nonlethal.js, rescueraid.js, throwables.js (FRAG/BLAST/SMOKE/FLARE/FLASH, landEffect, throwLanding, blastSpot, vehicleBlast). Vehicle turret (turret_m2 / turret_lmg) fires through gunfire with .50/5.56 rounds.
- **Roster (B):** data-guns.js GUN_GEAR / GUN_WEAPONS / KIT_PATCH / WEAPON_PATCH / FACTORY_FIT / TRUCK_GEAR and LATER_GEAR (launchers m79, m203, m32, at4, rpg, their rounds, and the carryable m2hb: NOT merged into GEAR yet). WEAPONS has launcher entries flagged `launcher`. M203 is also a gunmods attachment (C), removed from loot until wave 2.
- **Attachments (C):** data-gunmods.js SLOTS / PLATFORMS / WEAPON_PLATFORM / MOD_ATTACH / MOD_GEAR; gunmods.js fitAt/stripAt/slotsOf/fitsSlot/modFits; gun builder UI (D: ui/gunbuilder.js, gunart.js) with Repair button.
- **AI groups (H):** arsenal.js (f.arsenal.items real items; armFromArsenal/settleArsenal in createBattle/createRaid/finishCombat), groupcare.js GROUP_PRIORITIES, groupworld.js. ANY new gear enemies can carry must seed into arsenals by kit and be armed through armFromArsenal.
- **Loot:** every looted/traded item goes through itemcond.js lootItem / rollCondition (itemcondtest scans for stray newItem). ITEM_TAGS for loottest.
- **Keys in battle already used:** F shoot, I reload, E melee, O overwatch, H hunker, M meds, U crush, J double tap, P pick up body, Z lay body, R retreat, G throw, B roofs, V centre, X extract, N vehicle; Shift+F fire mode, Shift+J unjam, Shift+O suppress, Shift+G throw spear, Shift+P pick up spear, Shift+I ammo cycle, Shift+T turret, Shift+H heal, Shift+V revive, Shift+K finish, Shift+D drag, Shift+S search, Shift+R sound retreat, Shift+C area clear, Shift+A AI plays. Check ui/keymap.js and uitest's conflict checks.
