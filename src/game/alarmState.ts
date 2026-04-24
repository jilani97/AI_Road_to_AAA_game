import type { Difficulty } from './settings';

/** Global alarm tiers, MGS-style. Drives the music crossfade (Task 7), reinforcement
 *  spawning (Task 6e), and HUD accents. Ordered by severity. */
export type AlarmTier = 'normal' | 'caution' | 'alert' | 'evasion';

export const ALARM_TIER_ORDER: readonly AlarmTier[] = [
  'normal',
  'caution',
  'alert',
  'evasion',
] as const;

/** Counter thresholds. A tier spans `[threshold, nextThreshold)`. Evasion is the cap. */
export const ALARM_TIER_THRESHOLDS: Record<AlarmTier, number> = {
  normal: 0,
  caution: 1,
  alert: 2,
  evasion: 4,
};

/** Hard cap on the counter — accumulating past Evasion has no extra effect and would
 *  only delay decay once pressure drops. */
export const ALARM_COUNTER_MAX = 5;

/** Per-difficulty decay rate (counter units per second) while no guard is aware of
 *  the player. Hard decays slowly — the alarm sticks. */
export const ALARM_DECAY_PER_SECOND: Record<Difficulty, number> = {
  easy: 0.5,
  medium: 0.25,
  hard: 0.1,
};

/** Causes that bump the alarm counter. Magnitudes chosen so a first guard going
 *  Alerted pushes Normal → Caution; a second guard alerted on top pushes to Alert. */
export type AlarmBumpCause =
  | 'guard_suspicious'
  | 'guard_alerted'
  | 'guard_chasing'
  | 'reinforcement_call'
  | 'baron_sees_player';

export const ALARM_BUMP_AMOUNT: Record<AlarmBumpCause, number> = {
  guard_suspicious: 0.25,
  guard_alerted: 1.0,
  guard_chasing: 1.5,
  reinforcement_call: 0.5,
  // Baron bypasses accumulation and slams straight to Evasion (plan Task 14).
  baron_sees_player: ALARM_TIER_THRESHOLDS.evasion,
};

export interface AlarmState {
  counter: number;
  tier: AlarmTier;
}

export interface AlarmTick {
  dt: number;
  /** Integration layer sets this true while any guard is in `alerted` or `chasing`.
   *  While true, the counter does not decay — pressure is being actively applied. */
  anyGuardAwareOfPlayer: boolean;
  difficulty: Difficulty;
}

export function initialAlarmState(): AlarmState {
  return { counter: 0, tier: 'normal' };
}

/** Pure tier lookup for a given counter. Exposed so HUD/music can map counter → tier
 *  without calling the full tick path. */
export function tierFromCounter(counter: number): AlarmTier {
  if (counter >= ALARM_TIER_THRESHOLDS.evasion) return 'evasion';
  if (counter >= ALARM_TIER_THRESHOLDS.alert) return 'alert';
  if (counter >= ALARM_TIER_THRESHOLDS.caution) return 'caution';
  return 'normal';
}

function clampCounter(value: number): number {
  if (value < 0) return 0;
  if (value > ALARM_COUNTER_MAX) return ALARM_COUNTER_MAX;
  return value;
}

/** Raises the alarm counter in response to a discrete event. Baron contact jumps
 *  straight to the Evasion threshold regardless of prior counter. */
export function bumpAlarm(state: AlarmState, cause: AlarmBumpCause): AlarmState {
  if (cause === 'baron_sees_player') {
    const counter = ALARM_TIER_THRESHOLDS.evasion;
    return { counter, tier: tierFromCounter(counter) };
  }
  const counter = clampCounter(state.counter + ALARM_BUMP_AMOUNT[cause]);
  return { counter, tier: tierFromCounter(counter) };
}

/** Per-frame decay when no guard is applying pressure. Deterministic. */
export function tickAlarm(state: AlarmState, input: AlarmTick): AlarmState {
  if (input.anyGuardAwareOfPlayer || state.counter === 0) {
    return state.tier === tierFromCounter(state.counter)
      ? state
      : { ...state, tier: tierFromCounter(state.counter) };
  }
  const decay = ALARM_DECAY_PER_SECOND[input.difficulty] * input.dt;
  const counter = clampCounter(state.counter - decay);
  return { counter, tier: tierFromCounter(counter) };
}

/** True when `next` is a strictly higher-severity tier than `previous`. Used by
 *  integration code (HUD toast, music cue) that only reacts on escalation, not decay. */
export function isTierEscalation(previous: AlarmTier, next: AlarmTier): boolean {
  return ALARM_TIER_ORDER.indexOf(next) > ALARM_TIER_ORDER.indexOf(previous);
}
