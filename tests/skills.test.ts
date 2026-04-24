import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_SKILL_CAP_HARD,
  EMPTY_SKILL_STATE,
  SKILLS,
  SKILLS_STORAGE_KEY,
  SKILL_IDS,
  __resetSkillStateForTests,
  activeSkillsForRun,
  addActive,
  canAddActive,
  canUnlock,
  getSkill,
  getSkillState,
  hydrateSkillState,
  refundAllSkills,
  removeActive,
  setSkillState,
  skillsByBranch,
  unlockSkill,
} from '../src/game/skills';

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

describe('skill catalogue', () => {
  it('has at least one skill in each of the four branches', () => {
    for (const branch of ['mobility', 'senses', 'silence', 'gadgets'] as const) {
      expect(skillsByBranch(branch).length).toBeGreaterThan(0);
    }
  });

  it('has exactly one tier-1 anchor per branch whose prerequisites list is empty', () => {
    for (const branch of ['mobility', 'senses', 'silence', 'gadgets'] as const) {
      const anchors = skillsByBranch(branch).filter((s) => s.tier === 1);
      expect(anchors).toHaveLength(1);
      expect(anchors[0].prerequisites).toEqual([]);
    }
  });

  it('every tier-2 skill requires the tier-1 anchor in its branch', () => {
    for (const branch of ['mobility', 'senses', 'silence', 'gadgets'] as const) {
      const anchor = skillsByBranch(branch).find((s) => s.tier === 1)!;
      for (const tier2 of skillsByBranch(branch).filter((s) => s.tier === 2)) {
        expect(tier2.prerequisites).toContain(anchor.id);
      }
    }
  });

  it('all SKILL_IDS are present in SKILLS', () => {
    for (const id of SKILL_IDS) {
      expect(SKILLS[id]).toBeDefined();
    }
  });
});

describe('canUnlock / unlockSkill', () => {
  it('rejects an unknown skill id', () => {
    expect(canUnlock('nope.nothing', EMPTY_SKILL_STATE, 9999)).toBe('unknown_skill');
    expect(unlockSkill('nope.nothing', EMPTY_SKILL_STATE, 9999)).toEqual({
      ok: false,
      reason: 'unknown_skill',
    });
  });

  it('rejects an already-unlocked skill', () => {
    const state = { unlocked: ['senses.extended_sonar'], active: [] };
    expect(canUnlock('senses.extended_sonar', state, 9999)).toBe('already_unlocked');
  });

  it('rejects a tier-2 skill whose prerequisite is not yet unlocked', () => {
    expect(canUnlock('senses.threat_memory', EMPTY_SKILL_STATE, 9999)).toBe(
      'missing_prerequisite',
    );
  });

  it('rejects a purchase when the balance is short', () => {
    expect(canUnlock('senses.extended_sonar', EMPTY_SKILL_STATE, 10)).toBe('insufficient_funds');
  });

  it('permits a valid tier-1 purchase and deducts the cost', () => {
    const result = unlockSkill('senses.extended_sonar', EMPTY_SKILL_STATE, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.unlocked).toEqual(['senses.extended_sonar']);
    expect(result.balanceAfter).toBe(200 - getSkill('senses.extended_sonar')!.cost);
  });

  it('permits a tier-2 purchase once the tier-1 anchor is owned', () => {
    const afterTier1 = unlockSkill('senses.extended_sonar', EMPTY_SKILL_STATE, 200);
    expect(afterTier1.ok).toBe(true);
    if (!afterTier1.ok) return;
    const afterTier2 = unlockSkill(
      'senses.threat_memory',
      afterTier1.state,
      afterTier1.balanceAfter,
    );
    expect(afterTier2.ok).toBe(true);
  });
});

describe('refundAllSkills', () => {
  it('refunds the full cost of every unlocked skill and clears the state', () => {
    const state = {
      unlocked: ['senses.extended_sonar', 'senses.threat_memory'],
      active: ['senses.extended_sonar'],
    };
    const expected =
      SKILLS['senses.extended_sonar'].cost + SKILLS['senses.threat_memory'].cost;
    const result = refundAllSkills(state);
    expect(result.refunded).toBe(expected);
    expect(result.state).toEqual({ unlocked: [], active: [] });
  });

  it('returns 0 refunded and clean state for an empty tree', () => {
    const result = refundAllSkills(EMPTY_SKILL_STATE);
    expect(result.refunded).toBe(0);
    expect(result.state).toEqual({ unlocked: [], active: [] });
  });
});

describe('activeSkillsForRun', () => {
  it('on Easy, every unlocked skill is active plus the character starting skills', () => {
    const state = { unlocked: ['senses.extended_sonar'], active: [] };
    const result = activeSkillsForRun(state, 'easy', ['silence.silent_landing']);
    expect(result).toContain('senses.extended_sonar');
    expect(result).toContain('silence.silent_landing');
  });

  it('on Medium, behaves the same as Easy', () => {
    const state = { unlocked: ['senses.extended_sonar'], active: [] };
    const result = activeSkillsForRun(state, 'medium', ['silence.silent_landing']);
    expect(result).toContain('senses.extended_sonar');
    expect(result).toContain('silence.silent_landing');
  });

  it('on Hard, only explicitly loaded skills plus starting skills are active', () => {
    const state = {
      unlocked: ['senses.extended_sonar', 'senses.threat_memory'],
      active: ['senses.threat_memory'],
    };
    const result = activeSkillsForRun(state, 'hard', ['silence.silent_landing']);
    expect(result).toContain('silence.silent_landing');
    expect(result).toContain('senses.threat_memory');
    expect(result).not.toContain('senses.extended_sonar');
  });

  it('on Hard, ignores `active` entries that are not in `unlocked`', () => {
    const state = { unlocked: [], active: ['senses.threat_memory'] };
    const result = activeSkillsForRun(state, 'hard');
    expect(result).not.toContain('senses.threat_memory');
  });
});

describe('Hard-mode active-skill cap', () => {
  const baseUnlocks = [
    'mobility.ascension_dash_plus',
    'senses.extended_sonar',
    'silence.silent_landing',
    'gadgets.bazooka_blast_radius',
    'senses.threat_memory',
  ];

  it('refuses to mark a non-unlocked skill as active', () => {
    const state = { unlocked: ['senses.extended_sonar'], active: [] };
    expect(canAddActive('mobility.wall_cling', state, 'hard')).toBe(false);
  });

  it('allows up to four actives on Hard', () => {
    let state = { unlocked: baseUnlocks, active: [] as string[] };
    for (let i = 0; i < ACTIVE_SKILL_CAP_HARD; i++) {
      const id = baseUnlocks[i];
      expect(canAddActive(id, state, 'hard')).toBe(true);
      state = addActive(id, state);
    }
    expect(state.active.length).toBe(ACTIVE_SKILL_CAP_HARD);
    expect(canAddActive(baseUnlocks[ACTIVE_SKILL_CAP_HARD], state, 'hard')).toBe(false);
  });

  it('unloading an active skill frees a slot', () => {
    let state = { unlocked: baseUnlocks, active: baseUnlocks.slice(0, 4) };
    expect(canAddActive(baseUnlocks[4], state, 'hard')).toBe(false);
    state = removeActive(baseUnlocks[0], state);
    expect(canAddActive(baseUnlocks[4], state, 'hard')).toBe(true);
  });

  it('Easy and Medium disallow manually loading actives (cap only applies to Hard)', () => {
    const state = { unlocked: baseUnlocks, active: [] };
    expect(canAddActive('senses.extended_sonar', state, 'easy')).toBe(false);
    expect(canAddActive('senses.extended_sonar', state, 'medium')).toBe(false);
  });
});

describe('skill state persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    __resetSkillStateForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates to an empty state when nothing is stored', () => {
    expect(hydrateSkillState()).toEqual(EMPTY_SKILL_STATE);
    expect(getSkillState()).toEqual(EMPTY_SKILL_STATE);
  });

  it('round-trips a populated state', () => {
    const input = {
      unlocked: ['senses.extended_sonar', 'mobility.ascension_dash_plus'],
      active: ['senses.extended_sonar'],
    };
    setSkillState(input);
    // Fresh hydrate from the same storage should yield the same shape.
    __resetSkillStateForTests();
    const hydrated = hydrateSkillState();
    expect(hydrated.unlocked).toEqual(input.unlocked);
    expect(hydrated.active).toEqual(input.active);
  });

  it('drops unknown skill ids from persisted unlocked / active arrays', () => {
    localStorage.setItem(
      SKILLS_STORAGE_KEY,
      JSON.stringify({ unlocked: ['senses.extended_sonar', 'bogus.skill'], active: ['bogus.skill'] }),
    );
    const hydrated = hydrateSkillState();
    expect(hydrated.unlocked).toEqual(['senses.extended_sonar']);
    expect(hydrated.active).toEqual([]);
  });

  it('drops active entries that are not in the unlocked list', () => {
    localStorage.setItem(
      SKILLS_STORAGE_KEY,
      JSON.stringify({ unlocked: [], active: ['senses.extended_sonar'] }),
    );
    const hydrated = hydrateSkillState();
    expect(hydrated.active).toEqual([]);
  });

  it('returns an empty state on corrupt JSON', () => {
    localStorage.setItem(SKILLS_STORAGE_KEY, '{not json');
    expect(hydrateSkillState()).toEqual(EMPTY_SKILL_STATE);
  });

  it('survives a localStorage that throws on access', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage denied');
      },
      setItem: () => {
        throw new Error('storage denied');
      },
    });
    expect(hydrateSkillState()).toEqual(EMPTY_SKILL_STATE);
    expect(() => setSkillState({ unlocked: ['senses.extended_sonar'], active: [] })).not.toThrow();
  });

  it('setSkillState deep-copies the arrays — later mutations to caller do not leak', () => {
    const input = { unlocked: ['senses.extended_sonar'], active: [] as string[] };
    setSkillState(input);
    input.unlocked.push('mobility.ascension_dash_plus');
    expect(getSkillState().unlocked).toEqual(['senses.extended_sonar']);
  });
});
