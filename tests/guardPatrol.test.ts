import { describe, expect, it } from 'vitest';
import {
  GUARD_COUNT_BY_DIFFICULTY,
  createRng,
  defaultZonesForDifficulty,
  isInsideZone,
  nextPatrolWaypoint,
  zoneCentre,
  type PatrolZone,
} from '../src/game/guardPatrol';
import type { Difficulty } from '../src/game/settings';

describe('GUARD_COUNT_BY_DIFFICULTY', () => {
  it('matches plan Task 6 Q1: Easy 2 / Medium 3 / Hard 5', () => {
    expect(GUARD_COUNT_BY_DIFFICULTY.easy).toBe(2);
    expect(GUARD_COUNT_BY_DIFFICULTY.medium).toBe(3);
    expect(GUARD_COUNT_BY_DIFFICULTY.hard).toBe(5);
  });
});

describe('defaultZonesForDifficulty', () => {
  it.each<[Difficulty]>([['easy'], ['medium'], ['hard']])(
    '%s returns exactly GUARD_COUNT_BY_DIFFICULTY zones',
    (difficulty) => {
      expect(defaultZonesForDifficulty(difficulty)).toHaveLength(
        GUARD_COUNT_BY_DIFFICULTY[difficulty],
      );
    },
  );

  it.each<[Difficulty]>([['easy'], ['medium'], ['hard']])(
    'every %s zone has positive area (minX < maxX, minZ < maxZ)',
    (difficulty) => {
      for (const zone of defaultZonesForDifficulty(difficulty)) {
        expect(zone.minX).toBeLessThan(zone.maxX);
        expect(zone.minZ).toBeLessThan(zone.maxZ);
      }
    },
  );
});

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces values in [0, 1)', () => {
    const r = createRng(1);
    for (let i = 0; i < 100; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds produce different streams', () => {
    const a = createRng(1);
    const b = createRng(2);
    const aSeq = Array.from({ length: 10 }, () => a.next());
    const bSeq = Array.from({ length: 10 }, () => b.next());
    expect(aSeq).not.toEqual(bSeq);
  });
});

describe('nextPatrolWaypoint', () => {
  const zone: PatrolZone = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

  it('always lands inside the zone', () => {
    const rng = createRng(7);
    const current = { x: 0, z: 0 };
    for (let i = 0; i < 50; i++) {
      const wp = nextPatrolWaypoint(current, zone, rng);
      expect(isInsideZone(wp, zone)).toBe(true);
    }
  });

  it('maintains min separation on typical draws', () => {
    const rng = createRng(99);
    const current = { x: 0, z: 0 };
    const minSeparation = 4;
    let respected = 0;
    const trials = 30;
    for (let i = 0; i < trials; i++) {
      const wp = nextPatrolWaypoint(current, zone, rng, minSeparation);
      const d = Math.hypot(wp.x - current.x, wp.z - current.z);
      if (d >= minSeparation) respected += 1;
    }
    // At least 90% of draws should respect the separation in a 20x20 zone.
    expect(respected).toBeGreaterThanOrEqual(Math.floor(trials * 0.9));
  });

  it('returns a point even when min-separation is impossible (tiny zone)', () => {
    const tight: PatrolZone = { minX: 0, maxX: 0.1, minZ: 0, maxZ: 0.1 };
    const current = { x: 0.05, z: 0.05 };
    const wp = nextPatrolWaypoint(current, tight, createRng(1), 10);
    expect(isInsideZone(wp, tight)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const current = { x: 0, z: 0 };
    const wpA = nextPatrolWaypoint(current, zone, createRng(5));
    const wpB = nextPatrolWaypoint(current, zone, createRng(5));
    expect(wpA).toEqual(wpB);
  });
});

describe('zoneCentre', () => {
  it('returns the midpoint of the zone', () => {
    expect(zoneCentre({ minX: -10, maxX: 10, minZ: -4, maxZ: 6 })).toEqual({
      x: 0,
      z: 1,
    });
  });
});

describe('isInsideZone', () => {
  const zone: PatrolZone = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  it('treats the closed rectangle as inside', () => {
    expect(isInsideZone({ x: -5, z: -5 }, zone)).toBe(true);
    expect(isInsideZone({ x: 5, z: 5 }, zone)).toBe(true);
    expect(isInsideZone({ x: 0, z: 0 }, zone)).toBe(true);
  });
  it('rejects points outside', () => {
    expect(isInsideZone({ x: -5.1, z: 0 }, zone)).toBe(false);
    expect(isInsideZone({ x: 0, z: 5.1 }, zone)).toBe(false);
  });
});
