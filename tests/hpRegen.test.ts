import { describe, expect, it } from 'vitest';
import {
  PASSIVE_REGEN_DELAY_SECONDS,
  PASSIVE_REGEN_HP_PER_SECOND,
  applyPassiveRegen,
  type RegenInput,
} from '../src/game/hpRegen';
import type { Difficulty } from '../src/game/settings';

function input(partial: Partial<RegenInput> = {}): RegenInput {
  return {
    hp: 2,
    maxHp: 3,
    timeSinceLastSeen: 10,
    difficulty: 'easy',
    dt: 1,
    ...partial,
  };
}

describe('applyPassiveRegen', () => {
  it('regens on easy once the delay has elapsed', () => {
    expect(applyPassiveRegen(input())).toBeCloseTo(2 + PASSIVE_REGEN_HP_PER_SECOND);
  });

  it('does not regen before the delay elapses', () => {
    expect(
      applyPassiveRegen(input({ timeSinceLastSeen: PASSIVE_REGEN_DELAY_SECONDS - 0.01 })),
    ).toBe(2);
  });

  it('regens exactly at the threshold', () => {
    expect(
      applyPassiveRegen(input({ timeSinceLastSeen: PASSIVE_REGEN_DELAY_SECONDS })),
    ).toBeCloseTo(2 + PASSIVE_REGEN_HP_PER_SECOND);
  });

  it.each<[Difficulty]>([['medium'], ['hard']])(
    'does not regen on %s — that tier relies on consumables',
    (difficulty) => {
      expect(applyPassiveRegen(input({ difficulty }))).toBe(2);
    },
  );

  it('caps at max HP', () => {
    expect(applyPassiveRegen(input({ hp: 2.9, dt: 10 }))).toBe(3);
  });

  it('does not regen from zero — 0 HP means the death/revive branch owns the player', () => {
    expect(applyPassiveRegen(input({ hp: 0 }))).toBe(0);
  });

  it('does not regen when already at max', () => {
    expect(applyPassiveRegen(input({ hp: 3 }))).toBe(3);
  });

  it('scales the increment with dt', () => {
    expect(applyPassiveRegen(input({ dt: 0.5 }))).toBeCloseTo(
      2 + PASSIVE_REGEN_HP_PER_SECOND * 0.5,
    );
    expect(applyPassiveRegen(input({ dt: 2 }))).toBeCloseTo(
      2 + PASSIVE_REGEN_HP_PER_SECOND * 2,
    );
  });

  it('is deterministic — identical inputs produce identical HP', () => {
    const i = input();
    expect(applyPassiveRegen(i)).toBe(applyPassiveRegen(i));
  });
});
