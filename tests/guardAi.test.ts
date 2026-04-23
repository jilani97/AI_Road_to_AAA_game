import { describe, expect, it } from 'vitest';
import {
  ALERTED_GIVE_UP_SECONDS,
  ALERTED_TO_CHASING_SECONDS,
  INVESTIGATION_BUDGET_SECONDS,
  PATROL_TO_SUSPICIOUS_SECONDS,
  RETURNING_TO_PATROL_SECONDS,
  SUSPICIOUS_TO_ALERTED_SECONDS,
  guardStateIcon,
  initialGuardAiState,
  tickGuardAi,
  type GuardAiState,
  type GuardAiTick,
  type GuardState,
} from '../src/game/guardAi';
import type { Difficulty } from '../src/game/settings';

function tick(
  state: GuardAiState,
  partial: Partial<GuardAiTick> & { difficulty: Difficulty; dt: number },
): GuardAiState {
  return tickGuardAi(state, {
    visible: false,
    noiseHeard: false,
    ...partial,
  });
}

function advance(
  state: GuardAiState,
  seconds: number,
  perTick: Omit<GuardAiTick, 'dt'>,
  step: number = 0.1,
): GuardAiState {
  let s = state;
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(step, remaining);
    s = tickGuardAi(s, { ...perTick, dt });
    remaining -= dt;
  }
  return s;
}

describe('patrol → suspicious transition', () => {
  it.each<[Difficulty]>([['easy'], ['medium'], ['hard']])(
    'on %s difficulty, sustained sight hits the tier-specific threshold',
    (difficulty) => {
      let s = initialGuardAiState();
      s = advance(
        s,
        PATROL_TO_SUSPICIOUS_SECONDS[difficulty] + 0.05,
        { visible: true, noiseHeard: false, difficulty },
      );
      expect(s.state).toBe('suspicious');
    },
  );

  it('resets the sustained-visible counter when vision is broken', () => {
    let s = initialGuardAiState();
    s = tick(s, { visible: true, difficulty: 'easy', dt: 0.3 });
    expect(s.sustainedVisibleSeconds).toBeCloseTo(0.3);
    s = tick(s, { visible: false, difficulty: 'easy', dt: 0.1 });
    expect(s.sustainedVisibleSeconds).toBe(0);
    expect(s.state).toBe('patrol');
  });

  it('drops to suspicious on any heard noise even without sight', () => {
    const s = tick(initialGuardAiState(), { noiseHeard: true, difficulty: 'medium', dt: 0.1 });
    expect(s.state).toBe('suspicious');
  });
});

describe('suspicious → alerted / investigating', () => {
  it('promotes to alerted after sustained sight in suspicious', () => {
    let s = initialGuardAiState('suspicious');
    s = advance(
      s,
      SUSPICIOUS_TO_ALERTED_SECONDS.medium + 0.05,
      { visible: true, noiseHeard: false, difficulty: 'medium' },
    );
    expect(s.state).toBe('alerted');
  });

  it('drops to investigating the moment sight is lost', () => {
    const s = tick(initialGuardAiState('suspicious'), {
      visible: false,
      difficulty: 'medium',
      dt: 0.1,
    });
    expect(s.state).toBe('investigating');
  });
});

describe('investigating', () => {
  it('re-engages to alerted if the player is seen again', () => {
    const s = tick(initialGuardAiState('investigating'), {
      visible: true,
      difficulty: 'medium',
      dt: 0.1,
    });
    expect(s.state).toBe('alerted');
  });

  it('returns after the investigation budget expires', () => {
    let s = initialGuardAiState('investigating');
    s = advance(s, INVESTIGATION_BUDGET_SECONDS + 0.2, {
      visible: false,
      noiseHeard: false,
      difficulty: 'medium',
    });
    expect(s.state).toBe('returning');
  });

  it('shortcuts to returning when integration reports the last-known position was reached', () => {
    const s = tick(initialGuardAiState('investigating'), {
      visible: false,
      difficulty: 'medium',
      reachedLastKnownPosition: true,
      dt: 0.1,
    });
    expect(s.state).toBe('returning');
  });

  it('resets the budget clock when a fresh noise event arrives mid-investigation', () => {
    let s = initialGuardAiState('investigating');
    s = tick(s, { difficulty: 'medium', dt: 2 });
    expect(s.timeInvestigating).toBeCloseTo(2);
    s = tick(s, { noiseHeard: true, difficulty: 'medium', dt: 0.1 });
    expect(s.state).toBe('investigating');
    expect(s.timeInvestigating).toBe(0);
  });
});

describe('alerted', () => {
  it('transitions to chasing after the brief "caught you" pause', () => {
    let s = initialGuardAiState('alerted');
    s = advance(s, ALERTED_TO_CHASING_SECONDS + 0.05, {
      visible: true,
      noiseHeard: false,
      difficulty: 'medium',
    });
    expect(s.state).toBe('chasing');
  });

  it.each<[Difficulty]>([['easy'], ['medium'], ['hard']])(
    'on %s difficulty, drops to investigating once the give-up timer expires',
    (difficulty) => {
      let s = initialGuardAiState('alerted');
      s = advance(s, ALERTED_GIVE_UP_SECONDS[difficulty] + 0.1, {
        visible: false,
        noiseHeard: false,
        difficulty,
      });
      expect(s.state).toBe('investigating');
    },
  );
});

describe('chasing', () => {
  it('stays chasing while vision holds', () => {
    let s = initialGuardAiState('chasing');
    s = advance(s, 2, { visible: true, noiseHeard: false, difficulty: 'medium' });
    expect(s.state).toBe('chasing');
  });

  it.each<[Difficulty]>([['easy'], ['medium'], ['hard']])(
    'on %s, drops to investigating once the give-up timer expires',
    (difficulty) => {
      let s = initialGuardAiState('chasing');
      s = advance(s, ALERTED_GIVE_UP_SECONDS[difficulty] + 0.1, {
        visible: false,
        noiseHeard: false,
        difficulty,
      });
      expect(s.state).toBe('investigating');
    },
  );

  it('zeroes the lost-sight timer on any renewed contact', () => {
    let s = initialGuardAiState('chasing');
    s = tick(s, { visible: false, difficulty: 'medium', dt: 2 });
    expect(s.timeSinceLostSight).toBeCloseTo(2);
    s = tick(s, { visible: true, difficulty: 'medium', dt: 0.1 });
    expect(s.timeSinceLostSight).toBe(0);
  });
});

describe('returning', () => {
  it('decays back to patrol after the returning budget', () => {
    let s = initialGuardAiState('returning');
    s = advance(s, RETURNING_TO_PATROL_SECONDS + 0.1, {
      visible: false,
      noiseHeard: false,
      difficulty: 'medium',
    });
    expect(s.state).toBe('patrol');
  });

  it('re-escalates to alerted on fresh sight', () => {
    const s = tick(initialGuardAiState('returning'), {
      visible: true,
      difficulty: 'medium',
      dt: 0.1,
    });
    expect(s.state).toBe('alerted');
  });

  it('shortcut to patrol when integration reports the guard is close to the route', () => {
    const s = tick(initialGuardAiState('returning'), {
      visible: false,
      difficulty: 'medium',
      nearPatrolPath: true,
      dt: 0.1,
    });
    expect(s.state).toBe('patrol');
  });

  it('drops back to suspicious on a fresh noise during the return walk', () => {
    const s = tick(initialGuardAiState('returning'), {
      visible: false,
      noiseHeard: true,
      difficulty: 'medium',
      dt: 0.1,
    });
    expect(s.state).toBe('suspicious');
  });
});

describe('guardStateIcon', () => {
  it('maps every state to one of the three canonical icons', () => {
    const mapping: Record<GuardState, '.' | '?' | '!'> = {
      patrol: '.',
      returning: '.',
      suspicious: '?',
      investigating: '?',
      alerted: '!',
      chasing: '!',
    };
    for (const state of Object.keys(mapping) as GuardState[]) {
      expect(guardStateIcon(state)).toBe(mapping[state]);
    }
  });
});

describe('deterministic purity', () => {
  it('produces identical state given identical inputs (no hidden globals)', () => {
    const seedState = initialGuardAiState('suspicious');
    const input: GuardAiTick = {
      visible: true,
      noiseHeard: false,
      difficulty: 'hard',
      dt: 0.1,
    };
    expect(tickGuardAi(seedState, input)).toEqual(tickGuardAi(seedState, input));
  });
});
