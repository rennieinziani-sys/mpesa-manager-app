import { BUILTIN_RULES, categorize, ruleFromCorrection } from '../src/categorize/categorizer';

const base = { type: 'paybill' as const, direction: 'out' as const, account: null };

describe('categorize', () => {
  test('matches known merchants', () => {
    expect(categorize({ ...base, counterparty: 'KPLC PREPAID' }).category).toBe('Utilities');
    expect(categorize({ ...base, type: 'till', counterparty: 'JAVA HOUSE' }).category).toBe('Food & Dining');
  });

  test('uses whole-word matching: SHA does not match SHARON, RENT does not match PARENTS', () => {
    expect(categorize({ ...base, type: 'sent', counterparty: 'SHARON KAMAU' }).category).toBeNull();
    expect(categorize({ ...base, type: 'sent', counterparty: 'PARENTS SACCO' }).category).toBeNull();
    expect(categorize({ ...base, counterparty: 'SHA' }).category).toBe('Health');
  });

  test('type defaults', () => {
    expect(categorize({ type: 'airtime', direction: 'out', counterparty: null, account: null }).category).toBe(
      'Airtime & Data',
    );
    expect(categorize({ type: 'withdraw', direction: 'out', counterparty: 'AGENT X', account: '123' }).category).toBe(
      'Cash Withdrawal',
    );
    expect(categorize({ type: 'fuliza_draw', direction: 'neutral', counterparty: null, account: null }).category).toBe(
      'Fees & Charges',
    );
  });

  test('incoming money defaults to Income; unknown outgoing is uncategorised', () => {
    expect(categorize({ type: 'received', direction: 'in', counterparty: 'JOHN DOE', account: null }).category).toBe(
      'Income',
    );
    expect(categorize({ type: 'sent', direction: 'out', counterparty: 'JOHN DOE', account: null })).toEqual({
      category: null,
      source: 'none',
    });
  });

  test('withdrawals stay Cash Withdrawal even when the agent name matches a merchant rule', () => {
    expect(
      categorize({ type: 'withdraw', direction: 'out', counterparty: 'MAMA MBOGA AGENT', account: '123456' }).category,
    ).toBe('Cash Withdrawal');
  });

  test('agent deposits and reversals are Transfers, not Income', () => {
    expect(categorize({ type: 'deposit', direction: 'in', counterparty: 'MAMA MBOGA AGENT', account: null }).category).toBe(
      'Transfers',
    );
    expect(categorize({ type: 'reversal', direction: 'in', counterparty: null, account: 'SJK4X1Y2Z5' }).category).toBe(
      'Transfers',
    );
  });

  test('a rule the user created still overrides a type default', () => {
    const rules = [
      ...BUILTIN_RULES,
      { pattern: 'MAMA MBOGA AGENT', category: 'Groceries', priority: 100, origin: 'user' as const },
    ];
    expect(
      categorize({ type: 'withdraw', direction: 'out', counterparty: 'MAMA MBOGA AGENT', account: '123456' }, rules)
        .category,
    ).toBe('Groceries');
  });

  test('user rules outrank builtin rules, longest pattern wins on tie', () => {
    const rules = [
      ...BUILTIN_RULES,
      { pattern: 'JAVA HOUSE', category: 'Entertainment', priority: 100, origin: 'user' as const },
    ];
    expect(categorize({ ...base, type: 'till', counterparty: 'JAVA HOUSE' }, rules).category).toBe('Entertainment');

    const tie = [
      { pattern: 'KCB', category: 'Savings & Loans' },
      { pattern: 'KCB M-PESA', category: 'Transfers' },
    ];
    expect(categorize({ ...base, counterparty: 'KCB M-PESA' }, tie).category).toBe('Transfers');
  });
});

describe('ruleFromCorrection', () => {
  test('learns from counterparty at high priority', () => {
    expect(ruleFromCorrection({ type: 'till', counterparty: 'MAMA OLIECH', account: null }, 'Groceries')).toEqual({
      pattern: 'MAMA OLIECH',
      category: 'Groceries',
      priority: 100,
      origin: 'user',
    });
  });

  test('returns null without a counterparty', () => {
    expect(ruleFromCorrection({ type: 'airtime', counterparty: null, account: null }, 'Other')).toBeNull();
  });
});