import { budgetStatuses, formatKes, StoredTransaction, summarizeMonth } from '../src/analytics/summary';

let n = 0;
const tx = (over: Partial<StoredTransaction>): StoredTransaction => ({
  id: `T${++n}`,
  code: `T${n}`,
  type: 'sent',
  direction: 'out',
  amountCents: 0,
  feeCents: 0,
  counterparty: null,
  phone: null,
  account: null,
  ts: '2026-10-05T12:00:00+03:00',
  balanceAfterCents: null,
  fulizaOutstandingCents: null,
  raw: '',
  category: null,
  ...over,
});

describe('summarizeMonth', () => {
  const txs: StoredTransaction[] = [
    tx({ type: 'received', direction: 'in', amountCents: 5_000_00, counterparty: 'ACME LTD' }),
    tx({ type: 'deposit', direction: 'in', amountCents: 1_000_00 }),
    tx({ type: 'till', amountCents: 350_00, feeCents: 0, counterparty: 'JAVA HOUSE', category: 'Food & Dining' }),
    tx({ type: 'till', amountCents: 450_00, counterparty: 'JAVA HOUSE', category: 'Food & Dining' }),
    tx({ type: 'paybill', amountCents: 1_200_00, feeCents: 11_00, counterparty: 'KPLC PREPAID', category: 'Utilities' }),
    tx({ type: 'sent', amountCents: 500_00, feeCents: 7_00, counterparty: 'JOHN DOE' }),
    tx({ type: 'reversal', direction: 'in', amountCents: 500_00 }),
    tx({ type: 'fuliza_draw', direction: 'neutral', amountCents: 500_00, feeCents: 5_00 }),
    tx({ type: 'fuliza_repay', amountCents: 300_00 }),
    tx({ type: 'till', amountCents: 999_00, ts: '2026-09-30T23:59:00+03:00' }), // other month
  ];
  const s = summarizeMonth(txs, '2026-10');

  test('income excludes agent deposits and reversals', () => {
    expect(s.incomeCents).toBe(5_000_00);
  });

  test('spend is net of reversals and excludes Fuliza flows', () => {
    // 350 + 450 + 1200 + 500 - 500 reversal
    expect(s.spendCents).toBe(2_000_00);
  });

  test('fees include transaction costs and Fuliza access fees', () => {
    expect(s.feesCents).toBe(11_00 + 7_00 + 5_00);
  });

  test('fuliza tracked separately', () => {
    expect(s.fulizaBorrowedCents).toBe(500_00);
    expect(s.fulizaRepaidCents).toBe(300_00);
  });

  test('category breakdown sorted desc with Uncategorised bucket', () => {
    expect(s.byCategory.map((c) => [c.category, c.cents])).toEqual([
      ['Utilities', 1_200_00],
      ['Food & Dining', 800_00],
      ['Uncategorised', 500_00],
    ]);
  });

  test('top counterparties aggregate repeats', () => {
    expect(s.topCounterparties[0]).toEqual({ counterparty: 'KPLC PREPAID', cents: 1_200_00, count: 1 });
    expect(s.topCounterparties.find((p) => p.counterparty === 'JAVA HOUSE')).toMatchObject({ cents: 800_00, count: 2 });
  });

  test('ignores other months', () => {
    expect(s.txCount).toBe(9);
  });
});

describe('budgetStatuses', () => {
  const by = [
    { category: 'Food & Dining', cents: 8_500_00, count: 10 },
    { category: 'Transport', cents: 12_000_00, count: 5 },
    { category: 'Utilities', cents: 1_000_00, count: 1 },
  ];
  const res = budgetStatuses(by, [
    { category: 'Food & Dining', limitCents: 10_000_00 },
    { category: 'Transport', limitCents: 10_000_00 },
    { category: 'Utilities', limitCents: 5_000_00 },
    { category: 'Health', limitCents: 2_000_00 },
  ]);

  test('flags warn at 80% and over at >100%', () => {
    expect(res.map((r) => r.status)).toEqual(['warn', 'over', 'ok', 'ok']);
  });

  test('computes remaining and handles unused categories', () => {
    expect(res[1].remainingCents).toBe(-2_000_00);
    expect(res[3]).toMatchObject({ usedCents: 0, remainingCents: 2_000_00 });
  });
});

test('formatKes', () => {
  expect(formatKes(123456)).toBe('KES 1,234.56');
  expect(formatKes(5)).toBe('KES 0.05');
  expect(formatKes(-250000)).toBe('-KES 2,500.00');
});