import { Budget, StoredTransaction, summarizeMonth } from './summary';

/** Dates here are EAT calendar dates as 'YYYY-MM-DD'. */
const DAY_MS = 86_400_000;
const SPEND_TYPES = new Set(['sent', 'paybill', 'till', 'withdraw', 'airtime']);

/** Today's EAT calendar date for a JS Date (EAT = UTC+3, no DST). */
export function eatDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

const dayNum = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const fromDayNum = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const isSpend = (t: StoredTransaction) => SPEND_TYPES.has(t.type);

// ---------------------------------------------------------------- forecast

export interface MonthForecast {
  month: string;
  /** Spent so far (net of reversals), in cents. */
  spentCents: number;
  /** Expected total for the month. Equals spentCents once the month is over. */
  projectedCents: number;
  lowCents: number;
  highCents: number;
  daysElapsed: number;
  daysInMonth: number;
  /** 'low' when there is too little data this month to trust the pace. */
  confidence: 'low' | 'ok';
}

/** Project month-end spending from this month's daily pace, with a range. */
export function forecastMonth(txs: StoredTransaction[], month: string, today: string): MonthForecast {
  const total = daysInMonth(month);
  const spent = summarizeMonth(txs, month).spendCents;
  const monthStart = dayNum(`${month}-01`);
  const lastDay = monthStart + total - 1;
  const todayNum = dayNum(today);

  if (todayNum > lastDay) {
    return { month, spentCents: spent, projectedCents: spent, lowCents: spent, highCents: spent, daysElapsed: total, daysInMonth: total, confidence: 'ok' };
  }
  const elapsed = Math.max(1, Math.min(total, todayNum - monthStart + 1));
  const remaining = total - elapsed;

  const daily = new Array<number>(elapsed).fill(0);
  let spendCount = 0;
  for (const t of txs) {
    if (!t.ts.startsWith(month) || !isSpend(t)) continue;
    const idx = dayNum(t.ts.slice(0, 10)) - monthStart;
    if (idx >= 0 && idx < elapsed) {
      daily[idx] += t.amountCents;
      spendCount++;
    }
  }
  const mean = daily.reduce((a, b) => a + b, 0) / elapsed;
  const variance = daily.reduce((a, b) => a + (b - mean) ** 2, 0) / elapsed;
  const spread = Math.sqrt(variance) * Math.sqrt(remaining);

  const expected = mean * remaining;
  return {
    month,
    spentCents: spent,
    projectedCents: Math.round(spent + expected),
    lowCents: Math.round(spent + Math.max(0, expected - spread)),
    highCents: Math.round(spent + expected + spread),
    daysElapsed: elapsed,
    daysInMonth: total,
    confidence: elapsed >= 7 && spendCount >= 5 ? 'ok' : 'low',
  };
}

// ----------------------------------------------------------------- budgets

export interface BudgetProgress {
  category: string;
  limitCents: number;
  usedCents: number;
  remainingCents: number;
  /** Where this category lands by month end at the current pace. */
  projectedCents: number;
  /** over: already past the limit; at_risk: on pace to pass it; on_track otherwise. */
  status: 'on_track' | 'at_risk' | 'over';
}

export function budgetProgress(
  txs: StoredTransaction[],
  budgets: Budget[],
  month: string,
  today: string,
): BudgetProgress[] {
  const { byCategory } = summarizeMonth(txs, month);
  const used = new Map(byCategory.map((c) => [c.category, c.cents]));
  const total = daysInMonth(month);
  const todayNum = dayNum(today);
  const monthStart = dayNum(`${month}-01`);
  const elapsed = todayNum > monthStart + total - 1 ? total : Math.max(1, todayNum - monthStart + 1);

  return budgets.map((b) => {
    const usedCents = used.get(b.category) ?? 0;
    const projectedCents = Math.round((usedCents / elapsed) * total);
    return {
      category: b.category,
      limitCents: b.limitCents,
      usedCents,
      remainingCents: b.limitCents - usedCents,
      projectedCents,
      status: usedCents > b.limitCents ? 'over' : projectedCents > b.limitCents ? 'at_risk' : 'on_track',
    };
  });
}

// --------------------------------------------------------------- recurring

export interface RecurringPayment {
  counterparty: string;
  cadence: 'weekly' | 'fortnightly' | 'monthly';
  intervalDays: number;
  occurrences: number;
  averageCents: number;
  lastDate: string;
  nextDate: string;
  /** Negative when the expected payment is overdue. */
  daysUntilNext: number;
}

/** Same day-of-month one month later (clamped to the month's length), as a day number. */
function sameDayNextMonth(lastDay: number): number {
  const d = new Date(lastDay * DAY_MS);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const dom = d.getUTCDate();
  const nextLen = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Date.UTC(y, mo, Math.min(dom, nextLen)) / DAY_MS;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Find bills/payments that repeat on a steady rhythm (needs 3+ occurrences). */
export function detectRecurring(txs: StoredTransaction[], today: string): RecurringPayment[] {
  const groups = new Map<string, StoredTransaction[]>();
  for (const t of txs) {
    if (!isSpend(t) || t.type === 'withdraw' || !t.counterparty) continue;
    const key = `${t.counterparty.toUpperCase()}|${t.account ?? ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const todayNum = dayNum(today);
  const out: RecurringPayment[] = [];
  for (const list of groups.values()) {
    // One payment per day counts once (a retry or split shouldn't look like a rhythm).
    const days = [...new Set(list.map((t) => dayNum(t.ts.slice(0, 10))))].sort((a, b) => a - b);
    if (days.length < 3) continue;
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    const m = median(gaps);
    const cadence =
      m >= 6 && m <= 8 ? 'weekly' : m >= 13 && m <= 16 ? 'fortnightly' : m >= 27 && m <= 33 ? 'monthly' : null;
    if (!cadence) continue;
    const tolerance = Math.max(3, m * 0.25);
    if (gaps.some((g) => Math.abs(g - m) > tolerance)) continue;

    const last = days[days.length - 1];
    const next = cadence === 'monthly' ? sameDayNextMonth(last) : last + Math.round(m);
    out.push({
      counterparty: list[0].counterparty!,
      cadence,
      intervalDays: Math.round(m),
      occurrences: days.length,
      averageCents: Math.round(list.reduce((a, t) => a + t.amountCents, 0) / list.length),
      lastDate: fromDayNum(last),
      nextDate: fromDayNum(next),
      daysUntilNext: next - todayNum,
    });
  }
  return out.sort((a, b) => a.daysUntilNext - b.daysUntilNext);
}

// ------------------------------------------------------------------ runway

export interface Runway {
  balanceCents: number;
  balanceAsOf: string;
  dailySpendCents: number;
  /** Whole days the balance lasts if nothing comes in. */
  daysLeft: number;
  runOutDate: string;
}

/** How long the latest M-Pesa balance lasts at the last-30-days spending pace. */
export function runway(txs: StoredTransaction[], today: string, windowDays = 30): Runway | null {
  const withBalance = txs.filter((t) => t.balanceAfterCents != null);
  if (!withBalance.length) return null;
  const latest = withBalance.reduce((a, b) => (b.ts > a.ts ? b : a));

  const todayNum = dayNum(today);
  const from = todayNum - windowDays + 1;
  const spendTxs = txs.filter((t) => isSpend(t) && dayNum(t.ts.slice(0, 10)) >= from && dayNum(t.ts.slice(0, 10)) <= todayNum);
  if (!spendTxs.length) return null;
  const firstSpend = Math.min(...spendTxs.map((t) => dayNum(t.ts.slice(0, 10))));
  const span = Math.max(1, todayNum - Math.max(from, firstSpend) + 1);
  const dailySpendCents = Math.round(spendTxs.reduce((a, t) => a + t.amountCents + t.feeCents, 0) / span);
  if (dailySpendCents <= 0) return null;

  const balance = latest.balanceAfterCents!;
  const daysLeft = Math.max(0, Math.floor(balance / dailySpendCents));
  return {
    balanceCents: balance,
    balanceAsOf: latest.ts.slice(0, 10),
    dailySpendCents,
    daysLeft,
    runOutDate: fromDayNum(todayNum + daysLeft),
  };
}