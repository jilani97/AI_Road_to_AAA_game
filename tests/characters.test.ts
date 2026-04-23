import { describe, expect, it } from 'vitest';
import {
  CHARACTER_ORDER,
  CHARACTERS,
  DEFAULT_CHARACTER,
  getCharacter,
  isCharacterId,
} from '../src/game/characters';

describe('roster integrity', () => {
  it('exposes three distinct characters in the selection order', () => {
    expect(CHARACTER_ORDER).toHaveLength(3);
    expect(new Set(CHARACTER_ORDER).size).toBe(3);
    for (const id of CHARACTER_ORDER) {
      expect(CHARACTERS[id]).toBeDefined();
      expect(CHARACTERS[id].id).toBe(id);
    }
  });

  it('names Midnight as the default character', () => {
    expect(DEFAULT_CHARACTER).toBe('midnight');
  });

  it('encodes the canonical HP budget per the design doc (Midnight 3 / Ironclaw 5 / Kestrel 2)', () => {
    expect(CHARACTERS.midnight.stats.hp).toBe(3);
    expect(CHARACTERS.ironclaw.stats.hp).toBe(5);
    expect(CHARACTERS.kestrel.stats.hp).toBe(2);
  });

  it('differentiates mobility — Kestrel is faster and jumps higher than Midnight, Ironclaw slower', () => {
    expect(CHARACTERS.kestrel.stats.speedMultiplier).toBeGreaterThan(
      CHARACTERS.midnight.stats.speedMultiplier,
    );
    expect(CHARACTERS.kestrel.stats.jumpMultiplier).toBeGreaterThan(
      CHARACTERS.midnight.stats.jumpMultiplier,
    );
    expect(CHARACTERS.ironclaw.stats.speedMultiplier).toBeLessThan(
      CHARACTERS.midnight.stats.speedMultiplier,
    );
  });

  it('gives each character exactly two starting skills', () => {
    for (const id of CHARACTER_ORDER) {
      expect(CHARACTERS[id].startingSkills).toHaveLength(2);
      expect(new Set(CHARACTERS[id].startingSkills).size).toBe(2);
    }
  });
});

describe('isCharacterId', () => {
  it('accepts canonical ids', () => {
    expect(isCharacterId('midnight')).toBe(true);
    expect(isCharacterId('ironclaw')).toBe(true);
    expect(isCharacterId('kestrel')).toBe(true);
  });

  it('rejects unknown ids', () => {
    expect(isCharacterId('baron')).toBe(false);
    expect(isCharacterId(undefined)).toBe(false);
    expect(isCharacterId(42)).toBe(false);
  });
});

describe('getCharacter', () => {
  it('returns the full profile for a known id', () => {
    expect(getCharacter('midnight').name).toBe('Midnight');
    expect(getCharacter('ironclaw').name).toBe('Ironclaw');
    expect(getCharacter('kestrel').name).toBe('Kestrel');
  });
});
