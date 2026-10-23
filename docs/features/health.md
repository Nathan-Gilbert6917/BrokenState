# Health and medicine

Detail for section 4 of [docs/agents/features.md](../agents/features.md). `[name]` is `prototype/src/sim/name.js`.

## Disease and outbreaks
- The user's request 2026-10-21: "Add disease ... treated with rest and meds. More people higher chances of sicknesses as well as new additions to a base".
- **Camp fever** (catching, worst in packed bunks) and **wound fever** (from an infected wound) climb first, take a course of two doses or more, and untreated drag on and kill [health `CONDITIONS` campfever, woundfever (`rise`, `minCourse`)].
- **Chances**:
  - everyday chances × headcount at a base (`headMult`: +4% a head past 6, at most ×2.2);
  - camp fever × crowding past the beds; flu season in winter and at its edges; wound fever while a wound is infected;
  - each newcomer to a base (recruits, refugees, walkers, moved in; births aside) carries something in 12% of the time (4% moved between your bases), shown after 2–5 days (`s.incubating`, `s.sickHome`);
  - all on the Sickness dial and on hash dice [disease `diseaseRisk` `newcomersDaily` `headMult`; health `illnessRisk` `rollOnset` `healthDaily`].
- **Hub cards**: flu season (keep the sick apart, dose now, wait), bad water (boil, dump, drink), a coughing stranger (take in kept apart) [disease `fluSeasonCard` `badWaterCard` `coughCard`; hubevents].
- **AI parity**: their ill × the same headcount and flu season, dosed from their own meds, dying without them, newcomers carrying it in [disease `groupSickMult` `groupIllCare`; groupcare `illDaily`].
