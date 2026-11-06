import { parseBatch, parseMpesaSms } from '../src/parser/parser';

// Real message formats (names and numbers replaced).
const TILL =
  'UK65M19X9F Confirmed. Ksh90.00 paid to Naivas Supermarket Kasarani. on 6/11/26 at 8:22 PM.New M-PESA balance is Ksh1.11. Transaction cost, Ksh0.00. Amount you can transact within the day is 499,725.00. See all your balances now https://saf.cx/kWQpy';
const FULIZA =
  'UK65M1AHUP Confirmed. Fuliza M-PESA amount is Ksh 48.89. Access Fee charged Ksh 0.49. Total Fuliza M-PESA outstanding amount is Ksh49.38 due on 06/12/26. To check daily charges, Dial *334#OK Select Query Charges';
const SENT =
  'UK65M1AHUP Confirmed. Ksh50.00 sent to JOHN DOE 0712345678 on 6/11/26 at 11:54 PM. New M-PESA balance is Ksh0.00. Transaction cost, Ksh0.00. Amount you can transact within the day is 499,675.00. See all your balances now https://saf.cx/iqlzU';
const RECEIVED_AT = '2026-11-06T23:54:00+03:00';

describe('real messages from a phone inbox', () => {
  test('till payment with a decimal-only balance', () => {
    const r = parseMpesaSms(TILL);
    expect(r).toMatchObject({ ok: true, tx: { type: 'till', amountCents: 9000, balanceAfterCents: 111, feeCents: 0 } });
  });

  test('Fuliza notice: loan amount, access fee and outstanding total', () => {
    const r = parseMpesaSms(FULIZA, { fallbackTs: RECEIVED_AT });
    expect(r).toMatchObject({
      ok: true,
      tx: { type: 'fuliza_draw', id: 'UK65M1AHUP:fuliza_draw', amountCents: 4889, feeCents: 49, fulizaOutstandingCents: 4938 },
    });
  });

  test('a send that shares its code with a Fuliza notice', () => {
    const r = parseMpesaSms(SENT);
    expect(r).toMatchObject({ ok: true, tx: { type: 'sent', id: 'UK65M1AHUP', amountCents: 5000, phone: '+254712345678' } });
  });

  test('all three together: nothing dropped, nothing treated as a duplicate', () => {
    const b = parseBatch([
      { body: TILL, receivedAt: RECEIVED_AT },
      { body: FULIZA, receivedAt: RECEIVED_AT },
      { body: SENT, receivedAt: RECEIVED_AT },
    ]);
    expect(b.unparsed).toEqual([]);
    expect(b.duplicates).toBe(0);
    expect(b.parsed).toHaveLength(3);
  });
});