import { summarizeMonth } from '../src/analytics/summary';
import {
  applyMigrations, Db, ingestSms, listBudgets, listTransactions, loadRules, recategorize, seed, setBudget,
} from '../src/db/repository';
import { createTestDb } from './helpers/sqljsDb';

const SMS = {
  received:
    'SJK4X1Y2Z3 Confirmed. You have received Ksh5,000.00 from ACME LTD. on 1/10/26 at 9:05 AM  New M-PESA balance is Ksh8,000.00.',
  till1:
    'SJK4X1Y2Z7 Confirmed. Ksh350.00 paid to JAVA HOUSE. on 6/10/26 at 1:15 PM.New M-PESA balance is Ksh7,650.00. Transaction cost, Ksh0.00.',
  till2:
    'SJK4X1Y2Z8 Confirmed. Ksh450.00 paid to MAMA OLIECH on 7/10/26 at 1:15 PM.New M-PESA balance is Ksh7,200.00. Transaction cost, Ksh0.00.',
  till3:
    'SJK4X1Y2Z9 Confirmed. Ksh100.00 paid to MAMA OLIECH on 8/10/26 at 1:15 PM.New M-PESA balance is Ksh7,100.00. Transaction cost, Ksh0.00.',
  paybill:
    'SJK4X1Y2ZA Confirmed. Ksh1,200.00 sent to KPLC PREPAID for account 14212345678 on 5/10/26 at 6:30 PM New M-PESA balance is Ksh6,800.00. Transaction cost, Ksh11.00.',
  fuliza:
    'SJK4X1YB01 Confirmed. Fuliza M-PESA amount is Ksh500.00. Access Fee charged Ksh5.00. Total Fuliza M-PESA outstanding amount is Ksh505.00 due on 4/11/26.',
  junk: 'SJK4X1Y2ZZ Confirmed. Something we cannot parse.',
  promo: 'Win big with Safaricom!',
};

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await applyMigrations(db);
  await seed(db);
});

const msgs = (...keys: (keyof typeof SMS)[]) =>
  keys.map((k) => ({ body: SMS[k], receivedAt: '2026-10-09T08:00:00+03:00' }));

describe('migrations and seed', () => {
  test('are idempotent', async () => {
    await applyMigrations(db);
    await seed(db);
    const cats = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
    expect(cats[0].n).toBeGreaterThan(10);
    const v = await db.all<{ value: string }>(`SELECT value FROM meta WHERE key='schema_version'`);
    expect(v[0].value).toBe('1');
  });

  test('loads builtin rules with category names', async () => {
    const rules = await loadRules(db);
    expect(rules.find((r) => r.pattern === 'KPLC')).toMatchObject({ category: 'Utilities', origin: 'builtin' });
  });
});

describe('ingestSms', () => {
  test('stores parsed transactions with categories, keeps unparsed, ignores promos', async () => {
    const res = await ingestSms(db, msgs('received', 'till1', 'paybill', 'fuliza', 'junk', 'promo'));
    expect(res).toEqual({ inserted: 4, duplicates: 0, unparsed: 1 });

    const all = await listTransactions(db);
    expect(all).toHaveLength(4);
    expect(all.find((t) => t.id === 'SJK4X1Y2Z3')?.category).toBe('Income');
    expect(all.find((t) => t.id === 'SJK4X1Y2Z7')?.category).toBe('Food & Dining');
    expect(all.find((t) => t.id === 'SJK4X1Y2ZA')?.category).toBe('Utilities');
    expect(all.find((t) => t.id === 'SJK4X1YB01:fuliza_draw')).toMatchObject({ feeCents: 500, type: 'fuliza_draw' });

    const un = await db.all<{ raw_sms: string; reason: string }>('SELECT raw_sms, reason FROM unparsed_sms');
    expect(un).toEqual([{ raw_sms: SMS.junk, reason: 'unrecognised_format' }]);
  });

  test('re-importing the same inbox creates no duplicates', async () => {
    await ingestSms(db, msgs('received', 'till1', 'junk'));
    const again = await ingestSms(db, msgs('received', 'till1', 'junk'));
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(await listTransactions(db)).toHaveLength(2);
    const un = await db.all('SELECT * FROM unparsed_sms');
    expect(un).toHaveLength(1); // unparsed row not duplicated either
  });
});

describe('listTransactions', () => {
  beforeEach(async () => {
    await ingestSms(db, msgs('received', 'till1', 'till2', 'paybill'));
  });

  test('orders newest first and filters by date, category and search', async () => {
    const all = await listTransactions(db);
    expect(all.map((t) => t.id)).toEqual(['SJK4X1Y2Z8', 'SJK4X1Y2Z7', 'SJK4X1Y2ZA', 'SJK4X1Y2Z3']);

    expect((await listTransactions(db, { from: '2026-10-06T00:00:00+03:00' })).map((t) => t.id)).toEqual([
      'SJK4X1Y2Z8',
      'SJK4X1Y2Z7',
    ]);
    expect(await listTransactions(db, { category: 'Utilities' })).toHaveLength(1);
    expect((await listTransactions(db, { search: 'java' })).map((t) => t.counterparty)).toEqual(['JAVA HOUSE']);
    expect(await listTransactions(db, { search: '%' })).toHaveLength(0); // LIKE wildcards escaped
    expect(await listTransactions(db, { limit: 2, offset: 1 })).toHaveLength(2);
  });
});

describe('recategorize', () => {
  test('learns a user rule and applies it to past and future transactions', async () => {
    await ingestSms(db, msgs('till2'));
    expect((await listTransactions(db))[0].category).toBeNull();

    const rule = await recategorize(db, 'SJK4X1Y2Z8', 'Groceries');
    expect(rule).toMatchObject({ pattern: 'MAMA OLIECH', category: 'Groceries', origin: 'user' });

    // future SMS from the same merchant is auto-categorised
    await ingestSms(db, msgs('till3'));
    const all = await listTransactions(db);
    expect(all.find((t) => t.id === 'SJK4X1Y2Z9')?.category).toBe('Groceries');
    expect(all.find((t) => t.id === 'SJK4X1Y2Z8')?.category).toBe('Groceries');
  });

  test('does not overwrite other manual choices; later correction updates the rule', async () => {
    await ingestSms(db, msgs('till2', 'till3'));
    await recategorize(db, 'SJK4X1Y2Z8', 'Groceries');
    await recategorize(db, 'SJK4X1Y2Z9', 'Food & Dining'); // manual override of one row
    await recategorize(db, 'SJK4X1Y2Z8', 'Health'); // changes rule; Z9 stays manual

    const all = await listTransactions(db);
    expect(all.find((t) => t.id === 'SJK4X1Y2Z8')?.category).toBe('Health');
    expect(all.find((t) => t.id === 'SJK4X1Y2Z9')?.category).toBe('Food & Dining');
    const rules = (await loadRules(db)).filter((r) => r.pattern === 'MAMA OLIECH');
    expect(rules).toHaveLength(1);
    expect(rules[0].category).toBe('Health');
  });

  test('rejects unknown ids and categories', async () => {
    await expect(recategorize(db, 'NOPE', 'Groceries')).rejects.toThrow(/Unknown transaction/);
    await ingestSms(db, msgs('till2'));
    await expect(recategorize(db, 'SJK4X1Y2Z8', 'Nonsense')).rejects.toThrow(/Unknown category/);
  });
});

describe('budgets and summaries end-to-end', () => {
  test('upserts budgets', async () => {
    await setBudget(db, 'Food & Dining', 500000);
    await setBudget(db, 'Food & Dining', 600000);
    expect(await listBudgets(db)).toEqual([{ category: 'Food & Dining', limitCents: 600000, period: 'monthly' }]);
  });

  test('DB rows feed summarizeMonth', async () => {
    await ingestSms(db, msgs('received', 'till1', 'paybill', 'fuliza'));
    const s = summarizeMonth(await listTransactions(db), '2026-10');
    expect(s.incomeCents).toBe(500000);
    expect(s.spendCents).toBe(35000 + 120000);
    expect(s.feesCents).toBe(1100 + 500);
    expect(s.fulizaBorrowedCents).toBe(50000);
  });
});