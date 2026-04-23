import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENCY_STORAGE_KEY,
  __resetCurrencyForTests,
  earn,
  getBalance,
  hydrateCurrency,
  spend,
} from '../src/game/currency';

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

describe('currency persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    __resetCurrencyForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates to 0 when nothing is stored', () => {
    expect(hydrateCurrency()).toBe(0);
    expect(getBalance()).toBe(0);
  });

  it('hydrates from a positive integer stored value', () => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, '250');
    expect(hydrateCurrency()).toBe(250);
  });

  it('clamps negative and non-numeric stored values to 0', () => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, '-50');
    expect(hydrateCurrency()).toBe(0);
    localStorage.setItem(CURRENCY_STORAGE_KEY, 'abc');
    expect(hydrateCurrency()).toBe(0);
  });

  it('earn adds to the balance and persists', () => {
    __resetCurrencyForTests(100);
    expect(earn(50, 'pickup')).toBe(150);
    expect(localStorage.getItem(CURRENCY_STORAGE_KEY)).toBe('150');
  });

  it('earn of zero or negative is a no-op', () => {
    __resetCurrencyForTests(100);
    expect(earn(0, 'pickup')).toBe(100);
    expect(earn(-10, 'pickup')).toBe(100);
  });

  it('spend deducts when affordable and persists', () => {
    __resetCurrencyForTests(100);
    const result = spend(30);
    expect(result).toEqual({ ok: true, balance: 70 });
    expect(getBalance()).toBe(70);
    expect(localStorage.getItem(CURRENCY_STORAGE_KEY)).toBe('70');
  });

  it('spend refuses when the balance is short and leaves it untouched', () => {
    __resetCurrencyForTests(20);
    const result = spend(50);
    expect(result).toEqual({ ok: false, balance: 20 });
    expect(getBalance()).toBe(20);
  });

  it('spend of zero is always a no-op success', () => {
    __resetCurrencyForTests(10);
    expect(spend(0)).toEqual({ ok: true, balance: 10 });
  });

  it('fractional amounts are floored', () => {
    __resetCurrencyForTests(0);
    earn(12.9, 'pickup');
    expect(getBalance()).toBe(12);
    spend(3.7);
    expect(getBalance()).toBe(9);
  });
});
