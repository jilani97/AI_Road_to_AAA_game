import type { Difficulty } from './settings';

export type SkillBranch = 'mobility' | 'senses' | 'silence' | 'gadgets';
export type SkillTier = 1 | 2;

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  branch: SkillBranch;
  tier: SkillTier;
  /** IDs of skills that must be unlocked before this one is purchasable. */
  prerequisites: string[];
  cost: number;
}

/** Hard-difficulty limit on simultaneously active skills. Easy/Medium are uncapped. */
export const ACTIVE_SKILL_CAP_HARD = 4;

const defs: SkillDef[] = [
  // Mobility branch — tier 1 anchor + two tier-2 children.
  {
    id: 'mobility.ascension_dash_plus',
    name: 'Ascension Dash +',
    description: 'Second airborne dash before landing. Signature Kestrel kit.',
    branch: 'mobility',
    tier: 1,
    prerequisites: [],
    cost: 50,
  },
  {
    id: 'mobility.wall_cling',
    name: 'Wall Cling',
    description: 'Brief mantle-and-hold against vertical surfaces after a dash.',
    branch: 'mobility',
    tier: 2,
    prerequisites: ['mobility.ascension_dash_plus'],
    cost: 100,
  },
  {
    id: 'mobility.air_control_plus',
    name: 'Air Control +',
    description: 'Tighter mid-air steering during dash arcs.',
    branch: 'mobility',
    tier: 2,
    prerequisites: ['mobility.ascension_dash_plus'],
    cost: 100,
  },

  // Senses branch.
  {
    id: 'senses.extended_sonar',
    name: 'Extended Sonar',
    description: 'Crestal Sonar range +40%.',
    branch: 'senses',
    tier: 1,
    prerequisites: [],
    cost: 50,
  },
  {
    id: 'senses.threat_memory',
    name: 'Threat Memory',
    description: 'Last-known guard positions persist on the HUD for a few seconds.',
    branch: 'senses',
    tier: 2,
    prerequisites: ['senses.extended_sonar'],
    cost: 100,
  },
  {
    id: 'senses.crest_pulse',
    name: 'Crest Pulse',
    description: 'One-shot 360° ping on a cooldown that tags all nearby guards.',
    branch: 'senses',
    tier: 2,
    prerequisites: ['senses.extended_sonar'],
    cost: 100,
  },

  // Silence branch.
  {
    id: 'silence.silent_landing',
    name: 'Silent Landing',
    description: 'Fall noise -100%. Drop from any height without alerting guards.',
    branch: 'silence',
    tier: 1,
    prerequisites: [],
    cost: 50,
  },
  {
    id: 'silence.whisper_walk',
    name: 'Whisper Walk',
    description: 'Walk is fully silent even on reflective rooftops.',
    branch: 'silence',
    tier: 2,
    prerequisites: ['silence.silent_landing'],
    cost: 100,
  },
  {
    id: 'silence.shadow_dash',
    name: 'Shadow Dash',
    description: 'Ascension dash noise -60%.',
    branch: 'silence',
    tier: 2,
    prerequisites: ['silence.silent_landing'],
    cost: 100,
  },

  // Gadgets branch.
  {
    id: 'gadgets.bazooka_blast_radius',
    name: 'Bazooka Blast Radius +',
    description: 'Bazooka AoE +50%.',
    branch: 'gadgets',
    tier: 1,
    prerequisites: [],
    cost: 50,
  },
  {
    id: 'gadgets.armoured_plating',
    name: 'Armoured Plating',
    description: '+1 HP buffer that absorbs the next incoming hit each run.',
    branch: 'gadgets',
    tier: 2,
    prerequisites: ['gadgets.bazooka_blast_radius'],
    cost: 100,
  },
  {
    id: 'gadgets.revive_token',
    name: 'Revive Token',
    description: 'One run-use: resurrect at 1 HP after 0-HP handling on Medium.',
    branch: 'gadgets',
    tier: 2,
    prerequisites: ['gadgets.bazooka_blast_radius'],
    cost: 100,
  },
];

export const SKILLS: Readonly<Record<string, SkillDef>> = Object.freeze(
  Object.fromEntries(defs.map((d) => [d.id, d])),
);

export const SKILL_IDS: readonly string[] = defs.map((d) => d.id);

export function getSkill(id: string): SkillDef | undefined {
  return SKILLS[id];
}

export function skillsByBranch(branch: SkillBranch): SkillDef[] {
  return defs.filter((d) => d.branch === branch);
}

export interface SkillTreeState {
  /** Skill IDs the player has purchased. Persists across runs. */
  unlocked: string[];
  /** Subset of `unlocked` explicitly loaded for the current run. Used on Hard only. */
  active: string[];
}

export const EMPTY_SKILL_STATE: SkillTreeState = { unlocked: [], active: [] };

export type UnlockFailureReason =
  | 'unknown_skill'
  | 'already_unlocked'
  | 'missing_prerequisite'
  | 'insufficient_funds';

export interface UnlockFailure {
  ok: false;
  reason: UnlockFailureReason;
}

export interface UnlockSuccess {
  ok: true;
  state: SkillTreeState;
  balanceAfter: number;
}

export type UnlockResult = UnlockSuccess | UnlockFailure;

export function canUnlock(
  skillId: string,
  state: SkillTreeState,
  balance: number,
): UnlockFailureReason | null {
  const def = getSkill(skillId);
  if (!def) return 'unknown_skill';
  if (state.unlocked.includes(skillId)) return 'already_unlocked';
  for (const prereq of def.prerequisites) {
    if (!state.unlocked.includes(prereq)) return 'missing_prerequisite';
  }
  if (balance < def.cost) return 'insufficient_funds';
  return null;
}

export function unlockSkill(
  skillId: string,
  state: SkillTreeState,
  balance: number,
): UnlockResult {
  const failure = canUnlock(skillId, state, balance);
  if (failure !== null) return { ok: false, reason: failure };
  const def = SKILLS[skillId];
  return {
    ok: true,
    state: { ...state, unlocked: [...state.unlocked, skillId] },
    balanceAfter: balance - def.cost,
  };
}

/** Refund everything. Returns the refunded amount and a cleared state. */
export function refundAllSkills(state: SkillTreeState): {
  state: SkillTreeState;
  refunded: number;
} {
  const refunded = state.unlocked.reduce((total, id) => total + (SKILLS[id]?.cost ?? 0), 0);
  return { state: { unlocked: [], active: [] }, refunded };
}

/** Skills effectively active for the current run. Easy/Medium auto-apply all unlocked;
 *  Hard applies only those explicitly loaded via `loadActive`, and starting skills grant. */
export function activeSkillsForRun(
  state: SkillTreeState,
  difficulty: Difficulty,
  startingSkills: readonly string[] = [],
): string[] {
  const baseline = new Set<string>(startingSkills);
  if (difficulty !== 'hard') {
    for (const id of state.unlocked) baseline.add(id);
    return [...baseline];
  }
  for (const id of state.active) {
    if (state.unlocked.includes(id)) baseline.add(id);
  }
  return [...baseline];
}

export function canAddActive(
  skillId: string,
  state: SkillTreeState,
  difficulty: Difficulty,
): boolean {
  if (difficulty !== 'hard') return false;
  if (!state.unlocked.includes(skillId)) return false;
  if (state.active.includes(skillId)) return false;
  return state.active.length < ACTIVE_SKILL_CAP_HARD;
}

export function addActive(skillId: string, state: SkillTreeState): SkillTreeState {
  if (state.active.includes(skillId)) return state;
  return { ...state, active: [...state.active, skillId] };
}

export function removeActive(skillId: string, state: SkillTreeState): SkillTreeState {
  return { ...state, active: state.active.filter((id) => id !== skillId) };
}

// ---------------------------------------------------------------------------
// Persistence — single source of truth for the player's unlocks + Hard-mode
// active loadout. Mirrors the currency.ts / difficulty.ts pattern: module-level
// cached state, hydrate on boot, setSkillState writes through to localStorage.
// ---------------------------------------------------------------------------

export const SKILLS_STORAGE_KEY = 'neonTail.skills.v1';

let currentSkillState: SkillTreeState = { unlocked: [], active: [] };

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
    // storage unavailable — state stays in-memory for this session
  }
}

/** Parses any stored skill state, dropping unknown skill IDs and active
 *  entries that aren't in the unlocked list. Returns a fresh empty state
 *  when the payload is missing, corrupt, or storage is denied. */
export function hydrateSkillState(): SkillTreeState {
  const raw = safeGetItem(SKILLS_STORAGE_KEY);
  if (!raw) {
    currentSkillState = { unlocked: [], active: [] };
    return currentSkillState;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('not object');
    const rec = parsed as { unlocked?: unknown; active?: unknown };
    const unlockedRaw = Array.isArray(rec.unlocked) ? rec.unlocked : [];
    const activeRaw = Array.isArray(rec.active) ? rec.active : [];
    const unlocked = unlockedRaw.filter(
      (id: unknown): id is string => typeof id === 'string' && id in SKILLS,
    );
    const active = activeRaw.filter(
      (id: unknown): id is string => typeof id === 'string' && unlocked.includes(id),
    );
    currentSkillState = { unlocked, active };
  } catch {
    currentSkillState = { unlocked: [], active: [] };
  }
  return currentSkillState;
}

export function getSkillState(): SkillTreeState {
  return currentSkillState;
}

/** Writes `state` to the module cache and persists it. The UI calls this
 *  after every unlock / respec / loadout change. */
export function setSkillState(state: SkillTreeState): void {
  currentSkillState = { unlocked: [...state.unlocked], active: [...state.active] };
  safeSetItem(SKILLS_STORAGE_KEY, JSON.stringify(currentSkillState));
}

/** Test-only — resets the module cache without touching storage. */
export function __resetSkillStateForTests(
  state: SkillTreeState = { unlocked: [], active: [] },
): void {
  currentSkillState = { unlocked: [...state.unlocked], active: [...state.active] };
}
