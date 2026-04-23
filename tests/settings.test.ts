import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CAMERA,
  DEFAULT_POSTFX,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  resolveGpuTier,
  saveSettings,
  type GameSettings,
} from '../src/game/settings';

describe('resolveGpuTier', () => {
  it('returns med when no capability signals are available', () => {
    expect(resolveGpuTier({})).toBe('med');
  });

  it('returns high for strong memory and core signals', () => {
    expect(resolveGpuTier({ deviceMemory: 16, hardwareConcurrency: 16 })).toBe('high');
  });

  it('treats 8 GB RAM and 8 cores as the high-tier boundary', () => {
    expect(resolveGpuTier({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe('high');
  });

  it('stays at med when cores are mid even with high memory', () => {
    expect(resolveGpuTier({ deviceMemory: 8, hardwareConcurrency: 4 })).toBe('med');
  });

  it('returns low when memory is <= 2 GB regardless of cores', () => {
    expect(resolveGpuTier({ deviceMemory: 2, hardwareConcurrency: 16 })).toBe('low');
  });

  it('returns low when cores are <= 2 regardless of memory', () => {
    expect(resolveGpuTier({ deviceMemory: 16, hardwareConcurrency: 2 })).toBe('low');
  });

  it('returns med for a mid-tier machine', () => {
    expect(resolveGpuTier({ deviceMemory: 4, hardwareConcurrency: 4 })).toBe('med');
  });

  it('demotes from high when maxTextureSize is below 4096', () => {
    expect(
      resolveGpuTier({ deviceMemory: 16, hardwareConcurrency: 16, maxTextureSize: 2048 }),
    ).toBe('med');
  });

  it('returns low when maxTextureSize is below 2048 even on an otherwise strong machine', () => {
    expect(
      resolveGpuTier({ deviceMemory: 16, hardwareConcurrency: 16, maxTextureSize: 1024 }),
    ).toBe('low');
  });
});

describe('loadSettings / saveSettings', () => {
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

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns GPU-derived defaults on first boot when nothing is stored', () => {
    const settings = loadSettings({ deviceMemory: 16, hardwareConcurrency: 16 });
    expect(settings.shadowTier).toBe('high');
    expect(settings.postfx).toEqual(DEFAULT_POSTFX);
    expect(settings.camera).toEqual(DEFAULT_CAMERA);
  });

  it('round-trips saved settings through localStorage', () => {
    const saved: GameSettings = {
      shadowTier: 'low',
      postfx: { bloom: false, fxaa: true, chromaticAberration: false },
      camera: { mode: 'fade', minDistance: 2 },
    };
    saveSettings(saved);
    expect(loadSettings({})).toEqual(saved);
  });

  it('falls back to auto-detected defaults when the stored payload is malformed', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not valid json');
    const settings = loadSettings({ deviceMemory: 2 });
    expect(settings.shadowTier).toBe('low');
    expect(settings.postfx).toEqual(DEFAULT_POSTFX);
    expect(settings.camera).toEqual(DEFAULT_CAMERA);
  });

  it('backfills default camera settings when a stored payload predates the camera block', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        shadowTier: 'med',
        postfx: { bloom: true, fxaa: true, chromaticAberration: true },
      }),
    );
    expect(loadSettings({}).camera).toEqual(DEFAULT_CAMERA);
  });

  it('survives a localStorage that throws on access', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    vi.stubGlobal('localStorage', throwingStorage);
    expect(() =>
      saveSettings({
        shadowTier: 'med',
        postfx: DEFAULT_POSTFX,
        camera: DEFAULT_CAMERA,
      }),
    ).not.toThrow();
    expect(loadSettings({}).shadowTier).toBe('med');
  });
});
