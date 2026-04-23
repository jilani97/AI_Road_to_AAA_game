# Implementation Plan: Neon Tail Playability Pass

## Overview

Neon Tail is a working Babylon.js stealth-platformer prototype (1 player, 1 guard, 4 weapons, win/lose loop). This plan transforms it into a game with **genuine replay value** — a full difficulty system, persistent progression, multiple playable characters, a Sly-Cooper-inspired skill tree, evolving guard AI, audio, weather that affects gameplay, a two-stage objective, and gamepad support. Act II remains out of scope; we are deepening Act I into something worth finishing multiple times.

The full decision rationale for each design call below lives in [`decisions.md`](./decisions.md).

## Architecture Decisions

The planning Q&A landed on a dominant architectural pattern worth calling out explicitly:

- **Difficulty (Easy / Medium / Hard) is the project's central scaling axis.** Nearly every mechanic — guard comms, hearing radii, detection timings, give-up timers, knockout wake-up, damage sources, damage amounts, i-frames, guard counts, reinforcements, death handling, weather effects — scales through this one setting. Implement the difficulty value as a single central config read by every subsystem; do not embed difficulty branches inline in game code.
- **Guard state machine is a pure function** (`nextGuardState(current, inputs, dt)`). All per-guard behaviour derives from it; multiple guards share the code.
- **Persistent skill progression via `localStorage`.** Currency, unlocked skills, PBs, and settings all persist. No backend, but Task 10 adds event hooks so a leaderboard can be bolted on later.
- **Single-file `GameApp.ts` splits only when forced.** New modules get extracted when a slice needs shared primitives: `guardAi.ts`, `skills.ts`, `audio.ts`, `gamepad.ts`, `collision.ts` are the candidates.
- **All new systems ship with at least one pure-function unit test** following the existing `stealth.ts` / `stealth.test.ts` pattern.
- **Keep assets free and permissive.** All audio is Kenney.nl + Freesound CC0. Character meshes reuse the existing Meshy biped and `Hudhud rig.fbx` where possible; one new mesh needed for Ironclaw.

## Dependency Graph

```
Phase 0 (bundled with Phase 1): Vite v8 upgrade

Phase 1: Foundation fixes (independent, small)
    ├── Task 1: Graphics toggles wired
    ├── Task 2: Projectile collision + sword LoS
    └── Task 3: Camera wall collision

Phase 2: Guard AI + progression + characters (the big unlock)
    ├── Task 13: Difficulty config + skill tree + characters
    │        └── (underpins everything in Phase 2 and beyond)
    ├── Task 4: Guard AI state machine
    │        └── needs Task 13 for difficulty config
    ├── Task 5: Player HP system
    │        └── needs Task 4 (Alerted state)
    └── Task 6: Multiple guards + global alarm state
             └── needs Task 4

Phase 3: Sensory polish
    ├── Task 7: Audio system (3D positional, 3-layer music)
    │        └── needs Task 4 (alarm state drives music)
    └── Task 8: Rain + lightning
             └── needs Task 7 (rain dampens audio)

Phase 4: Objective depth
    ├── Task 14: Baron NPC + two-step tracker
    │        └── needs Task 4
    ├── Task 9: Tracker-plant progress bar mechanic
    │        └── needs Task 14
    ├── Task 15: Extraction point + mid-run checkpoint at vial
    │        └── needs Task 5 (HP / death handling)
    └── Task 10: Run timer + PBs + leaderboard hooks
             └── needs Task 15

Phase 5: Controls and accessibility
    ├── Task 11: Sprint stamina (per-character)
    │        └── needs Task 13 (character config)
    └── Task 12: Gamepad (fixed bindings + rumble)
             └── independent
```

## Scope Decisions (what we're NOT doing this pass)

- ❌ Act II maglev level
- ❌ Full character signature kits (Q9 option c) — kept as `future-specs/character-kits.md`
- ❌ Active cover-point search for guards (Q16 option d) — kept as `future-specs/guard-cover-search.md`
- ❌ Online global leaderboard — event hooks only, backend deferred
- ❌ Gamepad remapping — fixed bindings now, remap is a planned future update
- ❌ Ghost-run bonus mechanic — parked as a potential Silence-branch skill for later

---

## Task List

### Phase 0 — Infra

#### Task 0: Vite v8 upgrade (bundled with Phase 1 merge)
- **Status:** Already applied; working-tree change in `package.json` + `package-lock.json` awaiting commit.
- **Verified:** `npm run build`, `npm test`, `npm run dev` all pass on Vite 8.0.9 / Vitest 4.1.5.
- **Acceptance:** bundled into the Phase 1 PR.

### Phase 1 — Foundation Fixes

#### Task 1: Pause-menu graphics toggles (live wired)
- Replace the current `#chk-shadows` single checkbox with three tiers (Low 1024 / Med 2048 / High 4096).
- Split `#chk-postfx` into per-effect toggles (Bloom / FXAA / Chromatic-Aberration at minimum).
- On first boot, auto-detect by GPU: sniff `navigator.deviceMemory`, `hardwareConcurrency`, and optionally Babylon's `engine.getCaps().maxTextureSize` to pick a default tier.
- Persist choices to `localStorage` under a single `settings` key; load at boot.
- **Files:** `src/main.ts`, `src/game/GameApp.ts`, new `src/game/settings.ts`.
- **Verification:** manual toggle each setting, reload, toggles remembered. Unit test for `resolveGpuTier(capsDescription)` pure function.
- **Size:** S.

#### Task 2: Projectile collision + sword line-of-sight
- Add AABB vs projectile test against `this.colliders`; on impact, scale-down over 150 ms and emit an 8-particle spark burst.
- Bazooka: AoE explosion (2.5 m radius) pushing and damaging all guards in range.
- Sword: add raycast from player to target guard; swings are ignored if a collider is between them.
- **Files:** `src/game/GameApp.ts`, new `src/game/collision.ts`, new `tests/collision.test.ts`.
- **Verification:** tests for `projectileVsAABB`, `raycastHitsAabb`. Manual: fire each weapon at walls; swing sword through a vent.
- **Size:** S.

#### Task 3: Camera wall collision with user-selectable mode
- Add two mode settings to the pause menu:
  - **Camera Mode:** `Orbit to clear angle` (default) | `Fade obstructing geometry`.
  - **Min Camera Distance:** `8 m` | `4 m` (default) | `2 m`.
- Orbit mode uses `scene.collisionsEnabled` + `camera.checkCollisions` + a radius-shrink fallback.
- Fade mode casts a ray each frame from camera to player; materials of colliders hit by the ray switch to alpha-blend at 0.35.
- Persist to `settings.ts`.
- **Files:** `src/game/GameApp.ts`, `src/game/settings.ts`.
- **Verification:** both modes usable; 2 m distance does not clip into the player model; FPS stable.
- **Size:** M.

**Checkpoint 1:** Phase 1 merges as one PR (bundled with Vite 8 upgrade). Build green, tests green, 5-min playtest clean.

---

### Phase 2 — Guard AI, Progression, Characters

#### Task 13: Difficulty config, skill tree, and character roster (foundation for Phase 2 onward)
This is a **new task** introduced by the planning pass. Everything in Phase 2 and most of Phases 3–5 depend on its data structures.

**13a — Difficulty setting.** Central `difficulty.ts` exports `Difficulty = 'easy' | 'medium' | 'hard'`, default `medium`. Pause menu exposes the setting. `localStorage` persists it. Every mechanic below reads from `getDifficulty()`.

**13b — Character roster (3 characters, hybrid depth model).**
- **Midnight the Hud-hud** — Senses specialist. HP 3, balanced speed, +40% sonar range. Starts with *Extended Sonar* + *Silent Landing*. Default character.
- **Ironclaw the Badger** — Gadgets / combat. HP 5, slow speed, −sonar, +25% weapon damage. Starts with *Bazooka Blast Radius +* + *Armoured Plating*. Uses a new mesh (can start as a re-tinted Golem placeholder).
- **Kestrel the Fennec Fox** — Mobility / Silence. HP 2, +30% speed, +50% jump, very quiet footsteps. Starts with *Ascension Dash +* + *Whisper Walk*. Reuses the existing `Hudhud rig.fbx`.
- Selection screen before each run. Stats, HP, and starting skills all read from a central `characters.ts`.
- PB is tracked per character × per difficulty (see Task 10).

**13c — Skill tree with four branches: Mobility / Senses / Silence / Gadgets.**
- Tree has prerequisites (buying tier-2 skills requires tier-1).
- **Free respec:** a *Refund All* button in the skill menu resets every spent point. No penalty — matches the "deposit tree" pattern the user wanted.
- On **Hard**, only 4 unlocked skills may be active at once; a loadout UI shows which are active. Easy/Medium have all unlocked skills always active.
- Skill examples (illustrative, final list locked in during implementation):
  - **Mobility:** Ascension Dash +, Wall Cling (brief mantle), Air Control +
  - **Senses:** Extended Sonar (range), Threat Memory (last-known-position markers), Crest Pulse (one-shot 360° ping on a cooldown)
  - **Silence:** Silent Landing (fall noise −%), Whisper Walk (walk noise 0), Shadow Dash (dash noise −%)
  - **Gadgets:** Bazooka Blast Radius, Armoured Plating, Revive Token (see Task 5), Stamina-cost reducers
- **Ghost-run bonus** is reserved as a possible Silence-branch skill in a later pass (e.g. "finish a run with no alerts → 2× currency").

**13d — Currency.**
- Sources:
  - Small glowing pickups scattered in the level (authored placement)
  - End-of-run lump sum (scales with speed + stealth rating)
  - Guard defeats (interaction with knockout scales with difficulty — see Task 4)
- Stored in `localStorage`. Spent in the skill-tree screen.

**Files:** new `src/game/difficulty.ts`, `src/game/characters.ts`, `src/game/skills.ts`, `src/game/currency.ts`. Matching test files for each.
**Verification:** unit tests for each pure helper; manual run covering character-select → play → earn currency → spend → respec.
**Size:** L (foundational module; budget ~1 week).

---

#### Task 4: Guard AI state machine
Replace today's boolean `hasLost = playerVisible` with a per-guard state machine. States: `Patrol → Suspicious → Investigating → Alerted → Chasing → Returning`.

**Detection (vision):**
- `Patrol → Suspicious` when the player is visible in the vision cone for a sustained time:
  - Easy: 1.0 s | Medium: 0.5 s | Hard: 0.2 s
- `Suspicious → Alerted` when the player is visible again (continuously) for:
  - Easy: 1.5 s | Medium: 0.8 s | Hard: 0.3 s

**Detection (hearing — full audio profile):**
- Every noise-generating action has a base noise radius on a per-difficulty baseline:
  - Sprint: Easy 4 m / Medium 6 m / Hard 9 m
  - Ascension dash: similar scaling
  - Landing: loud by default; silent with the *Silent Landing* skill
  - Attack / bazooka: very loud on all tiers
  - Walk: silent (always)
- A noise event inside a guard's sensitivity radius drops them into `Suspicious` and plants a last-known-position marker.
- Skills (Silence branch) reduce each action's effective noise.

**Investigating behaviour scales with difficulty:**
- Easy: walk straight to last-known position, brief look, return
- Medium: expanding-circle search (2 m → 5 m, 6 s budget)
- Hard: expanding-circle + coordinated multi-guard search (requires guard comms)
- `future-specs/guard-cover-search.md` records the Task 16-option-(d) idea of active cover-point checking as a later upgrade path.

**Alerted → give-up timer (when line-of-sight broken):**
- Easy: 3 s | Medium: 6 s | Hard: 10+ s

**Guard-to-guard communication scales:**
- Easy: no communication; each guard is isolated
- Medium: proximity shout (10 m radius) — other guards drop into `Investigating`
- Hard: full walkie-talkie — one `Alerted` guard pushes all map guards to `Investigating`

**State visibility:** both a floating icon above the guard (`.` patrol, `?` suspicious, `!` alerted) AND a matching vision-cone colour (red / yellow / flashing yellow / bright red). Belt-and-suspenders for colourblind readability.

**Knockout model scales:**
- Easy: knockout persists the whole run (guards stay down)
- Medium: wake up after 30 s, return to `Suspicious`
- Hard: wake up after 12 s AND call for reinforcements when they do

**Currency interaction with knockout scales:**
- Easy: full coin drop on every knockout
- Medium: coin drop only on the first knockout per guard per run
- Hard: diminishing returns per repeat knockout; if the waked guard calls reinforcements, the coin is rescinded

**Files:** new `src/game/guardAi.ts`, `src/game/GameApp.ts`, new `tests/guardAi.test.ts`.
**Verification:** ≥8 unit tests for `nextGuardState`; manual tests for every transition on every difficulty tier.
**Size:** L.

---

#### Task 5: Player HP and damage
**Base HP** from character roster: Midnight 3, Ironclaw 5, Kestrel 2.

**HP regen + consumables (combo model):**
- Easy: passive regen when not seen for 5 s **plus** consumables
- Medium: consumables only (purchasable / found)
- Hard: consumables only; rarer and more expensive
- Consumables are a new shop item (Task 13 currency flow).

**0 HP handling scales:**
- Easy: respawn at most recent checkpoint (includes the Task 15 vial checkpoint)
- Medium: one-shot *Revive Token* skill (Gadgets branch) grants a revive with 1 HP; without it, run fails
- Hard: instant fail

**Damage sources scale:**
- Easy: melee only; guard must touch the player in Alerted
- Medium: mix of melee and ranged variants (blaster guards)
- Hard: all guards ranged + stronger melee

**Damage amounts scale by attack type AND difficulty:**
- Type: melee baseline 1 HP, ranged 0.5 HP (half-pip), heavy 2 HP
- Scaled: Easy flat 1; Medium 1/2 by type; Hard 2/2 by type with higher fire rate

**I-frames (invulnerability after a hit):**
- Difficulty base: Easy 1.0 s | Medium 0.6 s | Hard 0.3 s
- Character modifier stacked on top: Kestrel +0.3 s, Midnight ±0, Ironclaw −0.2 s

**Visuals:** red vignette + brief camera shake on damage. Add a *Reduce camera motion* accessibility toggle in the pause menu.

**Files:** `src/game/GameApp.ts`, `src/main.ts`, `src/style.css`.
**Verification:** manual: take damage on each difficulty with each character; confirm HP/i-frames/visual feedback.
**Size:** M.

---

#### Task 6: Multiple guards + global alarm state
**Guard count scales:**
- Easy: 2 guards (melee only)
- Medium: 3 guards (1 ranged)
- Hard: 5 guards (2 ranged, 1 elite)
- Plus reinforcement spawns (see below).

**Reinforcements arrive via rooftop hatches** — placed in the environment as diegetic access points. When an alarm triggers a reinforcement, the nearest hatch plays an open-and-climb animation and the guard emerges.

**Patrol design: zones with semi-random wandering.** Each guard owns a zone (roughly a quadrant of the map); within it, they pick next waypoint semi-randomly. This replaces hand-authored routes and keeps runs replayable.

**Global alarm state (MGS-style with decay):** `Normal → Caution → Alert → Evasion`. Every `Alerted` event bumps the counter; decay happens when the player is unseen for a period. UI shows the current tier in the HUD. On Evasion, reinforcements spawn aggressively, global music switches to the top layer (Task 7), and patrols tighten.

**Files:** `src/game/GameApp.ts`, `src/game/guardAi.ts`, new `src/game/alarmState.ts`.
**Verification:** playtest on each difficulty; confirm alarm escalation and decay; confirm performance stays >55 FPS with 5 guards + reinforcements.
**Size:** L.

**Checkpoint 2:** Phase 2 merges. Build + tests green. 10-min playtest with documented near-miss moments.

---

### Phase 3 — Sensory Polish

#### Task 7: Audio system
**Music:** three-layer crossfade (ambient / caution / alert) driven by the global alarm state from Task 6. Crossfade over ~800 ms when the alarm tier changes.

**Spatial:** full 3D positional audio (`spatialSound: true`) for all world sounds — footsteps, guard voices, weapon fire, projectile impact, lightning. Music, UI clicks, and global ambient stay 2D.

**Asset source:** Kenney.nl + Freesound CC0 only. Record the exact filenames used in `public/audio/LICENSES.md`.

**Volume controls:** Master + SFX + Music (three sliders in the pause menu), persisted to `localStorage`.

**Required SFX list (first pass):**
- Player footsteps (walk + run)
- Ascension dash + landing (loud + silent variant)
- Sword swing + impact, Blaster fire + impact, Sniper fire + impact, Bazooka fire + explosion
- Guard footsteps (heavier), Guard `?` murmur, Guard `!` shout, Guard knockout thud
- Coin pickup, Skill unlock chime, Tracker-plant click (Task 9), Liquid Time pickup (Task 15)
- Alarm siren (global alarm tier change), Rain loop (cyclic), Thunder + lightning crack (Task 8)
- Music: three composed loops

**Files:** new `src/game/audio.ts`, `src/game/GameApp.ts`, `public/audio/*`, `public/audio/LICENSES.md`.
**Verification:** every cue audible; music crossfades on alarm tier change; first page load does not autoplay (browser policy).
**Size:** M.

---

#### Task 8: Rain + lightning
**Cyclic rain intensity** — scales between Light and Heavy every 30–60 s. Heavier rain = up to 30% reduction in guard hearing radii (the sound-dampening mechanic).

**Lightning exposes the player** — on strike, a 0.8 s bright flash widens guard vision cones. **Thunder telegraphs** 1–2 s before the flash so the player can hide.

**Toggleable** via the Post-Processing: Bloom effect toggle (reuse, don't add a new setting).

**Files:** `src/game/GameApp.ts`, `src/game/weather.ts` (new).
**Verification:** 60 s session — see 1+ lightning flash preceded by thunder; confirm rain dampening takes effect during heavy phases.
**Size:** S.

**Checkpoint 3:** Phase 3 merges. Play a run in headphones to confirm mood.

---

### Phase 4 — Objective Depth

#### Task 14: Baron NPC + two-step objective
The Baron is a **stationary NPC** on a balcony / elevated terrace near map centre — no AI movement, just a narrow vision cone.

- Placeholder mesh: re-tinted Golem model for the first iteration; Baron-specific model in a future pass.
- Vision cone is tight (~45° FOV, 4 m range) but instantly triggers `Evasion` global alarm state if it catches the player (all hatches open, reinforcements spawn at max rate).
- The Baron carries a visibly distinct stylized cane — the tracker must be planted there.

**Files:** `src/game/GameApp.ts`, new `src/game/baron.ts`, asset work in `public/models/`.
**Size:** M.

#### Task 9: Tracker-plant mechanic (Hold E progress bar)
Approach the cane and hold `E` for 2–3 s. A progress bar fills above the interaction target. Moving, dashing, or being seen cancels and resets the bar. Successful plant:
- Plays a tracker-plant SFX
- Visibly changes the cane (adds a small blinking cyan light)
- Updates the objective HUD text
- Unlocks the Liquid Time vial interaction

Before planting, attempting to grab the vial shows a short hint: "Plant the tracker first."

**Files:** `src/game/GameApp.ts`, `src/main.ts`.
**Size:** S.

---

#### Task 15: Extraction phase + mid-run checkpoint
After picking up the Liquid Time vial, the run **does not end**. Instead:
- The player must reach an **extraction point** (a designated rooftop edge; animated glider-jump-off on success).
- The vial pickup location becomes a **checkpoint** — on death during the extraction phase (Easy difficulty), the player respawns at the vial with full HP and the vial still collected.
- The extraction adds a dramatic final act to every run and is where the run timer stops.

**Files:** `src/game/GameApp.ts`, asset: simple glider-off animation.
**Size:** M.

---

#### Task 10: Run timer + PBs + leaderboard hooks
- Timer starts at run begin, stops at extraction point touch.
- **PB tracking:** per character × per difficulty = 9 independent records, stored in `localStorage`.
- **Timer display:** toggleable in the pause menu, default **hidden**. Speedrunners opt in.
- **Leaderboard hooks only:** emit an `onRunComplete({ time, character, difficulty, stealthRating })` event. No backend yet. Backend integration is a documented future task.

**Files:** `src/main.ts`, `src/game/GameApp.ts`, `src/style.css`.
**Size:** S.

**Checkpoint 4:** Phase 4 merges. Full two-step run tracked end to end.

---

### Phase 5 — Controls and Accessibility

#### Task 11: Sprint stamina (per-character)
**Consumption scales by character:**
- Midnight: sprint only
- Ironclaw: sprint only (tanks do not need extra resource friction)
- Kestrel: sprint **and** ascension dash (glass-cannon acrobat must manage resources)

**Regen:** always whenever not sprinting — regenerates even while walking. Casual-friendly.

**UI:** stamina bar in the HUD; hidden while full for minimal clutter.

**Skills:** Mobility/Gadgets branches (Task 13) can add "−15% sprint cost", "+25% max stamina", etc.

**Files:** `src/game/GameApp.ts`, `src/main.ts`, `src/style.css`.
**Size:** S.

---

#### Task 12: Gamepad support
**Fixed default mapping** (Xbox layout; PS auto-detected to show PS symbols if connected):
- Left stick — move, Right stick — camera
- A — ascension dash, B — interact/plant tracker (hold), X — attack, Y — (reserved)
- RB/LB — weapon cycle, RT — sprint (hold), LT — (reserved)
- Start — pause, Back — skill tree / character select

**Rumble:** on/off toggle in the pause menu, **default on**. Rumble fires on key events (hit, ascension dash, landing, detection, bazooka blast).

**Remappable bindings** are **not** included in this pass; planned as a dedicated future update.

**Files:** new `src/game/gamepad.ts`, `src/game/GameApp.ts`.
**Verification:** full run completed with gamepad only.
**Size:** M.

**Checkpoint 5:** Phase 5 merges. Full gamepad-only playthrough verified.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The difficulty-scaling axis touches too many subsystems — one bug cascades everywhere | High | Central `difficulty.ts` config; every scaled value pulls from a single source; exhaustive unit tests per subsystem for each tier |
| Skill tree design explodes mid-implementation as we discover balance issues | High | Ship with an intentionally small first skill list (3 per branch × 4 branches = 12 skills). Add more after the system is stable. |
| Ironclaw / Kestrel meshes pull the schedule | Med | Ironclaw starts as a re-tinted Golem. Kestrel reuses `Hudhud rig.fbx`. Proper assets can land in a later cosmetic pass. |
| Multiple guards + positional audio + rain particles tank FPS | Med | Profile on a low-end reference (integrated GPU Windows laptop); dial particle count / shadow map / guard cap before cutting features |
| Global alarm state feels arbitrary because the player does not notice tier changes | Med | Triple signalling: music crossfade + HUD indicator + patrol speed/spread change. Also an on-screen "Alarm: Caution →" toast. |
| Hard-mode 4-skill loadout cap is frustrating for players who expect "all unlocks active" | Med | Communicate the cap clearly on the character-select screen; show a loadout UI before each Hard run; still allow free swaps between runs |
| Free respec + persistent progression = Hard becomes trivial after enough farming | Low | Hard's 4-skill active cap means infinite unlocks never fully trivialise it; run-rating still pressures "do more with less" |
| Gamepad fixed bindings excludes accessibility users | Low | Remap is a *documented* future task, not a vague hope. File a tracking issue when the codebase has one. |
| Vite 8 is fresh (shipped days ago); a regression could surface | Low | Already verified: build/tests/dev green. Upgrade is bundled with Phase 1 so any issue is caught early. |

## Open Questions (remaining)

- **Audio mixing decisions** beyond volume sliders — compression/normalisation, ducking music under alerts?
- **Environmental hazards** — are there any (slippery wet tiles, breakable glass vents)? Not explored in the Q&A.
- **Save/continue** — today, the only persistence is PBs + settings + unlocks. Do we need a partial-run save?
- **Localisation** — Norwegian is the user's preference in conversation; is UI localisation in scope eventually?

## Verification Before Starting

- [x] Every task has acceptance criteria
- [x] Every task has a verification step
- [x] Task dependencies identified and ordered (see graph above)
- [x] Checkpoints between phases
- [x] Decision rationale recorded in `decisions.md`
- [ ] Human final sign-off
