import { ParsedTransaction } from '../parser/types';

export type StoredTransaction = ParsedTransaction & { category: string | null };

export interface CategoryTotal {
  category: string;
  cents: number;
  count: number;
}

export interface MonthSummary {
  month: string; // YYYY-MM (EAT)
  /** Money received from others (not agent cash-in, not reversals). */
  incomeCents: number;
  /** Money spent: sends, paybill, till, airtime, agent withdrawals. Net of reversals. */
  spendCents: number;
  /** Transaction costs plus Fuliza access fees: what M-Pesa cost you. */
  feesCents: number;
  /** Fuliza principal drawn this month. */
  fulizaBorrowedCents: number;
  /** Money from M-Pesa used to repay Fuliza this month. */
  fulizaRepaidCents: number;
  byCategory: CategoryTotal[];
  topCounterparties: { counterparty: string; cents: number; count: number }[];
  txCount: number;
}

const monthOf = (ts: string) => ts.slice(0, 7);

/** Summarise one calendar month. Timestamps are ISO in EAT so slicing is safe. */
export function summarizeMonth(txs: StoredTransaction[], month: string): MonthSummary {
  const s: MonthSummary = {
    month,
    incomeCents: 0,
    spendCents: 0,
    feesCents: 0,
    fulizaBorrowedCents: 0,
    fulizaRepaidCents: 0,
    byCategory: [],
    topCounterparties: [],
    txCount: 0,
  };
  const cats = new Map<string, CategoryTotal>();
  const people = new Map<string, { counterparty: string; cents: number; count: number }>();

  const add = <T extends { cents: number; count: number }>(m: Map<string, T>, key: string, make: () => T, cents: number) => {
    const row = m.get(key) ?? make();
    row.cents += cents;
    row.count += 1;
    m.set(key, row);
  };

  for (const t of txs) {
    if (monthOf(t.ts) !== month) continue;
    s.txCount++;
    s.feesCents += t.feeCents;

    switch (t.type) {
      case 'received':
        s.incomeCents += t.amountCents;
        break;
      case 'deposit':
        break; // cash in from an agent is a transfer, not income
      case 'reversal':
        s.spendCents -= t.amountCents;
        break;
      case 'fuliza_draw':
        s.fulizaBorrowedCents += t.amountCents;
        break;
      case 'fuliza_repay':
        s.fulizaRepaidCents += t.amountCents;
        break;
      default: {
        // sent, paybill, till, withdraw, airtime
        s.spendCents += t.amountCents;
        const cat = t.category ?? 'Uncategorised';
        add(cats, cat, () => ({ category: cat, cents: 0, count: 0 }), t.amountCents);
        if (t.counterparty) {
          add(people, t.counterparty, () => ({ counterparty: t.counterparty!, cents: 0, count: 0 }), t.amountCents);
        }
      }
    }
  }

  s.byCategory = [...cats.values()].sort((a, b) => b.cents - a.cents);
  s.topCounterparties = [...people.values()].sort((a, b) => b.cents - a.cents).slice(0, 5);
  return s;
}

export interface Budget {
  category: string;
  limitCents: number;
}

export interface BudgetStatus {
  category: string;
  limitCents: number;
  usedCents: number;
  remainingCents: number;
  /** 0..n, can exceed 1 when over budget. */
  ratio: number;
  status: 'ok' | 'warn' | 'over';
}

/** `warnAt` is the ratio at which a heads-up alert fires (default 80%). */
export function budgetStatuses(
  byCategory: CategoryTotal[],
  budgets: Budget[],
  warnAt = 0.8,
): BudgetStatus[] {
  const used = new Map(byCategory.map((c) => [c.category, c.cents]));
  return budgets.map((b) => {
    const usedCents = used.get(b.category) ?? 0;
    const ratio = usedCents / b.limitCents;
    return {
      category: b.category,
      limitCents: b.limitCents,
      usedCents,
      remainingCents: b.limitCents - usedCents,
      ratio,
      status: ratio > 1 ? 'over' : ratio >= warnAt ? 'warn' : 'ok',
    };
  });
}

/** Format integer cents as "KES 1,234.50". */
export function formatKes(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}KES ${whole}.${frac}`;
}