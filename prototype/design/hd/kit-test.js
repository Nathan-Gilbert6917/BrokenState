import { painter, skeleton, torso, head, arm, leg, boot, ramp, skinRamp, ellipseV, elbowFor, limb, PAL, gunHold, headVolume, face } from "./kit.js";
function fig(build, pose) {
  const p = painter(44, 52), sk = skeleton(build), skin = skinRamp("#d9a37c"), shirt = ramp("#5a6b3a"), pants = ramp("#3d4a5c"), shoe = PAL.leather;
  // far side first
  leg(p, sk.hipF, sk.kneeF, sk.footF, ramp(shade2("#3d4a5c")), { r: sk.build.leg });
  boot(p, sk.footF, PAL.black);
  const g = gunHold(sk, "long"); // the hold (2026-10-13): near elbow down at the side, far arm from behind the torso
  if (pose === "rifle") arm(p, g.shoulderF, g.elbowF, g.handF, { sleeve: ramp("#45542c"), skin, r: sk.build.r });
  else arm(p, sk.shoulderF, sk.elbowF, sk.handF, { sleeve: ramp("#45542c"), skin, r: sk.build.r });
  leg(p, sk.hipN, sk.kneeN, sk.footN, pants, { r: sk.build.leg });
  boot(p, sk.footN, PAL.black);
  torso(sk, shirt, p);
  p.hl(sk.cx - sk.build.waist, sk.cx + sk.build.waist, 31, PAL.leather[1]); p.set(sk.cx + 2, 31, PAL.brass[2]);
  limb(p, sk.neck, [sk.neck[0], sk.neck[1] + 2], 2.2, 2.4, skin);
  const inside = headVolume(p, sk.head, sk.headR, skin, { specular: true });
  face(p, sk.head, sk.headR, skin, { inside });
  if (pose === "rifle") {
    limb(p, g.butt, [42, g.axisY], 1.3, 1.1, PAL.iron); // gun line
    arm(p, sk.shoulderN, g.elbowN, g.handN, { sleeve: shirt, skin, r: sk.build.r });
  } else if (pose === "reach") {
    arm(p, sk.shoulderN, [sk.shoulderN[0] + 7, sk.shoulderN[1] + 1], [sk.shoulderN[0] + 14, sk.shoulderN[1] + 1], { sleeve: shirt, sleeveLen: "short", skin, r: sk.build.r });
  } else arm(p, sk.shoulderN, sk.elbowN, sk.handN, { sleeve: shirt, sleeveLen: "short", skin, r: sk.build.r });
  return p;
}
function shade2(h) { return h; }
export const SHEET_TITLE = "figure kit test (design/hd/kit.js)";
export const SHEET = ["slim", "average", "heavy", "brute"].flatMap((b) => ["stand", "rifle", "reach"].map((pose) => ({ label: `${b} ${pose}`, paint: () => fig(b, pose) })));
export const SHEET_COLS = 6;
