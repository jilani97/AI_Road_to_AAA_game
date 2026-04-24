import { describe, expect, it } from 'vitest';
import {
  ALARM_BUMP_AMOUNT,
  ALARM_COUNTER_MAX,
  ALARM_DECAY_PER_SECOND,
  ALARM_TIER_THRESHOLDS,
  bumpAlarm,
  initialAlarmState,
  isTierEscalation,
  tickAlarm,
  tierFromCounter,
  type AlarmState,
  type AlarmTick,
  type AlarmTier,
} from '../src/game/alarmState';
import type { Difficulty } from '../src/game/settings';

function advanceDecay(
  state: AlarmState,
  seconds: number,
  difficulty: Difficulty,
  step: number = 0.1,
): AlarmState {
  let s = state;
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(step, remaining);
    s = tickAlarm(s, { dt, anyGuardAwareOfPlayer: false, difficulty });
    remaining -= dt;
  }
  return s;
}

describe('tierFromCounter', () => {
  it('maps counter ranges to the four tiers', () => {
    expect(tierFromCounter(0)).toBe<AlarmTier>('normal');
    expect(tierFromCounter(0.99)).toBe<AlarmTier>('normal');
    expect(tierFromCounter(ALARM_TIER_THRESHOLDS.caution)).toBe<AlarmTier>('caution');
    expect(tierFromCounter(1.9)).toBe<AlarmTier>('caution');
    expect(tierFromCounter(ALARM_TIER_THRESHOLDS.alert)).toBe<AlarmTier>('alert');
    expect(tierFromCounter(3.9)).toBe<AlarmTier>('alert');
    expect(tierFromCounter(ALARM_TIER_THRESHOLDS.evasion)).toBe<AlarmTier>('evasion');
    expect(tierFromCounter(ALARM_COUNTER_MAX)).toBe<AlarmTier>('evasion');
  });
});

describe('bumpAlarm', () => {
  it('starts at normal/0 and a single guard-alerted raises to caution', () => {
    const s = bumpAlarm(initialAlarmState(), 'guard_alerted');
    expect(s.counter).toBe(ALARM_BUMP_AMOUNT.guard_alerted);
    expect(s.tier).toBe<AlarmTier>('caution');
  });

  it('two guards alerted stack into the alert tier', () => {
    let s = initialAlarmState();
    s = bumpAlarm(s, 'guard_alerted');
    s = bumpAlarm(s, 'guard_alerted');
    expect(s.counter).toBe(2);
    expect(s.tier).toBe<AlarmTier>('alert');
  });

  it('chasing is worth more than alerted alone', () => {
    let s = initialAlarmState();
    s = bumpAlarm(s, 'guard_chasing');
    expect(s.tier).toBe<AlarmTier>('caution');
    s = bumpAlarm(s, 'guard_chasing');
    expect(s.counter).toBe(3);
    expect(s.tier).toBe<AlarmTier>('alert');
  });

  it('baron_sees_player jumps straight to evasion regardless of prior counter', () => {
    const fromZero = bumpAlarm(initialAlarmState(), 'baron_sees_player');
    expect(fromZero.tier).toBe<AlarmTier>('evasion');
    expect(fromZero.counter).toBe(ALARM_TIER_THRESHOLDS.evasion);

    const fromCaution = bumpAlarm(
      { counter: 1.5, tier: 'caution' },
      'baron_sees_player',
    );
    expect(fromCaution.tier).toBe<AlarmTier>('evasion');
    expect(fromCaution.counter).toBe(ALARM_TIER_THRESHOLDS.evasion);
  });

  it('clamps at the counter max — you can never over-accumulate', () => {
    let s: AlarmState = { counter: ALARM_COUNTER_MAX - 0.1, tier: 'evasion' };
    s = bumpAlarm(s, 'guard_chasing');
    expect(s.counter).toBe(ALARM_COUNTER_MAX);
    expect(s.tier).toBe<AlarmTier>('evasion');
  });

  it('reinforcement_call is a small bump — not enough alone to jump a tier', () => {
    const s = bumpAlarm(initialAlarmState(), 'reinforcement_call');
    expect(s.counter).toBe(ALARM_BUMP_AMOUNT.reinforcement_call);
    expect(s.tier).toBe<AlarmTier>('normal');
  });
});

describe('tickAlarm decay', () => {
  it('does not decay while a guard is aware of the player', () => {
    const s = tickAlarm(
      { counter: 2, tier: 'alert' },
      { dt: 1, anyGuardAwareOfPlayer: true, difficulty: 'medium' },
    );
    expect(s.counter).toBe(2);
    expect(s.tier).toBe<AlarmTier>('alert');
  });

  it('decays at the difficulty-specific rate while no guard is aware', () => {
    const start: AlarmState = { counter: 2, tier: 'alert' };
    const afterOneSecond = tickAlarm(start, {
      dt: 1,
      anyGuardAwareOfPlayer: false,
      difficulty: 'medium',
    });
    expect(afterOneSecond.counter).toBeCloseTo(2 - ALARM_DECAY_PER_SECOND.medium);
  });

  it.each<[Difficulty, number]>([
    ['easy', 4],
    ['medium', 8],
    ['hard', 20],
  ])(
    'on %s, Alert (counter=2) decays fully to Normal in ~%i seconds',
    (difficulty, seconds) => {
      const start: AlarmState = { counter: 2, tier: 'alert' };
      const decayed = advanceDecay(start, seconds + 0.5, difficulty);
      expect(decayed.counter).toBe(0);
      expect(decayed.tier).toBe<AlarmTier>('normal');
    },
  );

  it('never decays below zero', () => {
    const s = tickAlarm(
      { counter: 0.01, tier: 'normal' },
      { dt: 10, anyGuardAwareOfPlayer: false, difficulty: 'easy' },
    );
    expect(s.counter).toBe(0);
    expect(s.tier).toBe<AlarmTier>('normal');
  });

  it('retiers through caution on its way back to normal', () => {
    let s: AlarmState = { counter: 2.5, tier: 'alert' };
    s = advanceDecay(s, 2, 'medium');
    // 2.5 − 0.25×2 = 2.0 → still alert at the boundary
    expect(s.tier).toBe<AlarmTier>('alert');
    s = advanceDecay(s, 0.5, 'medium');
    // 2.0 − 0.25×0.5 = 1.875 → caution
    expect(s.tier).toBe<AlarmTier>('caution');
  });
});

describe('isTierEscalation', () => {
  it('reports true when severity rises and false when it falls or holds', () => {
    expect(isTierEscalation('normal', 'caution')).toBe(true);
    expect(isTierEscalation('caution', 'evasion')).toBe(true);
    expect(isTierEscalation('alert', 'alert')).toBe(false);
    expect(isTierEscalation('evasion', 'alert')).toBe(false);
    expect(isTierEscalation('caution', 'normal')).toBe(false);
  });
});

describe('deterministic purity', () => {
  it('bumpAlarm produces identical output for identical inputs', () => {
    const s = initialAlarmState();
    expect(bumpAlarm(s, 'guard_alerted')).toEqual(bumpAlarm(s, 'guard_alerted'));
  });

  it('tickAlarm produces identical output for identical inputs', () => {
    const s: AlarmState = { counter: 1.5, tier: 'caution' };
    const input: AlarmTick = { dt: 0.1, anyGuardAwareOfPlayer: false, difficulty: 'hard' };
    expect(tickAlarm(s, input)).toEqual(tickAlarm(s, input));
  });
});
