import {
  DEFAULT_DIFFICULTY,
  loadSettings,
  saveSettings,
  type Difficulty,
} from './settings';

export type { Difficulty } from './settings';
export { DEFAULT_DIFFICULTY, isDifficulty } from './settings';

/** Cached copy of the active difficulty. Every Phase-2+ mechanic reads via `getDifficulty()` —
 *  subsystems should never branch on an inline hard-coded difficulty string. */
let activeDifficulty: Difficulty = DEFAULT_DIFFICULTY;

/** Number of runtime updates since app boot. Tests use this to verify reactivity. */
let generation = 0;

export function getDifficulty(): Difficulty {
  return activeDifficulty;
}

export function setDifficulty(difficulty: Difficulty): void {
  if (activeDifficulty === difficulty) return;
  activeDifficulty = difficulty;
  generation += 1;
  const current = loadSettings();
  saveSettings({ ...current, difficulty });
}

/** Hydrate the cached difficulty from persisted settings. Call once on boot. */
export function hydrateDifficulty(): Difficulty {
  const settings = loadSettings();
  activeDifficulty = settings.difficulty;
  return activeDifficulty;
}

/** Reset to defaults. Test-only helper. */
export function __resetDifficulty(): void {
  activeDifficulty = DEFAULT_DIFFICULTY;
  generation = 0;
}

/** Per-difficulty scaled values. Subsystems in later tasks should add their
 *  curves here so the `if (difficulty === ...)` pattern never appears in game code. */
export interface DifficultyScales<T> {
  easy: T;
  medium: T;
  hard: T;
}

export function scaledByDifficulty<T>(scales: DifficultyScales<T>): T {
  return scales[activeDifficulty];
}

export function __generation(): number {
  return generation;
}
