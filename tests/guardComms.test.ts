import { describe, expect, it } from 'vitest';
import {
  COMMS_RADIUS,
  shouldDropIntoInvestigating,
  type CommsListener,
} from '../src/game/guardComms';
import type { GuardState } from '../src/game/guardAi';
import type { Difficulty } from '../src/game/settings';

function listener(partial: Partial<CommsListener> = {}): CommsListener {
  return {
    distance: 5,
    state: 'patrol',
    isKnockedOut: false,
    ...partial,
  };
}

describe('COMMS_RADIUS', () => {
  it('matches plan Task 4c: 0 / 10 / Infinity', () => {
    expect(COMMS_RADIUS.easy).toBe(0);
    expect(COMMS_RADIUS.medium).toBe(10);
    expect(COMMS_RADIUS.hard).toBe(Infinity);
  });
});

describe('shouldDropIntoInvestigating', () => {
  it('on Easy, no listener ever qualifies — guards are isolated', () => {
    expect(shouldDropIntoInvestigating(listener({ distance: 1 }), 'easy')).toBe(false);
    expect(shouldDropIntoInvestigating(listener({ distance: 0 }), 'easy')).toBe(false);
  });

  it('on Medium, within 10 m a patrol guard drops into investigating', () => {
    expect(shouldDropIntoInvestigating(listener({ distance: 5 }), 'medium')).toBe(true);
    expect(shouldDropIntoInvestigating(listener({ distance: 10 }), 'medium')).toBe(true);
  });

  it('on Medium, beyond 10 m nothing happens', () => {
    expect(shouldDropIntoInvestigating(listener({ distance: 10.01 }), 'medium')).toBe(false);
    expect(shouldDropIntoInvestigating(listener({ distance: 50 }), 'medium')).toBe(false);
  });

  it('on Hard, even a distant patrol guard hears the walkie-talkie', () => {
    expect(shouldDropIntoInvestigating(listener({ distance: 100 }), 'hard')).toBe(true);
    expect(shouldDropIntoInvestigating(listener({ distance: 500 }), 'hard')).toBe(true);
  });

  it.each<[GuardState]>([['alerted'], ['chasing'], ['investigating']])(
    'skips a listener already in %s — no down-shift in awareness',
    (state) => {
      expect(
        shouldDropIntoInvestigating(listener({ state, distance: 1 }), 'hard'),
      ).toBe(false);
    },
  );

  it('skips a knocked-out listener regardless of difficulty or distance', () => {
    const ko = listener({ isKnockedOut: true, distance: 0 });
    expect(shouldDropIntoInvestigating(ko, 'medium')).toBe(false);
    expect(shouldDropIntoInvestigating(ko, 'hard')).toBe(false);
  });

  it('a suspicious guard in range still drops to investigating (the alert trumps)', () => {
    expect(
      shouldDropIntoInvestigating(listener({ state: 'suspicious', distance: 3 }), 'medium'),
    ).toBe(true);
  });

  it('a returning guard in range also drops back into investigating', () => {
    expect(
      shouldDropIntoInvestigating(listener({ state: 'returning', distance: 3 }), 'medium'),
    ).toBe(true);
  });

  it.each<[Difficulty]>([['easy'], ['medium'], ['hard']])(
    'is deterministic: same inputs produce same output (%s)',
    (difficulty) => {
      const l = listener({ distance: 7, state: 'patrol' });
      expect(shouldDropIntoInvestigating(l, difficulty)).toBe(
        shouldDropIntoInvestigating(l, difficulty),
      );
    },
  );
});
