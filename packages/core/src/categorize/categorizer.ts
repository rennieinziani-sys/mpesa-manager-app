import { ParsedTransaction } from '../parser/types';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match so "SHA" does not hit "SHARON" and "RENT" does not hit "PARENTS". */
function matchesWord(haystackUpper: string, patternUpper: string): boolean {
  return new RegExp(`(^|[^A-Z0-9])${escapeRe(patternUpper)}([^A-Z0-9]|$)`).test(haystackUpper);
}

export interface MerchantRule {
  /** Case-insensitive whole-word match against counterparty and account. */
  pattern: string;
  category: string;
  /** Higher wins. User rules should use a larger priority than built-ins. */
  priority?: number;
  origin?: 'builtin' | 'user';
}

/** Starter rules for common Kenyan merchants. Extend freely; users override. */
export const BUILTIN_RULES: MerchantRule[] = [
  { pattern: 'KPLC', category: 'Utilities' },
  { pattern: 'KENYA POWER', category: 'Utilities' },
  { pattern: 'NAIROBI WATER', category: 'Utilities' },
  { pattern: 'ZUKU', category: 'Utilities' },
  { pattern: 'SAFARICOM HOME', category: 'Utilities' },
  { pattern: 'DSTV', category: 'Entertainment' },
  { pattern: 'GOTV', category: 'Entertainment' },
  { pattern: 'NETFLIX', category: 'Entertainment' },
  { pattern: 'SHOWMAX', category: 'Entertainment' },
  { pattern: 'JAVA', category: 'Food & Dining' },
  { pattern: 'KFC', category: 'Food & Dining' },
  { pattern: 'ARTCAFFE', category: 'Food & Dining' },
  { pattern: 'CHICKEN INN', category: 'Food & Dining' },
  { pattern: 'PIZZA', category: 'Food & Dining' },
  { pattern: 'GLOVO', category: 'Food & Dining' },
  { pattern: 'NAIVAS', category: 'Groceries' },
  { pattern: 'QUICKMART', category: 'Groceries' },
  { pattern: 'CARREFOUR', category: 'Groceries' },
  { pattern: 'CHANDARANA', category: 'Groceries' },
  { pattern: 'MAMA MBOGA', category: 'Groceries' },
  { pattern: 'UBER', category: 'Transport' },
  { pattern: 'BOLT', category: 'Transport' },
  { pattern: 'LITTLE CAB', category: 'Transport' },
  { pattern: 'SHELL', category: 'Transport' },
  { pattern: 'TOTAL ENERGIES', category: 'Transport' },
  { pattern: 'RUBIS', category: 'Transport' },
  { pattern: 'KCB M-PESA', category: 'Savings & Loans' },
  { pattern: 'M-SHWARI', category: 'Savings & Loans' },
  { pattern: 'MSHWARI', category: 'Savings & Loans' },
  { pattern: 'KCB', category: 'Savings & Loans' },
  { pattern: 'EQUITY', category: 'Savings & Loans' },
  { pattern: 'HELB', category: 'Education' },
  { pattern: 'UNIVERSITY', category: 'Education' },
  { pattern: 'SCHOOL', category: 'Education' },
  { pattern: 'PHARMACY', category: 'Health' },
  { pattern: 'HOSPITAL', category: 'Health' },
  { pattern: 'CLINIC', category: 'Health' },
  { pattern: 'SHA', category: 'Health' },
  { pattern: 'RENT', category: 'Rent & Housing' },
  { pattern: 'LANDLORD', category: 'Rent & Housing' },
];

/** Categories implied directly by transaction type, before any merchant matching. */
const TYPE_DEFAULTS: Partial<Record<ParsedTransaction['type'], string>> = {
  airtime: 'Airtime & Data',
  withdraw: 'Cash Withdrawal',
  deposit: 'Transfers',
  reversal: 'Transfers',
  fuliza_draw: 'Fees & Charges',
  fuliza_repay: 'Savings & Loans',
};

export interface Categorization {
  category: string | null;
  source: 'rule' | 'none';
  matchedPattern?: string;
}

/** Best matching rule: highest priority, then longest pattern. */
function bestMatch(haystackUpper: string, rules: MerchantRule[]): MerchantRule | null {
  let best: MerchantRule | null = null;
  for (const r of rules) {
    const p = r.pattern.trim().toUpperCase();
    if (!p || !matchesWord(haystackUpper, p)) continue;
    if (
      !best ||
      (r.priority ?? 0) > (best.priority ?? 0) ||
      ((r.priority ?? 0) === (best.priority ?? 0) && p.length > best.pattern.trim().length)
    ) {
      best = r;
    }
  }
  return best;
}

/**
 * Pick a category for a transaction, in this order:
 * 1. Rules the user created (learned from corrections): the user always wins.
 * 2. Transaction types with a fixed meaning (airtime, cash withdrawal, agent deposit,
 *    reversal, Fuliza). An agent called "MAMA MBOGA" must not turn a withdrawal into Groceries.
 * 3. Built-in merchant rules, against counterparty + account.
 * 4. Any other incoming money is Income.
 * Returns category null when nothing matches; the UI should surface these for review.
 */
export function categorize(
  tx: Pick<ParsedTransaction, 'type' | 'direction' | 'counterparty' | 'account'>,
  rules: MerchantRule[] = BUILTIN_RULES,
): Categorization {
  const haystack = `${tx.counterparty ?? ''} ${tx.account ?? ''}`.toUpperCase();
  const hasText = haystack.trim() !== '';

  if (hasText) {
    const userRule = bestMatch(haystack, rules.filter((r) => r.origin === 'user'));
    if (userRule) return { category: userRule.category, source: 'rule', matchedPattern: userRule.pattern };
  }

  const typeDefault = TYPE_DEFAULTS[tx.type];
  if (typeDefault) return { category: typeDefault, source: 'rule' };

  if (hasText) {
    const rule = bestMatch(haystack, rules.filter((r) => r.origin !== 'user'));
    if (rule) return { category: rule.category, source: 'rule', matchedPattern: rule.pattern };
  }

  if (tx.direction === 'in') return { category: 'Income', source: 'rule' };

  return { category: null, source: 'none' };
}

/**
 * Turn a user's manual recategorisation into a rule so future transactions
 * from the same counterparty are categorised automatically.
 * Returns null when there is nothing stable to learn from (e.g. no counterparty).
 */
export function ruleFromCorrection(
  tx: Pick<ParsedTransaction, 'counterparty' | 'account' | 'type'>,
  category: string,
): MerchantRule | null {
  // Paybill account numbers are personal (e.g. meter numbers); learn the paybill name instead.
  const pattern = tx.counterparty?.trim();
  if (!pattern) return null;
  return { pattern, category, priority: 100, origin: 'user' };
}