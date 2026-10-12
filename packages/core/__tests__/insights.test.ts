import { budgetProgress, detectRecurring, eatDate, forecastMonth, runway } from '../src/analytics/insights';
import { StoredTransaction } from '../src/analytics/summary';

let n = 0;
const tx = (over: Partial<StoredTransaction>): StoredTransaction => ({
  id: `T${++n}`, code: `T${n}`, type: 'till', direction: 'out', amountCents: 0, feeCents: 0,
  counterparty: null, phone: null, account: null, ts: '2026-10-05T12:00:00+03:00',
  balanceAfterCents: null, fulizaOutstandingCents: null, raw: '', category: null, ...over,
});
const on = (day: string, over: Partial<StoredTransaction> = {}) => tx({ ts: `${day}T12:00:00+03:00`, ...over });

describe('eatDate', () => {
  test('rolls to the next day after 21:00 UTC', () => {
    expect(eatDate(new Date('2026-10-11T21:30:00Z'))).toBe('2026-10-12');
    expect(eatDate(new Date('2026-10-11T20:59:00Z'))).toBe('2026-10-11');
  });
});

describe('forecastMonth', () => {
  test('steady spending projects linearly, with a zero-width range when perfectly steady', () => {
    const txs = Array.from({ length: 10 }, (_, i) => on(`2026-10-${String(i + 1).padStart(2, '0')}`, { amountCents: 100_00 }));
    const f = forecastMonth(txs, '2026-10', '2026-10-10');
    expect(f.spentCents).toBe(1_000_00);
    expect(f.projectedCents).toBe(3_100_00); // 100/day * 31 days
    expect(f.lowCents).toBe(f.projectedCents);
    expect(f.highCents).toBe(f.projectedCents);
    expect(f.confidence).toBe('ok');
  });
  test('uneven spending widens the range around the projection', () => {
    const txs = [on('2026-10-01', { amountCents: 1_000_00 }), on('2026-10-02', { amountCents: 10_00 }), on('2026-10-08', { amountCents: 500_00 })];
    const f = forecastMonth(txs, '2026-10', '2026-10-10');
    expect(f.lowCents).toBeLessThan(f.projectedCents);
    expect(f.highCents).toBeGreaterThan(f.projectedCents);
    expect(f.lowCents).toBeGreaterThanOrEqual(f.spentCents);
  });
  test('few data points are flagged low confidence', () => {
    const f = forecastMonth([on('2026-10-02', { amountCents: 50_00 })], '2026-10', '2026-10-03');
    expect(f.confidence).toBe('low');
  });
  test('a finished month projects to exactly what was spent', () => {
    const f = forecastMonth([on('2026-09-10', { amountCents: 70_00 })], '2026-09', '2026-10-12');
    expect(f.projectedCents).toBe(70_00);
    expect(f.lowCents).toBe(70_00);
  });
  test('income and fuliza do not count as spending', () => {
    const txs = [on('2026-10-01', { type: 'received', direction: 'in', amountCents: 9_999_00 }), on('2026-10-01', { type: 'fuliza_draw', direction: 'neutral', amountCents: 500_00 })];
    expect(forecastMonth(txs, '2026-10', '2026-10-05').spentCents).toBe(0);
  });
});

describe('budgetProgress', () => {
  const txs = [
    on('2026-10-02', { amountCents: 400_00, category: 'Food & Dining' }),
    on('2026-10-03', { amountCents: 700_00, category: 'Transport' }),
    on('2026-10-04', { amountCents: 100_00, category: 'Airtime & Data' }),
  ];
  const budgets = [
    { category: 'Food & Dining', limitCents: 5_000_00 },
    { category: 'Transport', limitCents: 1_000_00 },
    { category: 'Airtime & Data', limitCents: 150_00 },
    { category: 'Shopping', limitCents: 500_00 },
  ];
  const p = budgetProgress(txs, budgets, '2026-10', '2026-10-10');
  const get = (c: string) => p.find((x) => x.category === c)!;
  test('on track, at risk and untouched categories', () => {
    expect(get('Food & Dining').status).toBe('on_track');
    expect(get('Transport').status).toBe('at_risk'); // 700 in 10 days -> 2,170 by month end
    expect(get('Shopping').usedCents).toBe(0);
    expect(get('Shopping').status).toBe('on_track');
  });
  test('over once the limit is passed', () => {
    const q = budgetProgress([...txs, on('2026-10-05', { amountCents: 100_00, category: 'Airtime & Data' })], budgets, '2026-10', '2026-10-10');
    expect(q.find((x) => x.category === 'Airtime & Data')!.status).toBe('over');
  });
});

describe('detectRecurring', () => {
  const rent = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((d) =>
    on(d, { type: 'paybill', counterparty: 'LANDLORD', account: 'A12', amountCents: 15_000_00 }));
  test('finds a monthly bill and predicts the next date', () => {
    const r = detectRecurring(rent, '2026-10-12');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ counterparty: 'LANDLORD', cadence: 'monthly', occurrences: 4, averageCents: 15_000_00 });
    expect(r[0].nextDate).toBe('2026-11-01');
    expect(r[0].daysUntilNext).toBe(20);
  });
  test('a bill paid on the 31st lands on the last day of shorter months', () => {
    const txs = ['2026-07-31', '2026-08-31', '2026-09-30'].map((d) => on(d, { type: 'paybill', counterparty: 'SACCO' }));
    expect(detectRecurring(txs, '2026-10-01')[0].nextDate).toBe('2026-10-30');
  });
  test('finds a weekly payment even if the amount varies', () => {
    const txs = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((d, i) => on(d, { counterparty: 'MAMA FUA', amountCents: (200 + i * 20) * 100 }));
    expect(detectRecurring(txs, '2026-10-01')[0]).toMatchObject({ cadence: 'weekly', nextDate: '2026-10-05' });
  });
  test('ignores irregular spending, withdrawals and fewer than 3 occurrences', () => {
    const irregular = ['2026-09-01', '2026-09-04', '2026-09-20'].map((d) => on(d, { counterparty: 'JAVA HOUSE' }));
    const wd = ['2026-07-01', '2026-08-01', '2026-09-01'].map((d) => on(d, { type: 'withdraw', counterparty: 'AGENT' }));
    const two = ['2026-08-01', '2026-09-01'].map((d) => on(d, { counterparty: 'ONCE' }));
    expect(detectRecurring([...irregular, ...wd, ...two], '2026-10-01')).toHaveLength(0);
  });
  test('same-day duplicates count once', () => {
    const txs = ['2026-08-01', '2026-08-01', '2026-09-01'].map((d) => on(d, { counterparty: 'X' }));
    expect(detectRecurring(txs, '2026-10-01')).toHaveLength(0);
  });
});

describe('runway', () => {
  test('balance divided by recent daily spend, including fees', () => {
    const txs = [
      on('2026-10-01', { amountCents: 190_00, feeCents: 10_00, balanceAfterCents: 9_800_00 }),
      on('2026-10-02', { amountCents: 200_00, balanceAfterCents: 9_600_00 }),
      on('2026-10-03', { amountCents: 200_00, balanceAfterCents: 5_000_00 }),
    ];
    const r = runway(txs, '2026-10-03')!;
    expect(r.balanceCents).toBe(5_000_00);
    expect(r.dailySpendCents).toBe(200_00); // 600 over 3 days
    expect(r.daysLeft).toBe(25);
    expect(r.runOutDate).toBe('2026-10-28');
  });
  test('uses the most recent balance regardless of array order', () => {
    const txs = [on('2026-10-03', { amountCents: 100_00, balanceAfterCents: 1_000_00 }), on('2026-10-01', { amountCents: 100_00, balanceAfterCents: 5_000_00 })];
    expect(runway(txs, '2026-10-03')!.balanceCents).toBe(1_000_00);
  });
  test('null without a balance or without recent spending', () => {
    expect(runway([on('2026-10-01', { amountCents: 100_00 })], '2026-10-03')).toBeNull();
    expect(runway([on('2026-06-01', { amountCents: 100_00, balanceAfterCents: 1_00 })], '2026-10-03')).toBeNull();
  });
});