# Design Decisions Log — Neon Tail Playability Pass

This document records every design question asked during the planning Q&A, the options considered, the choice made, and the reasoning. Use it as the authoritative "why did we design it this way?" reference when implementing.

Planning session: 2026-04-22. Questions were asked task-by-task, one at a time, with pros/cons per option.

---

## Pervasive Pattern: Difficulty Scaling

Early in Phase 2 a pattern emerged: the user consistently chose "difficulty-scaled" options whenever offered. By Task 12 the setting had become the project's dominant architecture axis. Almost every behaviour lookup reads from a central `difficulty.ts` config (Easy / Medium / Hard, default Medium).

**Implications:**
- Each scaled value lives in one place, keyed by difficulty.
- No inline `if (difficulty === 'hard')` branches scattered through game code.
- Easy-tier values target forgiving casual play; Hard-tier targets speedrun / hardcore.

---

## Phase 0 — Vite v8 Upgrade

### Decision: bundle the upgrade into the Phase 1 PR
- Alternatives: commit standalone as infra hygiene
- **Choice:** bundled
- **Reason:** single PR ships a visibly improved experience (the Phase 1 fixes) along with the dependency bump, reducing merge ceremony.

---

## Phase 1 · Task 1 — Pause-Menu Graphics Toggles

### Q1: Default on first boot
- Alternatives: both on / both off / auto-detect by GPU
- **Choice:** auto-detect by GPU
- **Reason:** users on integrated laptops get sensible defaults without having to dig into settings; high-end users get full fidelity automatically.

### Q2: Shadow granularity
- Alternatives: on/off boolean vs Low/Med/High tiers
- **Choice:** Low / Med / High (1024 / 2048 / 4096 shadow maps)
- **Reason:** three tiers cost barely more than a boolean in UI, but give the user real control over the primary perf knob.

### Q3: Post-processing toggle shape
- Alternatives: single master switch vs split per effect
- **Choice:** split per effect (Bloom / FXAA / Chromatic Aberration separately)
- **Reason:** users who hate one effect (typically chromatic aberration) can disable just that one without losing bloom; matches AAA conventions.

---

## Phase 1 · Task 2 — Projectile Collision

### Q1: Impact visual
- Alternatives: spark burst / scale-down fade / silent disappear
- **Choice:** spark burst
- **Reason:** clearest game-feel feedback; small perf cost is worth the legibility; fits the neon aesthetic.

### Q2: Bazooka behaviour
- Alternatives: same single-hit as other weapons / AoE explosion
- **Choice:** AoE explosion (2.5 m radius)
- **Reason:** gives the bazooka its own identity; will matter a lot once Task 6 has multiple guards to crowd-control.

### Q3: Sword line-of-sight
- Alternatives: add a raycast check now / defer
- **Choice:** add now
- **Reason:** removes a real exploit (hitting guards through vents) with a small scoped change; worth mixing into this task rather than leaving a known exploit in the build.

---

## Phase 1 · Task 3 — Camera Wall Collision

### Q1: Behaviour when pushed into a wall
- Alternatives: zoom-in / orbit-to-clear / fade geometry
- **Choice:** offer both **orbit-to-clear** and **fade-geometry** as a user-selectable mode
- **Reason:** player preference varies; both approaches have pros, a setting lets users pick.

### Q2: Default mode
- Alternatives: orbit-to-clear default / fade-geometry default
- **Choice:** orbit-to-clear default
- **Reason:** works on every material out of the box; fade-geometry default would require shipping alpha-blend variants for every building before first player launch.

### Q3: Minimum camera distance
- Alternatives: keep 8 m / tighten to 4 m / tighten to 2 m
- **Choice:** all three offered as a user setting, **4 m default**
- **Reason:** 4 m gives over-the-shoulder framing during wall pushes; users who want very tight (2 m) or stable-wide (8 m) have the option.

---

## Phase 2 · Task 4 — Guard AI State Machine

### Q1: Detection forgiveness tone
- Alternatives: Hardcore / Moderate / Forgiving
- **Choice:** offer all three as a **Difficulty setting** (Hard / Medium / Easy)
- **Reason:** genre fans range from Hitman-grade to Sly-Cooper-casual; a setting serves all.

### Q2: Default difficulty
- Alternatives: Easy / Medium / Hard
- **Choice:** Medium
- **Reason:** classic stealth default; gives a reasonable first impression to both casual and veteran players.

### Q3: Alerted → give-up timer (LOS broken)
- **Choice:** scales with difficulty — Easy 3 s, Medium 6 s, Hard 10+ s
- **Reason:** fits the persistent chase / comeback tradeoff; matches the difficulty pattern.

### Q4: Vision only vs hearing
- Alternatives: vision only / sprint-only hearing / full audio profile
- **Choice:** full audio profile, scaled by difficulty, **mitigatable by purchasable skills** (e.g. *Silent Landing*)
- **Reason:** gives every action a noise rating, making the skill tree meaningfully interact with the stealth mechanic. Introduces a new **Task 13** (skill system).

### Q5: Skill progression persistence
- Alternatives: per-run / persistent across runs / hybrid
- **Choice:** persistent across runs (RPG-style meta-progression, `localStorage`)
- **Reason:** matches "Sly Cooper coin jar" feel; gives long-term play a point.

### Q6: Currency source
- Alternatives: pickups / end-of-run / guard drops / all three
- **Choice:** **pickups + end-of-run + guard drops** (multiple sources)
- **Reason:** rewards stealthy-explorer, completionist, and aggressive playstyles simultaneously.

### Q7: Skill structure
- Alternatives: flat-list / prerequisite tree / loadout / difficulty-capped
- **Choice:** prerequisite tree with **free respec** ("deposit tree"); on **Hard**, a **fixed active-skill cap** of ~4 / N
- **Reason:** free respec means no "punished for wrong choice"; Hard cap creates per-run loadout strategy without removing unlocks.

### Q8: Branch themes
- Alternatives: 3 branches mechanical / 3 branches thematic / 2 binary / 4 per-system
- **Choice:** 4 branches — **Mobility / Senses / Silence / Gadgets**
- **Reason:** each core game system gets its own branch; richest design space.

### Q9: Character depth
- Alternatives: stat-only / hybrid (shared tree, unique starts) / full unique kits
- **Choice:** **hybrid** now; full unique kits saved as `future-specs/character-kits.md`
- **Reason:** sweet spot between identity-from-minute-one and stays-in-scope; reuses existing assets (`Hudhud rig.fbx` + Meshy biped) so only one new mesh needed.

### Q10: Character switching
- Alternatives: locked per run / switchable between runs / switchable mid-run / skill-gated swap
- **Choice:** switchable **between runs** (locked during a run), PB tracked per character
- **Reason:** encourages experimentation across characters while preserving run identity.

### Q11: Roster
- **Choice:** accepted the proposal — Midnight (Senses), Ironclaw (Gadgets, +HP +damage, slow), Kestrel (Mobility/Silence, low HP, high speed)
- **Reason:** each branch represented; stat blocks are distinct but rely on the same shared tree.

### Q12: Guard state communication
- Alternatives: icon only / cone colour only / both / sonar-only
- **Choice:** **both** icon (`. ? !`) and cone colour
- **Reason:** belt-and-suspenders; colourblind-friendly; readable even when cone is occluded.

### Q13: Guard-to-guard communication
- Alternatives: none / proximity shout / full walkie-talkie / difficulty-scaled
- **Choice:** difficulty-scaled — Easy none, Medium proximity 10 m, Hard full walkie-talkie
- **Reason:** same system across tiers, very different feel; separation of guards is strategically valuable on Hard.

### Q14: Patrol → Suspicious trigger
- Alternatives: short-glimpse / sustained-only / difficulty-scaled / distance-based
- **Choice:** difficulty-scaled sustained sight — Easy 1.0 s, Medium 0.5 s, Hard 0.2 s
- **Reason:** matches the pattern; sustained-only avoids "false positives" from camera spin.

### Q15: Suspicious → Alerted trigger
- Alternatives: see again / sustained / distance / combo with sound
- **Choice:** sustained sight, difficulty-scaled — Easy 1.5 s, Medium 0.8 s, Hard 0.3 s
- **Reason:** consistent with Q14; gives players a genuine recovery window.

### Q16: Investigating behaviour
- Alternatives: straight-to-LKP / expanding search / difficulty-scaled / active cover-point check
- **Choice:** difficulty-scaled — Easy LKP look, Medium expanding-circle search, Hard expanding + multi-guard coordinated search
- **Future spec:** cover-point checking (Q16 option d) saved as `future-specs/guard-cover-search.md` for a later upgrade.

### Q17: Knockout permanence
- Alternatives: temporary only / permanent / hybrid (lethal vs non-lethal) / difficulty-scaled
- **Choice:** difficulty-scaled — Easy persistent KO, Medium wake after 30 s, Hard wake after 12 s + call reinforcements
- **Reason:** preserves non-lethal stealth ethos; Hard escalates KO into a tactical cost.

### Q18: Knockout ↔ currency
- Alternatives: always drop / once-per-guard / diminishing / hybrid tiers / difficulty-scaled
- **Choice:** difficulty-scaled — Easy always, Medium once-per-guard, Hard diminishing + reinforcement-penalty
- **Reason:** matches the pattern; Hard makes unnecessary KOs economically costly.
- **Note:** Ghost-run bonus dropped from this system. **Future spec:** reserved as a potential Silence-branch skill in `future-specs/ghost-run-bonus.md`.

---

## Phase 2 · Task 5 — Player HP

### Q1: HP regen model
- Alternatives: no regen / passive regen / consumables / skill-based / difficulty-scaled
- **Choice:** combo — difficulty-scaled **plus** consumables always available
  - Easy: passive regen + consumables
  - Medium: consumables only
  - Hard: consumables only, rarer/more expensive
- **Reason:** consumables give economic agency at all tiers; passive regen is the Easy perk.

### Q2: 0 HP handling
- Alternatives: instant / downed / revive skill / checkpoint / difficulty-scaled
- **Choice:** difficulty-scaled
  - Easy: checkpoint respawn
  - Medium: revive skill (one per run via Gadgets branch)
  - Hard: instant fail
- **Reason:** matches pattern; forces Task 15 checkpoint dependency for Easy.

### Q3: Damage sources
- Alternatives: melee only / mixed variants / all ranged / difficulty-scaled
- **Choice:** difficulty-scaled — Easy melee, Medium mix, Hard all ranged + stronger melee
- **Reason:** clean escalation; Hard demands positional play and cover.

### Q4: Damage amounts
- **Choice:** combo — damage varies by attack type **and** scales with difficulty
- **Reason:** full design depth; Kestrel on Hard must respect range and cover.

### Q5: I-frames
- **Choice:** combo — difficulty base (1.0 / 0.6 / 0.3 s) plus character modifier (Kestrel +0.3, Ironclaw −0.2)
- **Reason:** scales both by tier and by character fragility; most balanced.

---

## Phase 2 · Task 6 — Multiple Guards

### Q1: Count
- **Choice:** combo — starting count scales (Easy 2, Medium 3, Hard 5) **plus** reinforcements spawn on alarm
- **Reason:** differentiates tiers visibly; Hard scales to genuine chaos.

### Q2: Reinforcement spawn mechanism
- Alternatives: teleport / dropship / hatches / run-in from edges / hybrid
- **Choice:** **rooftop hatches**
- **Reason:** diegetic; no new flying assets; fits existing rooftop geometry; hatches can be signalled with a "thud" sound.

### Q3: Patrol design
- Alternatives: hand-authored loops / zones with wandering / overlapping loops / dynamic ruleset / difficulty-scaled
- **Choice:** **zones with semi-random wandering**
- **Reason:** replayable (player can't memorise a fixed loop); no hand-authoring per tier.

### Q4: Global alarm state
- Alternatives: per-guard only / escalating counter / counter with decay / difficulty-scaled
- **Choice:** **counter with decay** (MGS-style Normal → Caution → Alert → Evasion)
- **Reason:** classic stealth dramaturgy; allows comebacks; ties to music crossfade in Task 7.

---

## Phase 3 · Task 7 — Audio

### Q1: Music model
- Alternatives: static / three-layer crossfade / full adaptive / difficulty-scaled
- **Choice:** **three-layer crossfade** (ambient / caution / alert) driven by global alarm state
- **Reason:** proven stealth-game pattern; classic MGS/Splinter Cell feel; moderate work vs adaptive stems.

### Q2: 3D positional audio
- Alternatives: 2D stereo / full 3D / partial 3D / difficulty-scaled
- **Choice:** **full 3D positional** for all world sounds; music/UI stay 2D
- **Reason:** Babylon has `spatialSound: true` built in; directional guard audio complements Crestal Sonar without replacing it.

### Q3: Asset source
- Alternatives: Kenney+Freesound CC0 / licensed pack / commissioned / AI-generated / start CC0 and upgrade
- **Choice:** **Kenney + Freesound CC0 only**
- **Reason:** zero cost, legally safe, predictable; prototype-grade quality is acceptable for this scope.

### Q4: Volume slider granularity
- Alternatives: master only / master + SFX + music / five-slider full / four without UI
- **Choice:** **Master + SFX + Music** (industry standard)
- **Reason:** covers 95% of needs without menu bloat.

---

## Phase 3 · Task 8 — Rain + Lightning

### Q1: Gameplay effect of weather
- Alternatives: cosmetic only / rain dampens sound / lightning exposes / both / difficulty-scaled
- **Choice:** **both** (rain dampens + lightning exposes) at all difficulties
- **Reason:** full tactical interplay; both effects complement each other; avoids three weather variants to balance.

### Q2: Rain intensity variability
- Alternatives: constant / cyclic / alarm-tied / storm arc / combo
- **Choice:** **cyclic** (30–60 s cycle between light and heavy)
- **Reason:** makes weather a readable tactical resource; heaviest rain is strongest hearing-dampening window.

### Q3: Lightning telegraph
- Alternatives: none / thunder only / visual only / both / difficulty-scaled
- **Choice:** **thunder 1–2 s before lightning**
- **Reason:** diegetic; fair; rewards attention; classic game-film convention.

---

## Phase 4 · Task 9 — Two-Step Objective

### Q1: Is the Baron an NPC?
- Alternatives: patrolling NPC / static cane pickup / stationary Baron / guest / guard-held cane
- **Choice:** **stationary Baron** on a balcony with a narrow vision cone
- **Reason:** narratively right; small scope; placeholder model (re-tinted Golem) works for first iteration. Introduces **Task 14** (Baron NPC) as a separate task.

### Q2: Baron sees player
- Alternatives: same as guard / instant loss / reinforcement flood / difficulty-scaled / combo distance-based
- **Choice:** **reinforcement flood** — all hatches open, global alarm jumps to Evasion
- **Reason:** dramatic without being instant-fail; honours the tragedy of being seen by the boss.

### Q3: Plant interaction
- Alternatives: tap E / hold E with progress bar / minigame / hold-with-Baron-reaction / difficulty-scaled
- **Choice:** **hold E for 2–3 s with progress bar**
- **Reason:** creates stealth tension; classic and readable; moving or being seen cancels.

---

## Phase 4 · Task 10 — Run Timer

### Q1: What counts as completion?
- Alternatives: vial pickup / extract point / timed evacuation / difficulty-scaled / extract on all tiers
- **Choice:** **extraction point on all tiers**, **plus a respawn checkpoint at the vial**
- **Reason:** dramatic heist ending; respawn at vial avoids the frustration of losing a whole run to a last-second mistake. Introduces **Task 15** (extraction + checkpoint).

### Q2: PB granularity
- Alternatives: per character / per character × difficulty / per character + overall / per difficulty / granular + overall
- **Choice:** **per character × difficulty = 9 PBs**
- **Reason:** fair speedrun comparison; Hard Kestrel is a real goal worth chasing.

### Q3: Timer visibility
- Alternatives: always visible / end only / toggleable / Hard only / extraction only
- **Choice:** **toggleable in pause menu, default hidden**
- **Reason:** respects casual stealth flow; opt-in for speedrunners.

### Q4: Leaderboard
- Alternatives: local only / online now / shareable codes / hooks now backend later / skip
- **Choice:** **hooks now, backend later**
- **Reason:** zero scope cost now; preserves the option without committing infrastructure.

---

## Phase 5 · Task 11 — Sprint Stamina

### Q1: What consumes stamina
- Alternatives: sprint only / sprint+dash / sprint+dash+attack / everything except walk / per-character
- **Choice:** **per-character** — Midnight/Ironclaw sprint-only, Kestrel sprint+dash
- **Reason:** reinforces character identity; makes Kestrel a real resource-management challenge and tanks forgiving.

### Q2: Stamina regen
- Alternatives: always when not sprinting / stand-still only / slow-walk+fast-still / per-character / difficulty-scaled
- **Choice:** **always when not sprinting** (including while walking)
- **Reason:** casual-friendly; prevents "stop-go" rhythm tax.

---

## Phase 5 · Task 12 — Gamepad

### Q1: Fixed or remappable
- Alternatives: fixed / full remap / 3 presets / fixed-now-remap-later / auto-detect symbols only
- **Choice:** **fixed now, remap later** (explicitly planned, not vaguely hoped)
- **Reason:** ships gamepad support fast; remap is a well-bounded follow-up tracked as `future-specs/gamepad-remapping.md`.

### Q2: Rumble
- Alternatives: none / key events / scales with alarm / toggle+key-events / combo with alarm scaling
- **Choice:** **toggle in pause menu, default on with key-event rumble**
- **Reason:** useful to most, opt-out for motion-sensitive players; no runaway vibration from alarm-scaled rumble.

---

## Introduced Tasks (not in the original plan)

- **Task 13 — Difficulty config + skill tree + characters.** Foundation for almost all Phase 2+ work. Triggered by Q4 (skills) + Q11 (characters).
- **Task 14 — Baron NPC.** Triggered by Task 9 Q1 (stationary Baron model).
- **Task 15 — Extraction + mid-run checkpoint.** Triggered by Task 10 Q1 (extract on all tiers + checkpoint at vial).

## Future Specs (deliberate deferrals)

- `future-specs/character-kits.md` — full unique signature abilities per character (Task 4 Q9 option c)
- `future-specs/guard-cover-search.md` — active cover-point checking (Task 4 Q16 option d)
- `future-specs/leaderboard-backend.md` — online global leaderboard (Task 10 Q4)
- `future-specs/gamepad-remapping.md` — full rebinding UI (Task 12 Q1)
- `future-specs/ghost-run-bonus.md` — Silence-branch skill for no-alert runs (Task 4 Q18 side-note)
