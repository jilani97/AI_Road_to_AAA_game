import type { Difficulty } from './settings';

/** HP restored by a single Medkit use. Flat across difficulties — the scaling
 *  lives in price and stock, not in effectiveness. */
export const MEDKIT_HEAL_AMOUNT = 2;

/** Medkit price in coins, per difficulty. Plan Task 5: Hard consumables are
 *  "rarer and more expensive". */
export const MEDKIT_PRICE_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 20,
  medium: 35,
  hard: 60,
};

/** Maximum medkits purchasable per run, per difficulty. The shop's stock
 *  resets on every `reset()` — enforcing "rarer" on Hard through scarcity. */
export const MEDKIT_STOCK_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 5,
  medium: 3,
  hard: 1,
};

export interface MedkitPurchaseInput {
  /** How many medkits the player has already bought this run. */
  purchasedThisRun: number;
  balance: number;
  difficulty: Difficulty;
}

export type MedkitPurchaseFailure =
  | 'out_of_stock'
  | 'insufficient_funds';

/** Null when the purchase is allowed; otherwise the reason. Pure so the shop
 *  UI and GameApp can both call it for pre-click validation / post-click auth. */
export function canPurchaseMedkit(
  input: MedkitPurchaseInput,
): MedkitPurchaseFailure | null {
  if (input.purchasedThisRun >= MEDKIT_STOCK_BY_DIFFICULTY[input.difficulty]) {
    return 'out_of_stock';
  }
  if (input.balance < MEDKIT_PRICE_BY_DIFFICULTY[input.difficulty]) {
    return 'insufficient_funds';
  }
  return null;
}

export function medkitPrice(difficulty: Difficulty): number {
  return MEDKIT_PRICE_BY_DIFFICULTY[difficulty];
}

export function medkitsRemaining(
  purchasedThisRun: number,
  difficulty: Difficulty,
): number {
  return Math.max(0, MEDKIT_STOCK_BY_DIFFICULTY[difficulty] - purchasedThisRun);
}
