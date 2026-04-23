import { describe, expect, it } from 'vitest';
import {
  colliderToAabb,
  distance3,
  pointInAabb,
  raycastHitsAnyAabb,
  segmentHitsAabb,
  type Aabb,
} from '../src/game/collision';

const unitBox: Aabb = { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };

describe('colliderToAabb', () => {
  it('converts a (cx, cz) + (w, d) + y-range collider into a min/max AABB', () => {
    expect(
      colliderToAabb({ x: 2, z: -3, w: 4, d: 6, topY: 5, bottomY: 0 }),
    ).toEqual({ minX: 0, maxX: 4, minY: 0, maxY: 5, minZ: -6, maxZ: 0 });
  });
});

describe('pointInAabb', () => {
  it('returns true for a point inside the box', () => {
    expect(pointInAabb({ x: 0, y: 0, z: 0 }, unitBox)).toBe(true);
  });

  it('treats the exact boundary as inside', () => {
    expect(pointInAabb({ x: 1, y: 1, z: 1 }, unitBox)).toBe(true);
  });

  it('returns false for a point outside in any axis', () => {
    expect(pointInAabb({ x: 1.01, y: 0, z: 0 }, unitBox)).toBe(false);
    expect(pointInAabb({ x: 0, y: -1.01, z: 0 }, unitBox)).toBe(false);
    expect(pointInAabb({ x: 0, y: 0, z: 2 }, unitBox)).toBe(false);
  });
});

describe('segmentHitsAabb', () => {
  it('detects a segment that passes through the box', () => {
    expect(
      segmentHitsAabb({ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, unitBox),
    ).toBe(true);
  });

  it('misses when the segment runs parallel outside the box', () => {
    expect(
      segmentHitsAabb({ x: -5, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }, unitBox),
    ).toBe(false);
  });

  it('misses when both endpoints are on the same side and segment does not extend to box', () => {
    expect(
      segmentHitsAabb({ x: 2, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, unitBox),
    ).toBe(false);
  });

  it('detects when the segment originates inside the box', () => {
    expect(
      segmentHitsAabb({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, unitBox),
    ).toBe(true);
  });

  it('handles a zero-length segment inside the box', () => {
    expect(
      segmentHitsAabb({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, unitBox),
    ).toBe(true);
  });

  it('handles a zero-length segment outside the box', () => {
    expect(
      segmentHitsAabb({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }, unitBox),
    ).toBe(false);
  });

  it('detects a diagonal piercing segment', () => {
    expect(
      segmentHitsAabb({ x: -5, y: -5, z: -5 }, { x: 5, y: 5, z: 5 }, unitBox),
    ).toBe(true);
  });
});

describe('raycastHitsAnyAabb', () => {
  const a: Aabb = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1 };
  const b: Aabb = { minX: 5, maxX: 6, minY: 0, maxY: 2, minZ: 5, maxZ: 6 };

  it('returns true when any box intersects the line of sight', () => {
    expect(
      raycastHitsAnyAabb({ x: -5, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, [a, b]),
    ).toBe(true);
  });

  it('returns false when no box sits between the origin and target', () => {
    expect(
      raycastHitsAnyAabb({ x: -5, y: 1, z: 10 }, { x: 5, y: 1, z: 10 }, [a, b]),
    ).toBe(false);
  });

  it('returns false for an empty collider set', () => {
    expect(
      raycastHitsAnyAabb({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, []),
    ).toBe(false);
  });
});

describe('distance3', () => {
  it('returns the euclidean distance between two 3-D points', () => {
    expect(distance3({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 })).toBeCloseTo(5);
    expect(distance3({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(0);
  });
});
