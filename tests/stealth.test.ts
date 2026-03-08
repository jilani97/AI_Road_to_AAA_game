import { describe, expect, it } from 'vitest';
import { isTargetVisible, normalize2, soundDirection } from '../src/game/stealth';

describe('normalize2', () => {
  it('returns zero vector for zero length input', () => {
    expect(normalize2({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
  });

  it('normalizes non-zero vectors', () => {
    expect(normalize2({ x: 3, z: 4 })).toEqual({ x: 0.6, z: 0.8 });
  });
});

describe('isTargetVisible', () => {
  it('detects a target inside range and fov', () => {
    expect(
      isTargetVisible({
        guardPosition: { x: 0, z: 0 },
        guardForward: { x: 0, z: 1 },
        targetPosition: { x: 1, z: 4 },
        maxDistance: 6,
        fovRadians: Math.PI / 2,
      }),
    ).toBe(true);
  });

  it('rejects a target outside range', () => {
    expect(
      isTargetVisible({
        guardPosition: { x: 0, z: 0 },
        guardForward: { x: 0, z: 1 },
        targetPosition: { x: 0, z: 10 },
        maxDistance: 6,
        fovRadians: Math.PI / 2,
      }),
    ).toBe(false);
  });

  it('rejects a target behind the guard', () => {
    expect(
      isTargetVisible({
        guardPosition: { x: 0, z: 0 },
        guardForward: { x: 0, z: 1 },
        targetPosition: { x: 0, z: -2 },
        maxDistance: 6,
        fovRadians: Math.PI / 2,
      }),
    ).toBe(false);
  });
});

describe('soundDirection', () => {
  it('returns normalised direction from listener to sound source', () => {
    const dir = soundDirection({ x: 0, z: 0 }, { x: 3, z: 4 });
    expect(dir.x).toBeCloseTo(0.6);
    expect(dir.z).toBeCloseTo(0.8);
  });

  it('returns zero vector when listener and sound are at the same position', () => {
    expect(soundDirection({ x: 1, z: 1 }, { x: 1, z: 1 })).toEqual({ x: 0, z: 0 });
  });

  it('returns correct direction for a purely lateral sound source', () => {
    const dir = soundDirection({ x: 0, z: 0 }, { x: 5, z: 0 });
    expect(dir.x).toBeCloseTo(1);
    expect(dir.z).toBeCloseTo(0);
  });
});
