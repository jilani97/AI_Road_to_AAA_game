import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DIFFICULTY,
  __resetDifficulty,
  getDifficulty,
  hydrateDifficulty,
  isDifficulty,
  scaledByDifficulty,
  setDifficulty,
} from '../src/game/difficulty';
import { SETTINGS_STORAGE_KEY } from '../src/game/settings';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('isDifficulty', () => {
  it('accepts the three canonical values', () => {
    expect(isDifficulty('easy')).toBe(true);
    expect(isDifficulty('medium')).toBe(true);
    expect(isDifficulty('hard')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isDifficulty('nightmare')).toBe(false);
    expect(isDifficulty(undefined)).toBe(false);
    expect(isDifficulty(1)).toBe(false);
  });
});

describe('difficulty accessor', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    __resetDifficulty();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to medium', () => {
    expect(getDifficulty()).toBe(DEFAULT_DIFFICULTY);
    expect(DEFAULT_DIFFICULTY).toBe('medium');
  });

  it('setDifficulty updates the cached value and persists it', () => {
    setDifficulty('hard');
    expect(getDifficulty()).toBe('hard');
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).difficulty).toBe('hard');
  });

  it('hydrateDifficulty restores the value from storage on boot', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        shadowTier: 'med',
        postfx: { bloom: true, fxaa: true, chromaticAberration: true },
        camera: { mode: 'orbit', minDistance: 4 },
        difficulty: 'easy',
      }),
    );
    expect(hydrateDifficulty()).toBe('easy');
    expect(getDifficulty()).toBe('easy');
  });

  it('setting the same difficulty twice is a no-op (does not re-persist)', () => {
    setDifficulty('easy');
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    setDifficulty('easy');
    // If it were re-persisting, the key would reappear.
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });
});

describe('scaledByDifficulty', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    __resetDifficulty();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picks the value matching the active difficulty', () => {
    const detectionSeconds = { easy: 1.0, medium: 0.5, hard: 0.2 };
    expect(scaledByDifficulty(detectionSeconds)).toBe(0.5);
    setDifficulty('hard');
    expect(scaledByDifficulty(detectionSeconds)).toBe(0.2);
    setDifficulty('easy');
    expect(scaledByDifficulty(detectionSeconds)).toBe(1.0);
  });

  it('works with non-numeric payloads (e.g. string labels)', () => {
    const knockoutBehaviour = {
      easy: 'persistent',
      medium: 'wake-30s',
      hard: 'wake-12s-reinforce',
    };
    expect(scaledByDifficulty(knockoutBehaviour)).toBe('wake-30s');
    setDifficulty('hard');
    expect(scaledByDifficulty(knockoutBehaviour)).toBe('wake-12s-reinforce');
  });
});
