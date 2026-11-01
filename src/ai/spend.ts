/**
 * What the chat has cost, for OpenRouter only: it reports each reply's exact cost (in credits,
 * one credit being one US dollar) and what a key has used. Other providers report tokens, not
 * money, so their cost would only be a guess.
 */
export const showsSpend = (provider: string) => provider === 'openrouter';

/** Spent from this device in one calendar month. */
export interface Spend { month: string; cost: number }

export const thisMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const addSpend = (s: Spend | null | undefined, cost: number): Spend => {
  const month = thisMonth();
  return { month, cost: (s?.month === month ? s.cost : 0) + cost };
};
export const spentThisMonth = (s: Spend | null | undefined) => (s?.month === thisMonth() ? s.cost : 0);

/** $0.0021 for one reply, $1.25 for a month. */
export const formatCost = (n: number) => (n <= 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** What an OpenRouter key has used (GET /key), in dollars. `left` is null for a key without a limit. */
export interface KeyUsage { total: number; month: number; left: number | null }
export function keyUsageFrom(v: { data?: { usage?: number; usage_monthly?: number; limit_remaining?: number | null } }): KeyUsage {
  return { total: v.data?.usage ?? 0, month: v.data?.usage_monthly ?? 0, left: v.data?.limit_remaining ?? null };
}
