import type { Difficulty } from './settings';
import type { Vector2Like } from './stealth';

/** A rectangular XZ region a guard patrols within. Task 6 Q3 — "zones with
 *  semi-random wandering". Bounds are authored; guards are free to visit
 *  any XZ inside them. */
export interface PatrolZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Deterministic 0..1 RNG source. Exposed as an interface so tests can inject
 *  a predictable sequence and runs can stay reproducible within a given seed. */
export interface Rng {
  next(): number;
}

/** mulberry32 — tiny, fast, deterministic. Good enough for patrol picking. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Number of starting guards per difficulty (plan Task 6 Q1). Reinforcements
 *  from Task 6e spawn on top of this count as the alarm escalates. */
export const GUARD_COUNT_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 2,
  medium: 3,
  hard: 5,
};

/** Inner bound for zone layouts. Player movement is clamped at ±27 in GameApp,
 *  but guards stay well inside to avoid pathing into the perimeter wall meshes. */
const ZONE_BOUND = 20;

/** Authored zone layouts — one zone per starting guard. Returns exactly
 *  `GUARD_COUNT_BY_DIFFICULTY[difficulty]` zones, in a stable order. */
export function defaultZonesForDifficulty(difficulty: Difficulty): PatrolZone[] {
  switch (difficulty) {
    case 'easy':
      // North half + South half.
      return [
        { minX: -ZONE_BOUND, maxX: ZONE_BOUND, minZ: 2, maxZ: ZONE_BOUND },
        { minX: -ZONE_BOUND, maxX: ZONE_BOUND, minZ: -ZONE_BOUND, maxZ: -2 },
      ];
    case 'medium':
      // Three horizontal strips (N / Middle / S).
      return [
        { minX: -ZONE_BOUND, maxX: ZONE_BOUND, minZ: 8, maxZ: ZONE_BOUND },
        { minX: -ZONE_BOUND, maxX: ZONE_BOUND, minZ: -6, maxZ: 6 },
        { minX: -ZONE_BOUND, maxX: ZONE_BOUND, minZ: -ZONE_BOUND, maxZ: -8 },
      ];
    case 'hard':
      // Four outer quadrants + a central patrol ring.
      return [
        { minX: -ZONE_BOUND, maxX: -2, minZ: 2, maxZ: ZONE_BOUND },
        { minX: 2, maxX: ZONE_BOUND, minZ: 2, maxZ: ZONE_BOUND },
        { minX: -ZONE_BOUND, maxX: -2, minZ: -ZONE_BOUND, maxZ: -2 },
        { minX: 2, maxX: ZONE_BOUND, minZ: -ZONE_BOUND, maxZ: -2 },
        { minX: -6, maxX: 6, minZ: -6, maxZ: 6 },
      ];
  }
}

/** Centroid of a zone — used to drop a newly-spawned guard somewhere reasonable. */
export function zoneCentre(zone: PatrolZone): Vector2Like {
  return {
    x: (zone.minX + zone.maxX) / 2,
    z: (zone.minZ + zone.maxZ) / 2,
  };
}

function randomInside(zone: PatrolZone, rng: Rng): Vector2Like {
  return {
    x: zone.minX + rng.next() * (zone.maxX - zone.minX),
    z: zone.minZ + rng.next() * (zone.maxZ - zone.minZ),
  };
}

/** Picks a new random patrol waypoint inside `zone`. Retries up to 6 times to
 *  land at least `minSeparation` metres from the current position, so guards
 *  don't re-pick the same tile twice in a row. If every retry is too close
 *  (tiny zone edge case), the last pick is accepted — guarantees a result. */
export function nextPatrolWaypoint(
  currentPosition: Vector2Like,
  zone: PatrolZone,
  rng: Rng,
  minSeparation: number = 4,
): Vector2Like {
  const minSeparationSq = minSeparation * minSeparation;
  let pick = randomInside(zone, rng);
  for (let attempt = 0; attempt < 6; attempt++) {
    const dx = pick.x - currentPosition.x;
    const dz = pick.z - currentPosition.z;
    if (dx * dx + dz * dz >= minSeparationSq) {
      return pick;
    }
    pick = randomInside(zone, rng);
  }
  return pick;
}

export function isInsideZone(position: Vector2Like, zone: PatrolZone): boolean {
  return (
    position.x >= zone.minX &&
    position.x <= zone.maxX &&
    position.z >= zone.minZ &&
    position.z <= zone.maxZ
  );
}
