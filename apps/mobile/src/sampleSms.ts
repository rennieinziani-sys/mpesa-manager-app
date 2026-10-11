import type { InboxMessage } from '@mpesa/core';

// Demo messages in the real M-Pesa formats (names and numbers are made up).
// Replace with your own anonymised messages, or with the live inbox on Android.
export const SAMPLE_SMS: InboxMessage[] = [
  {
    body: 'UJ51A1B2C3 Confirmed. You have received Ksh 25,000.00 from ACME LTD. on 1/10/26 at 9:05 AM  New M-PESA balance is Ksh25,400.39.',
    receivedAt: '2026-10-01T09:05:00+03:00',
  },
  {
    body: 'UJ52D4E5F6 Confirmed. Ksh1,200.00 sent to KPLC PREPAID for account 14212345678 on 2/10/26 at 6:30 PM New M-PESA balance is Ksh24,189.39. Transaction cost, Ksh11.00.',
    receivedAt: '2026-10-02T18:30:00+03:00',
  },
  {
    body: 'UJ53G7H8I9 Confirmed. Ksh350.00 paid to JAVA HOUSE. on 3/10/26 at 1:15 PM.New M-PESA balance is Ksh23,839.39. Transaction cost, Ksh0.00. Amount you can transact within the day is 499,650.00. See all your balances now https://saf.cx/kWQpy',
    receivedAt: '2026-10-03T13:15:00+03:00',
  },
  {
    body: 'UJ54J1K2L3 Confirmed. Ksh500.00 sent to JANE WANJIKU 0722345678 on 4/10/26 at 4:10 PM. New M-PESA balance is Ksh23,332.39. Transaction cost, Ksh7.00. Amount you can transact within the day is 499,500.00.',
    receivedAt: '2026-10-04T16:10:00+03:00',
  },
  {
    body: 'UJ55M4N5O6 Confirmed. on 4/10/26 at 8:00 PM Withdraw Ksh2,000.00 from 123456 - MAMA MBOGA AGENT New M-PESA balance is Ksh21,303.39. Transaction cost, Ksh29.00.',
    receivedAt: '2026-10-04T20:00:00+03:00',
  },
  {
    body: 'UJ55P7Q8R9 confirmed. You bought Ksh100.00 of airtime on 5/10/26 at 11:20 AM.New M-PESA balance is Ksh21,203.39. Transaction cost, Ksh0.00.',
    receivedAt: '2026-10-05T11:20:00+03:00',
  },
  // A payment covered by Fuliza: the Fuliza notice and the payment share one code.
  {
    body: 'UJ55M97ZAL Confirmed. Fuliza M-PESA amount is Ksh 100.00. Access Fee charged Ksh 1.00. Total Fuliza M-PESA outstanding amount is Ksh300.39 due on 04/11/26. To check daily charges, Dial *334#OK Select Query Charges',
    receivedAt: '2026-10-05T20:51:00+03:00',
  },
  {
    body: 'UJ55M97ZAL Confirmed. Ksh100.00 paid to SAMPLE SHOP KAMAU. on 5/10/26 at 8:51 PM.New M-PESA balance is Ksh0.00. Transaction cost, Ksh0.00. Amount you can transact within the day is 499,645.00. See all your balances now https://saf.cx/kWQpy',
    receivedAt: '2026-10-05T20:51:00+03:00',
  },
  // Not an M-Pesa transaction: ignored.
  { body: 'Win big with Safaricom this week!', receivedAt: '2026-10-06T08:00:00+03:00' },
  // An M-Pesa message the parser does not know yet: kept for review.
  {
    body: 'UJ56S1T2U3 Confirmed. Some brand new M-PESA product launched for you.',
    receivedAt: '2026-10-06T09:00:00+03:00',
  },
];