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
- [ ] **4.** Guard AI state machine (Patrol → Suspicious → Investigating → Alerted → Chasing → Returning) with all per-difficulty scaling: detection timings, hearing radii, give-up timer, guard comms, investigating behaviour, knockout persistence, currency interaction, state indicators (icon + cone colour)
- [ ] **5.** Player HP system (per-character base HP, difficulty-scaled regen/consumables, 0-HP handling, damage sources, damage amounts, i-frames with character modifier, red vignette, reduce-motion toggle)
- [ ] **6.** Multiple guards (count scales with difficulty + reinforcements via rooftop hatches, zone-based patrols with semi-random wandering, global alarm state with decay: Normal → Caution → Alert → Evasion)

### Checkpoint 2
- [ ] Full state machine + progression + 3 characters working end-to-end. 10-min playtest with ≥2 near-miss moments documented per character × difficulty.

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
