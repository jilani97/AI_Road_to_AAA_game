import { describe, expect, it } from 'vitest';
import {
  MEDKIT_HEAL_AMOUNT,
  MEDKIT_PRICE_BY_DIFFICULTY,
  MEDKIT_STOCK_BY_DIFFICULTY,
  canPurchaseMedkit,
  medkitPrice,
  medkitsRemaining,
} from '../src/game/consumables';
import type { Difficulty } from '../src/game/settings';

describe('consumable tables', () => {
  it('medkit heal is the advertised 2 HP', () => {
    expect(MEDKIT_HEAL_AMOUNT).toBe(2);
  });

  it('price rises with difficulty (Easy < Medium < Hard)', () => {
    expect(MEDKIT_PRICE_BY_DIFFICULTY.easy).toBeLessThan(MEDKIT_PRICE_BY_DIFFICULTY.medium);
    expect(MEDKIT_PRICE_BY_DIFFICULTY.medium).toBeLessThan(MEDKIT_PRICE_BY_DIFFICULTY.hard);
  });

  it('stock drops with difficulty (Easy > Medium > Hard)', () => {
    expect(MEDKIT_STOCK_BY_DIFFICULTY.easy).toBeGreaterThan(MEDKIT_STOCK_BY_DIFFICULTY.medium);
    expect(MEDKIT_STOCK_BY_DIFFICULTY.medium).toBeGreaterThan(MEDKIT_STOCK_BY_DIFFICULTY.hard);
  });

  it('Hard still offers at least one medkit per run', () => {
    expect(MEDKIT_STOCK_BY_DIFFICULTY.hard).toBeGreaterThanOrEqual(1);
  });
});

describe('canPurchaseMedkit', () => {
  it.each<[Difficulty]>([['easy'], ['medium'], ['hard']])(
    'returns null when stock and funds are available (%s)',
    (difficulty) => {
      expect(
        canPurchaseMedkit({
          purchasedThisRun: 0,
          balance: 1000,
          difficulty,
        }),
      ).toBeNull();
    },
  );

  it('rejects out_of_stock at the cap boundary', () => {
    expect(
      canPurchaseMedkit({
        purchasedThisRun: MEDKIT_STOCK_BY_DIFFICULTY.medium,
        balance: 1000,
        difficulty: 'medium',
      }),
    ).toBe('out_of_stock');
  });

  it('rejects insufficient_funds when balance < price', () => {
    expect(
      canPurchaseMedkit({
        purchasedThisRun: 0,
        balance: MEDKIT_PRICE_BY_DIFFICULTY.hard - 1,
        difficulty: 'hard',
      }),
    ).toBe('insufficient_funds');
  });

  it('stock is checked before funds (an OOO player does not see a funds error)', () => {
    expect(
      canPurchaseMedkit({
        purchasedThisRun: MEDKIT_STOCK_BY_DIFFICULTY.hard,
        balance: 0,
        difficulty: 'hard',
      }),
    ).toBe('out_of_stock');
  });
});

describe('medkitsRemaining', () => {
  it.each<[Difficulty, number, number]>([
    ['easy', 0, MEDKIT_STOCK_BY_DIFFICULTY.easy],
    ['medium', 1, MEDKIT_STOCK_BY_DIFFICULTY.medium - 1],
    ['hard', 1, 0],
  ])('%s after %i purchases -> %i remaining', (difficulty, purchased, expected) => {
    expect(medkitsRemaining(purchased, difficulty)).toBe(expected);
  });

  it('clamps to zero when somehow over-purchased', () => {
    expect(medkitsRemaining(99, 'hard')).toBe(0);
  });
});

describe('medkitPrice', () => {
  it('returns the price table value', () => {
    expect(medkitPrice('easy')).toBe(MEDKIT_PRICE_BY_DIFFICULTY.easy);
    expect(medkitPrice('hard')).toBe(MEDKIT_PRICE_BY_DIFFICULTY.hard);
  });
});
