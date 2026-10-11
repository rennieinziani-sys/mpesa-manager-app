import { normalisePhone, parseBatch, parseMpesaSms, toCents, toIso } from '../src/parser/parser';
import { ParsedTransaction } from '../src/parser/types';

// Anonymised samples. Replace/extend with real messages from your own phone
// (strip names and numbers) before relying on this parser.
const SAMPLES = {
  received:
    'SJK4X1Y2Z3 Confirmed. You have received Ksh1,500.00 from JOHN DOE 0712345678 on 5/10/26 at 3:45 PM. New M-PESA balance is Ksh3,200.50.',
  receivedBusiness:
    'SJK4X1Y2Z4 Confirmed. You have received Ksh25,000.00 from ACME LTD. on 1/10/26 at 9:05 AM  New M-PESA balance is Ksh28,200.50.',
  sent: 'SJK4X1Y2Z5 Confirmed. Ksh500.00 sent to JANE WANJIKU 0722345678 on 5/10/26 at 4:10 PM. New M-PESA balance is Ksh2,700.50. Transaction cost, Ksh7.00. Amount you can transact within the day is 499,500.00.',
  paybill:
    'SJK4X1Y2Z6 Confirmed. Ksh1,200.00 sent to KPLC PREPAID for account 14212345678 on 5/10/26 at 6:30 PM New M-PESA balance is Ksh1,500.50. Transaction cost, Ksh11.00.',
  till: 'SJK4X1Y2Z7 Confirmed. Ksh350.00 paid to JAVA HOUSE. on 6/10/26 at 1:15 PM.New M-PESA balance is Ksh1,150.50. Transaction cost, Ksh0.00.',
  withdraw:
    'SJK4X1Y2Z8 Confirmed. on 6/10/26 at 8:00 PM Withdraw Ksh2,000.00 from 123456 - MAMA MBOGA AGENT New M-PESA balance is Ksh500.50. Transaction cost, Ksh29.00.',
  deposit:
    'SJK4X1Y2Z9 Confirmed. On 7/10/26 at 10:00 AM Give Ksh1,000.00 cash to MAMA MBOGA AGENT New M-PESA balance is Ksh1,500.50.',
  airtime:
    'SJK4X1YA01 confirmed. You bought Ksh100.00 of airtime on 7/10/26 at 11:20 AM.New M-PESA balance is Ksh400.50. Transaction cost, Ksh0.00.',
  airtimeOther:
    'SJK4X1YA02 confirmed. You bought Ksh50.00 of airtime for 0733111222 on 7/10/26 at 12:00 PM.New M-PESA balance is Ksh350.50. Transaction cost, Ksh0.00.',
  fulizaDraw:
    'SJK4X1YB01 Confirmed. Fuliza M-PESA amount is Ksh500.00. Access Fee charged Ksh5.00. Total Fuliza M-PESA outstanding amount is Ksh505.00 due on 4/11/26.',
  fulizaRepay:
    'SJK4X1YB01 Confirmed. Ksh300.00 from your M-PESA has been used to partially pay your outstanding Fuliza M-PESA. Available Fuliza M-PESA limit is Ksh4,700.00. M-PESA balance is Ksh0.00.',
  reversal:
    'SJK4X1YC01 Confirmed. Reversal of transaction SJK4X1Y2Z5 has been successfully reversed on 8/10/26 at 9:00 AM and Ksh500.00 is credited to your M-PESA account. New M-PESA balance is Ksh3,200.50.',
};

const ok = (body: string, fallbackTs?: string): ParsedTransaction => {
  const r = parseMpesaSms(body, { fallbackTs });
  if (!r.ok) throw new Error(`expected parse success, got ${r.reason}`);
  return r.tx;
};

describe('helpers', () => {
  test('toCents handles commas and decimals without float drift', () => {
    expect(toCents('1,500.00')).toBe(150000);
    expect(toCents('7.5')).toBe(750);
    expect(toCents('0.10')).toBe(10);
    expect(toCents('499,500')).toBe(49950000);
  });

  test('toIso converts 12h/24h time to EAT', () => {
    expect(toIso('5/10/26', '3:45 PM')).toBe('2026-10-05T15:45:00+03:00');
    expect(toIso('1/1/2027', '12:05 AM')).toBe('2027-01-01T00:05:00+03:00');
    expect(toIso('1/1/27', '12:05 PM')).toBe('2027-01-01T12:05:00+03:00');
    expect(toIso('1/1/27', '18:30')).toBe('2027-01-01T18:30:00+03:00');
    expect(toIso('32/1/27', '1:00 PM')).toBeNull();
    expect(toIso('1/13/27', '1:00 PM')).toBeNull();
  });

  test('normalisePhone', () => {
    expect(normalisePhone('0712345678')).toBe('+254712345678');
    expect(normalisePhone('254712345678')).toBe('+254712345678');
    expect(normalisePhone('2547****5678')).toBe('2547****5678');
    expect(normalisePhone(undefined)).toBeNull();
  });
});

describe('parseMpesaSms', () => {
  test('received from person', () => {
    const tx = ok(SAMPLES.received);
    expect(tx).toMatchObject({
      id: 'SJK4X1Y2Z3',
      type: 'received',
      direction: 'in',
      amountCents: 150000,
      feeCents: 0,
      counterparty: 'JOHN DOE',
      phone: '+254712345678',
      ts: '2026-10-05T15:45:00+03:00',
      balanceAfterCents: 320050,
    });
  });

  test('received from business (no phone)', () => {
    const tx = ok(SAMPLES.receivedBusiness);
    expect(tx.type).toBe('received');
    expect(tx.counterparty).toBe('ACME LTD');
    expect(tx.phone).toBeNull();
    expect(tx.amountCents).toBe(2500000);
    expect(tx.ts).toBe('2026-10-01T09:05:00+03:00');
  });

  test('sent to person with fee', () => {
    const tx = ok(SAMPLES.sent);
    expect(tx).toMatchObject({
      type: 'sent',
      direction: 'out',
      amountCents: 50000,
      feeCents: 700,
      counterparty: 'JANE WANJIKU',
      phone: '+254722345678',
      balanceAfterCents: 270050,
    });
  });

  test('paybill is not mistaken for a person-to-person send', () => {
    const tx = ok(SAMPLES.paybill);
    expect(tx).toMatchObject({
      type: 'paybill',
      amountCents: 120000,
      feeCents: 1100,
      counterparty: 'KPLC PREPAID',
      account: '14212345678',
      phone: null,
    });
  });

  test('till payment with sloppy spacing', () => {
    const tx = ok(SAMPLES.till);
    expect(tx).toMatchObject({
      type: 'till',
      amountCents: 35000,
      counterparty: 'JAVA HOUSE',
      feeCents: 0,
      ts: '2026-10-06T13:15:00+03:00',
      balanceAfterCents: 115050,
    });
  });

  test('agent withdrawal', () => {
    const tx = ok(SAMPLES.withdraw);
    expect(tx).toMatchObject({
      type: 'withdraw',
      amountCents: 200000,
      feeCents: 2900,
      account: '123456',
      counterparty: 'MAMA MBOGA AGENT',
      ts: '2026-10-06T20:00:00+03:00',
    });
  });

  test('agent deposit', () => {
    const tx = ok(SAMPLES.deposit);
    expect(tx).toMatchObject({
      type: 'deposit',
      direction: 'in',
      amountCents: 100000,
      counterparty: 'MAMA MBOGA AGENT',
    });
  });

  test('airtime for self and for another number', () => {
    const own = ok(SAMPLES.airtime);
    expect(own).toMatchObject({ type: 'airtime', amountCents: 10000, phone: null });
    const other = ok(SAMPLES.airtimeOther);
    expect(other).toMatchObject({ type: 'airtime', amountCents: 5000, phone: '+254733111222' });
  });

  test('fuliza draw uses fallback timestamp and records access fee', () => {
    const tx = ok(SAMPLES.fulizaDraw, '2026-10-08T10:00:00+03:00');
    expect(tx).toMatchObject({
      id: 'SJK4X1YB01:fuliza_draw',
      code: 'SJK4X1YB01',
      type: 'fuliza_draw',
      direction: 'neutral',
      amountCents: 50000,
      feeCents: 500,
      fulizaOutstandingCents: 50500,
      ts: '2026-10-08T10:00:00+03:00',
    });
  });

  test('fuliza repay shares a code with the draw but gets a distinct id', () => {
    const draw = ok(SAMPLES.fulizaDraw, '2026-10-08T10:00:00+03:00');
    const repay = ok(SAMPLES.fulizaRepay, '2026-10-09T10:00:00+03:00');
    expect(repay.code).toBe(draw.code);
    expect(repay.id).not.toBe(draw.id);
    expect(repay).toMatchObject({ type: 'fuliza_repay', amountCents: 30000, balanceAfterCents: 0 });
  });

  test('fuliza without any timestamp fails with no_timestamp', () => {
    const r = parseMpesaSms(SAMPLES.fulizaDraw);
    expect(r).toMatchObject({ ok: false, reason: 'no_timestamp' });
  });

  test('reversal', () => {
    const tx = ok(SAMPLES.reversal);
    expect(tx).toMatchObject({
      type: 'reversal',
      direction: 'in',
      amountCents: 50000,
      account: 'SJK4X1Y2Z5',
      ts: '2026-10-08T09:00:00+03:00',
    });
  });

  test('keeps the raw SMS untouched', () => {
    expect(ok(SAMPLES.sent).raw).toBe(SAMPLES.sent);
  });

  test('case-insensitive "confirmed" and extra whitespace', () => {
    const tx = ok('  sjk4x1y2z5   confirmed.  Ksh10.00 paid to  SHOP  on 1/1/27 at 1:00 PM. New M-PESA balance is Ksh5.00.');
    expect(tx.code).toBe('SJK4X1Y2Z5');
    expect(tx.counterparty).toBe('SHOP');
  });

  test('non-transaction SMS', () => {
    expect(parseMpesaSms('Dear customer, enjoy free data this weekend!')).toMatchObject({
      ok: false,
      reason: 'not_a_transaction',
    });
  });

  test('confirmed but malformed code', () => {
    expect(parseMpesaSms('XYZ Confirmed. Ksh10.00 sent to A 0712345678 on 1/1/27 at 1:00 PM.')).toMatchObject({
      ok: false,
      reason: 'no_code',
    });
  });

  test('unknown format is flagged, not dropped', () => {
    expect(
      parseMpesaSms('SJK4X1Y2ZZ Confirmed. Some brand new M-PESA product launched for you.'),
    ).toMatchObject({ ok: false, reason: 'unrecognised_format' });
  });
});

// Shapes taken from real messages (names replaced). Note the spaces in "Ksh 100.00",
// the trailing "See all your balances now" link, and that a Fuliza notice shares its
// transaction code with the payment it funds.
const REAL = {
  fulizaDraw:
    'UJ55M97ZAL Confirmed. Fuliza M-PESA amount is Ksh 100.00. Access Fee charged Ksh 1.00. Total Fuliza M-PESA outstanding amount is Ksh300.39 due on 04/11/26. To check daily charges, Dial *334#OK Select Query Charges',
  till: 'UJ55M97ZAL Confirmed. Ksh100.00 paid to JOHN DOE KAMAU. on 5/10/26 at 8:51 PM.New M-PESA balance is Ksh0.00. Transaction cost, Ksh0.00. Amount you can transact within the day is 499,645.00. See all your balances now https://saf.cx/kWQpy',
};

describe('real-world samples', () => {
  test('Fuliza draw with spaced amounts records fee and outstanding debt', () => {
    const tx = ok(REAL.fulizaDraw, '2026-10-05T20:51:00+03:00');
    expect(tx).toMatchObject({
      id: 'UJ55M97ZAL:fuliza_draw',
      amountCents: 10000,
      feeCents: 100,
      fulizaOutstandingCents: 30039,
      balanceAfterCents: null,
    });
  });

  test('till payment fully funded by Fuliza leaves zero balance', () => {
    const tx = ok(REAL.till);
    expect(tx).toMatchObject({
      id: 'UJ55M97ZAL',
      type: 'till',
      amountCents: 10000,
      feeCents: 0,
      counterparty: 'JOHN DOE KAMAU',
      ts: '2026-10-05T20:51:00+03:00',
      balanceAfterCents: 0,
      fulizaOutstandingCents: null,
    });
  });

  test('payment and its Fuliza notice share a code but both are kept', () => {
    const res = parseBatch([
      { body: REAL.fulizaDraw, receivedAt: '2026-10-05T20:51:00+03:00' },
      { body: REAL.till, receivedAt: '2026-10-05T20:51:00+03:00' },
    ]);
    expect(res.parsed.map((t) => t.id)).toEqual(['UJ55M97ZAL:fuliza_draw', 'UJ55M97ZAL']);
    expect(res.duplicates).toBe(0);
  });
});

describe('parseBatch', () => {
  test('dedupes by id, separates unparsed, ignores promo noise', () => {
    const res = parseBatch([
      { body: SAMPLES.sent },
      { body: SAMPLES.sent }, // duplicate (re-import)
      { body: SAMPLES.till },
      { body: 'Win big with Safaricom this week!' }, // noise
      { body: 'SJK4X1Y2ZZ Confirmed. Something we cannot parse.' },
      { body: SAMPLES.fulizaDraw, receivedAt: '2026-10-08T10:00:00+03:00' },
      { body: SAMPLES.fulizaRepay, receivedAt: '2026-10-09T10:00:00+03:00' },
    ]);
    expect(res.parsed.map((t) => t.type)).toEqual(['sent', 'till', 'fuliza_draw', 'fuliza_repay']);
    expect(res.duplicates).toBe(1);
    expect(res.unparsed).toHaveLength(1);
    expect(res.unparsed[0].reason).toBe('unrecognised_format');
  });

  test('respects a pre-seeded seen set (DB-backed dedupe)', () => {
    const seen = new Set(['SJK4X1Y2Z5']);
    const res = parseBatch([{ body: SAMPLES.sent }], seen);
    expect(res.parsed).toHaveLength(0);
    expect(res.duplicates).toBe(1);
  });
});