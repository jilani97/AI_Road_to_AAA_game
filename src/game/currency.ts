export const CURRENCY_STORAGE_KEY = 'neonTail.currency.v1';

export type CurrencySource =
  | 'pickup'
  | 'end_of_run'
  | 'knockout'
  | 'refund'
  | 'debug_grant';

let balance = 0;

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — balance stays in-memory for this session
  }
}

function persist(): void {
  safeSetItem(CURRENCY_STORAGE_KEY, String(balance));
}

/** Read balance from storage into the module cache. Call once on boot. */
export function hydrateCurrency(): number {
  const raw = safeGetItem(CURRENCY_STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  balance = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  return balance;
}

export function getBalance(): number {
  return balance;
}

export function earn(amount: number, _source: CurrencySource): number {
  if (amount <= 0) return balance;
  balance += Math.floor(amount);
  persist();
  return balance;
}

export interface SpendResult {
  ok: boolean;
  balance: number;
}

export function spend(amount: number): SpendResult {
  const cost = Math.floor(amount);
  if (cost <= 0) return { ok: true, balance };
  if (balance < cost) return { ok: false, balance };
  balance -= cost;
  persist();
  return { ok: true, balance };
}

/** Test-only helper that resets the in-module state without touching storage. */
export function __resetCurrencyForTests(initialBalance: number = 0): void {
  balance = Math.max(0, Math.floor(initialBalance));
}
