import type { Budget, InboxMessage, StoredTransaction } from '@mpesa/core';

export interface AddResult {
  inserted: number;
  duplicates: number;
  unparsed: number;
}

export interface Ledger {
  /** False until storage has loaded. */
  ready: boolean;
  /** Newest first. */
  txs: StoredTransaction[];
  /** Messages that looked like M-Pesa but could not be parsed (kept for review). */
  unparsedCount: number;
  /** The failed messages themselves, newest first, so they can be reviewed. */
  unparsed: { raw: string; reason: string }[];
  add(messages: InboxMessage[]): Promise<AddResult>;
  /** Monthly spending limits per category. */
  budgets: Budget[];
  setBudget(category: string, limitCents: number): Promise<void>;
}