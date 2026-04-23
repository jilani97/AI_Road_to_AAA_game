export type ShadowTier = 'low' | 'med' | 'high';

export interface PostFxSettings {
  bloom: boolean;
  fxaa: boolean;
  chromaticAberration: boolean;
}

export type CameraMode = 'orbit' | 'fade';
export type CameraMinDistance = 2 | 4 | 8;

export interface CameraSettings {
  mode: CameraMode;
  minDistance: CameraMinDistance;
}

export interface GameSettings {
  shadowTier: ShadowTier;
  postfx: PostFxSettings;
  camera: CameraSettings;
}

export interface GpuCapabilities {
  /** navigator.deviceMemory in GB. Not exposed by Firefox/Safari — treat as undefined. */
  deviceMemory?: number;
  /** navigator.hardwareConcurrency — logical CPU cores. */
  hardwareConcurrency?: number;
  /** Babylon's engine.getCaps().maxTextureSize. Optional — caller decides whether to pass it. */
  maxTextureSize?: number;
}

export const SETTINGS_STORAGE_KEY = 'neonTail.settings.v1';

export const DEFAULT_POSTFX: PostFxSettings = {
  bloom: true,
  fxaa: true,
  chromaticAberration: true,
};

export const DEFAULT_CAMERA: CameraSettings = {
  mode: 'orbit',
  minDistance: 4,
};

export const SHADOW_MAP_SIZE: Record<ShadowTier, number> = {
  low: 1024,
  med: 2048,
  high: 4096,
};

export function resolveGpuTier(caps: GpuCapabilities): ShadowTier {
  const { deviceMemory, hardwareConcurrency, maxTextureSize } = caps;

  const highMemory = deviceMemory !== undefined && deviceMemory >= 8;
  const highCores = hardwareConcurrency !== undefined && hardwareConcurrency >= 8;
  const textureAllowsHigh = maxTextureSize === undefined || maxTextureSize >= 4096;

  if (highMemory && highCores && textureAllowsHigh) {
    return 'high';
  }

  const lowMemory = deviceMemory !== undefined && deviceMemory <= 2;
  const lowCores = hardwareConcurrency !== undefined && hardwareConcurrency <= 2;
  const lowTexture = maxTextureSize !== undefined && maxTextureSize < 2048;

  if (lowMemory || lowCores || lowTexture) {
    return 'low';
  }

  return 'med';
}

export function getBrowserGpuCapabilities(): GpuCapabilities {
  if (typeof navigator === 'undefined') {
    return {};
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  };
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (incognito denial, SSR, quota) — settings stay in-memory only
  }
}

function isShadowTier(value: unknown): value is ShadowTier {
  return value === 'low' || value === 'med' || value === 'high';
}

function isCameraMode(value: unknown): value is CameraMode {
  return value === 'orbit' || value === 'fade';
}

function isCameraMinDistance(value: unknown): value is CameraMinDistance {
  return value === 2 || value === 4 || value === 8;
}

function parseCamera(raw: unknown): CameraSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CAMERA };
  const data = raw as Partial<CameraSettings>;
  return {
    mode: isCameraMode(data.mode) ? data.mode : DEFAULT_CAMERA.mode,
    minDistance: isCameraMinDistance(data.minDistance)
      ? data.minDistance
      : DEFAULT_CAMERA.minDistance,
  };
}

function parseSettings(raw: string): GameSettings | null {
  try {
    const data = JSON.parse(raw) as Partial<GameSettings>;
    if (!isShadowTier(data.shadowTier) || !data.postfx) {
      return null;
    }
    return {
      shadowTier: data.shadowTier,
      postfx: {
        bloom: data.postfx.bloom !== false,
        fxaa: data.postfx.fxaa !== false,
        chromaticAberration: data.postfx.chromaticAberration !== false,
      },
      camera: parseCamera(data.camera),
    };
  } catch {
    return null;
  }
}

export function loadSettings(caps: GpuCapabilities = getBrowserGpuCapabilities()): GameSettings {
  const raw = safeGetItem(SETTINGS_STORAGE_KEY);
  if (raw) {
    const parsed = parseSettings(raw);
    if (parsed) {
      return parsed;
    }
  }
  return {
    shadowTier: resolveGpuTier(caps),
    postfx: { ...DEFAULT_POSTFX },
    camera: { ...DEFAULT_CAMERA },
  };
}

export function saveSettings(settings: GameSettings): void {
  safeSetItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
