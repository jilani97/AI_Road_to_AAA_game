# Neon Tail Playability TODO

Ordered checklist. Full spec in [plan.md](./plan.md). Decision rationale in [decisions.md](./decisions.md).

## Phase 0 — Infra (bundled with Phase 1)

- [x] **0.** Vite 8.0.9 + Vitest 4.1.5 upgrade (bundled into Phase 1 merge)

## Phase 1 — Foundation Fixes

- [x] **1.** Pause-menu graphics toggles wired (shadow Low/Med/High tiers, per-effect postfx, auto-detect GPU default, persist to localStorage)
  - [x] 1a: `settings.ts` module + `resolveGpuTier` pure fn + unit tests, pause-menu UI rebuilt (3 shadow tiers + Bloom/FXAA/Chromatic toggles), live-persisted to `localStorage` under `neonTail.settings.v1`.
  - [x] 1b: `GameApp.applyGraphicsSettings` — `ShadowGenerator` on the sun (blur ESM, map size 1024/2048/4096 per tier), `DefaultRenderingPipeline` with live bloom/FXAA/chromatic toggles, auto-enrol via `scene.onNewMeshAddedObservable`, decorative disc hidden when real shadows render. Needs in-browser smoke test (shadow quality visible, toggles flip effects live).
- [x] **2.** Projectile vs environment collision (AABB, spark burst, scale-down fade) + bazooka AoE explosion + sword line-of-sight raycast — `collision.ts` pure helpers (`colliderToAabb`, `segmentHitsAabb`, `raycastHitsAnyAabb`, `distance3`) with 15 unit tests; projectiles segment-test each frame against cached collider AABBs (no tunnelling on fast shots); 150 ms scale-down fade; 8-sphere spark burst on impact; bazooka impact triggers 2.5 m AoE (guard push + hit-react + 16-spark orange burst); sword melee gated by a player-to-guard AABB raycast.
- [x] **3.** Camera wall collision with two user settings: Camera Mode (Orbit default / Fade geometry) and Min Distance (8 / 4 default / 2 m) — settings extended with `camera: { mode, minDistance }` block + backfill for legacy payloads; pause menu gets two new segmented controls (persisted to `neonTail.settings.v1`); `GameApp.applyCameraSettings` drives `camera.lowerRadiusLimit`, toggles `scene.collisionsEnabled` + `camera.checkCollisions` + per-mesh `checkCollisions` on fadeable geometry for orbit mode; fade mode tests each collider AABB per frame and sets obstructing meshes' `visibility = 0.35`, un-fading cleanly on clear. Orbit is default, 4 m default min distance.

### Checkpoint 1
- [ ] Build + tests green. 5-min playtest clean. Merge as one PR bundling Vite 8.

## Phase 2 — Guard AI, Progression, Characters

- [ ] **13.** Difficulty config + skill tree + character roster (foundational — blocks everything else in Phase 2+)
  - [x] 13a: `difficulty.ts` central config (Easy / Medium / Hard, default Medium) — settings-backed, pause-menu segmented control, `getDifficulty()` / `setDifficulty()` / `scaledByDifficulty()` API for subsystems.
  - [x] 13b: `characters.ts` roster data (Midnight / Ironclaw / Kestrel) — HP, speed/jump/sonar/damage multipliers, footstep noise, i-frame modifier, starting skills. **Character-select UI still pending** (data layer only).
  - [x] 13c: `skills.ts` — 4 branches (Mobility / Senses / Silence / Gadgets) × (tier-1 anchor + 2 tier-2 children), prerequisite validation, `unlockSkill` / `canUnlock` / `refundAllSkills`, Hard-mode 4-skill active cap with `canAddActive` / `addActive` / `removeActive`. **Skill-tree UI still pending**.
  - [x] 13d: `currency.ts` — single balance (storage key `neonTail.currency.v1`), `earn(amount, source)` / `spend(amount)` / `hydrateCurrency()`, safe-storage + clamping. **HUD + in-game pickup hooks still pending**.
  - [ ] 13-UI: Character-select screen, skill-tree screen, currency HUD, pickup + end-of-run earning hooks. (Deferred to a follow-up slice — depends on none of the Phase 2 gameplay tasks.)
  - [x] 13-wire: Player speed, jump, and sonar range now pulled from `CHARACTERS[getCharacter(DEFAULT_CHARACTER)].stats` via `GameApp.character`. Public `setCharacter(id)` / `getCharacter()` exposed for the forthcoming UI.
- [ ] **4.** Guard AI state machine (Patrol → Suspicious → Investigating → Alerted → Chasing → Returning) with all per-difficulty scaling: detection timings, hearing radii, give-up timer, guard comms, investigating behaviour, knockout persistence, currency interaction, state indicators (icon + cone colour)
  - [x] 4a: Pure `guardAi.ts` state machine — 6 states, per-difficulty transition timings (Patrol→Suspicious 1.0/0.5/0.2 s, Suspicious→Alerted 1.5/0.8/0.3 s, Alerted give-up 3/6/10 s), vision + noise driven transitions, 6 s investigation budget, shortcut inputs (`reachedLastKnownPosition`, `nearPatrolPath`), `guardStateIcon` helper. 26 unit tests covering every transition × difficulty.
  - [x] 4b: `tickGuardAi` wired into `GameApp.updateGuard` — movement branches on state (patrol/returning walk the route; suspicious/alerted stop and face the LKP; investigating walks to LKP; chasing walks to the current player position); vision cone recolours per state (grey-teal patrol / yellow suspicious+investigating / orange alerted / red chasing); status bar announces transitions; loss condition is now "guard is chasing AND within 1.2 m of player" instead of any vision contact. Noise emitted by ascension dash (6 m), landing above a vertical-speed threshold (7 m), and any weapon attack (8 m); guard hears if noise is within `min(guard hearing radius 10 m, action radius)`. `lastKnownPlayerPosition` tracked; `nearPatrolPath` heuristic fed.
  - [x] 4c: Guard comms — pure `guardComms.ts` helper + `shouldDropIntoInvestigating` (Easy 0 m / Medium 10 m / Hard Infinity). `GameApp.broadcastAlertToNeighbours` runs whenever a guard transitions INTO Alerted; qualifying listeners jump straight to `investigating` and inherit the sender's LKP. Already-escalated guards and KO'd guards are skipped. 14 unit tests.
  - [x] 4d: Knockout model — any successful hit (sword melee / projectile / bazooka AoE) now fully knocks the guard out. Wake timing scales by difficulty: Easy permanent / Medium 30 s / Hard 12 s. On wake the guard re-enters `suspicious`. Coin drop: Easy 25 flat / Medium 25 once per guard per run / Hard 25 → 12 → 6 → 3 diminishing. Hard additionally rescinds the last drop (via `currency.spend`) and flashes a reinforcement-request message on wake; actual reinforcement spawning lives in Task 6e. `currency.hydrateCurrency()` now runs at GameApp boot.
- [x] **5.** Player HP system (core loop) — HP pulled from `CHARACTERS[id].stats.hp`; `takeDamage(amount)` gated by i-frames (base Easy 1.0 / Med 0.6 / Hard 0.3 s + character modifier — Kestrel +0.3 s, Ironclaw −0.2 s, clamped ≥ 0.1 s). Guard deals melee damage (Easy 1 / Med 1 / Hard 2) when `alerted`/`chasing` and within `GUARD_CATCH_DISTANCE`. 0-HP handling: Easy respawns at start with full HP (vial progress preserved); Medium revives at 1 HP if `gadgets.revive_token` is active and unused; Hard or no-revive → `hasLost`. HUD: new Health card with per-character pip row (full / half / empty) via `onHealthChange` callback. Damage flash: red radial-gradient vignette + CSS camera-shake via `onDamaged`; both suppressed by the new pause-menu "Reduce camera motion" accessibility toggle (`GameSettings.reduceMotion`, default false). **Pending:** Easy passive HP regen after 5 s unseen; consumables shop flow (depends on Task 13 UI for currency display).
- [x] **6.** Multiple guards (count scales with difficulty + reinforcements via rooftop hatches, zone-based patrols with semi-random wandering, global alarm state with decay: Normal → Caution → Alert → Evasion)
  - [x] 6a: Pure `alarmState.ts` — `AlarmTier` (Normal/Caution/Alert/Evasion), counter + thresholds (0/1/2/4, cap 5), 5 bump causes (baron_sees_player slams straight to Evasion), per-difficulty decay (Easy 0.5 /s / Medium 0.25 /s / Hard 0.1 /s — Alert→Normal in ~4/8/20 s). 17 unit tests.
  - [x] 6b: Multi-guard refactor. New `Guard` interface (`src/game/guard.ts`) + `guards: Guard[]` replaces flat `guardPivot / guardAi / guardKnockdown / …` fields. Noise queue changed to `pendingNoises: NoiseEvent[]` consumed per-guard. Sword targets nearest non-KO'd guard; projectiles stop on first non-KO'd sphere; bazooka AoE hits all guards in radius; sonar tracks nearest non-KO'd; player-guard collision resolved against each guard in turn. Still 1 guard on screen — pure behavioural refactor.
  - [x] 6c: Patrol zones + semi-random wandering + count scaling. Pure `guardPatrol.ts` (zones, seeded mulberry32 RNG, `nextPatrolWaypoint` with min-separation retry, `defaultZonesForDifficulty`, `GUARD_COUNT_BY_DIFFICULTY = {easy:2, medium:3, hard:5}`). 17 unit tests. Guards now spawn N per difficulty across N authored zones; first guard gets the Golem rig, rest use tinted capsule placeholders until per-guard animation lands.
  - [x] 6d: Global alarm wired into GameApp. `bumpAlarm` fires on guard→alerted/chasing transitions; `updateAlarm` decays each frame while no guard is aware. New `onAlarmChange(tier)` callback. Escalations fire a status toast ("Alarm: Alert!"); HUD gets a tier pill (teal-grey Normal → yellow Caution → orange Alert → red-pulsing Evasion).
  - [x] 6e: Rooftop hatches + reinforcements. 4 authored hatch meshes on the outer tall rooftops; cyan flash on open. Every tier escalation into Alert/Evasion spawns one reinforcement from the nearest unused hatch. Per-difficulty cap: Easy 0 / Medium 2 / Hard 4. Reinforcements get a 10×10 m patrol zone around their hatch so they stay near their entry point. `reset()` disposes reinforcements and un-uses hatches.

### Checkpoint 2
- [ ] Full state machine + progression + 3 characters working end-to-end. 10-min playtest with ≥2 near-miss moments documented per character × difficulty. **Remaining gates:** Task 13-UI, Task 5 Easy-HP-regen + consumables shop, per-guard animation polish pass.

## Phase 3 — Sensory Polish

- [ ] **7.** Audio system — 3-layer music crossfade (ambient/caution/alert) driven by alarm state, 3D positional for all world sounds, Kenney+Freesound CC0 assets, Master/SFX/Music volume sliders
- [ ] **8.** Weather — cyclic rain intensity (dampens sound 0–30%), lightning exposure (0.8 s vision boost for guards) with 1–2 s thunder telegraph, gated behind bloom toggle

### Checkpoint 3
- [ ] Headphone playtest — music crossfades correctly on alarm tier change, lightning/thunder rhythm feels fair.

## Phase 4 — Objective Depth

- [ ] **14.** Baron NPC — stationary, balcony placement, narrow vision cone, seeing the player pushes global alarm straight to Evasion (opens all hatches + max reinforcements)
- [ ] **9.** Tracker-plant mechanic — hold E for 2–3 s on the Baron's cane, progress bar, cancel-on-interrupt, SFX + visual cane change on success
- [ ] **15.** Extraction phase + mid-run checkpoint at the vial — grab vial, must reach extract point (rooftop edge, glider-jump animation), death during extraction respawns at vial on Easy
- [ ] **10.** Run timer + PBs (per character × per difficulty = 9 records) + leaderboard event hooks (no backend), timer display toggleable and default hidden

### Checkpoint 4
- [ ] Full two-step run (tracker → vial → extract) tracked and saved. Timer + PB correctly updates across reloads.

## Phase 5 — Controls and Accessibility

- [ ] **11.** Sprint stamina — consumption scales per character (Midnight/Ironclaw sprint-only, Kestrel sprint+dash), regen always while not sprinting (including while walking), stamina bar in HUD
- [ ] **12.** Gamepad — fixed Xbox-default bindings (PS auto-detected icons), rumble toggle (default on) with key-event rumble; remap deferred to a future update

### Checkpoint 5
- [ ] Full gamepad-only playthrough. Rumble feels helpful, not annoying.

---

## Future Specs (deliberately out of scope for this pass)

- [ ] `future-specs/character-kits.md` — full unique signature abilities per character (Q9 option c)
- [ ] `future-specs/guard-cover-search.md` — active cover-point checking for guards in Investigating state (Q16 option d)
- [ ] `future-specs/leaderboard-backend.md` — online global leaderboard using the Task 10 event hooks
- [ ] `future-specs/gamepad-remapping.md` — full rebinding UI for the pause menu
- [ ] `future-specs/ghost-run-bonus.md` — Silence-branch skill rewarding no-alert runs with 2× currency
- [ ] Act II — The Iron Transit (maglev kinetic platforming)
