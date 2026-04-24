import type { Difficulty } from './settings';

/** Seconds the player must spend unseen by any guard before Easy-tier passive
 *  regen kicks in. Plan Task 5: "passive regen when not seen for 5 s". */
export const PASSIVE_REGEN_DELAY_SECONDS = 5;

/** Continuous regen rate once active. 0.5 HP/sec — a full Kestrel (2 HP)
 *  recovers in 4 s, a full Ironclaw (5 HP) in 10 s. */
export const PASSIVE_REGEN_HP_PER_SECOND = 0.5;

export interface RegenInput {
  hp: number;
  maxHp: number;
  /** Seconds elapsed with no guard currently seeing the player. */
  timeSinceLastSeen: number;
  difficulty: Difficulty;
  /** Seconds since the last tick. */
  dt: number;
}

/** Returns the player's HP after applying one tick of passive regen. Only
 *  Easy regens; Medium/Hard return `hp` unchanged. No-ops when HP is already
 *  full, already at zero (respawn/revive logic owns that branch), or the
 *  unseen window is still running. */
export function applyPassiveRegen(input: RegenInput): number {
  if (input.difficulty !== 'easy') return input.hp;
  if (input.hp <= 0 || input.hp >= input.maxHp) return input.hp;
  if (input.timeSinceLastSeen < PASSIVE_REGEN_DELAY_SECONDS) return input.hp;
  return Math.min(
    input.maxHp,
    input.hp + PASSIVE_REGEN_HP_PER_SECOND * input.dt,
  );
}
