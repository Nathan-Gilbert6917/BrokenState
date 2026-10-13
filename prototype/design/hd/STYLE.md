# HD sprite style

The user picked the item icons (`items.js`, `docs/sprite-designs/items.png`) as the style to follow and rejected the first block-figure people and dead. Every HD set follows these rules.

## Materials and light
- Every material is a 4-tone ramp `[dark, mid, light, specular]`: `PAL` from `items.js` (re-exported by `kit.js`), or `ramp(hex)` / `skinRamp(hex)` for a colour the game picks (skin, clothes, group colours).
- Light comes from the upper left. A form is its mid tone, lit along its upper-left rim, dark along its lower-right rim (2 px on wide forms), with at most one specular line or dot (metal, glass, wet flesh, a bald head).
- Forms are round volumes, never boxes: heads and bellies are shaded ellipses, limbs are tapered capsules, the torso is a rounded trapezoid (`kit.js`: `ellipseV`, `limb`, `torso`, `blob`).
- Inner lines only where two forms overlap, in the dark tone of the form behind. Never black inside. The outer black outline comes from `outline()`.
- Bold simple shapes, strong value steps, no dithering, no noise, no single stray pixels.

## Figures (44 × 52, facing right, feet on row 49)
- About 4 heads tall. Shoulders about 2 heads wide on an average build.
- **Arms originate at the shoulders**: the top outer corners of the torso (`skeleton().shoulderN` / `shoulderF`). An arm is an upper arm (about 8 px) and a forearm (about 8 px) through a visible elbow. Hanging, the elbow is at the waist and the hand at the top of the thigh.
- **No stretched arms.** Never draw an arm longer than upper arm + forearm (`reach()`, `elbowFor()` clamp it). The near (right) arm holding a gun bends at the elbow with the hand on the pistol grip, close to the body. The far arm supports the fore-end only within its reach, and the gun is brought in close to the body so it can.
- The near arm and leg are in front (drawn last). The far arm and leg are behind the torso (drawn first), a little darker.
- Zombies may reach forward with both arms straight out from the shoulders: that is anatomical length, not stretched. Only a special whose role it is (the climber's long arms) may have longer limbs.
