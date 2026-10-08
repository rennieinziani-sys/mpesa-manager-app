export type TxType =
  | 'received'
  | 'sent'
  | 'paybill'
  | 'till'
  | 'withdraw'
  | 'deposit'
  | 'airtime'
  | 'fuliza_draw'
  | 'fuliza_repay'
  | 'reversal';

/** 'in' = money into M-Pesa, 'out' = money leaving, 'neutral' = liability event (Fuliza draw). */
export type Direction = 'in' | 'out' | 'neutral';

export interface ParsedTransaction {
  /**
   * Unique key, used to dedupe re-imports. Equals `code`, except Fuliza notices
   * which can share a code with the payment they fund, so they get a
   * `:fuliza_draw` / `:fuliza_repay` suffix. Verify against real samples.
   */
  id: string;
  /** 10-char M-Pesa transaction code as printed in the SMS. */
  code: string;
  type: TxType;
  direction: Direction;
  /** Amounts are integer cents (KES * 100) to avoid float drift. */
  amountCents: number;
  /** Transaction cost / Fuliza access fee, in cents. */
  feeCents: number;
  counterparty: string | null;
  /** Normalised to +2547XXXXXXXX when fully visible; masked numbers are kept as-is. */
  phone: string | null;
  /** Paybill account number, or agent/till number where present. */
  account: string | null;
  /** ISO 8601 with +03:00 (EAT). */
  ts: string;
  balanceAfterCents: number | null;
  /** Total Fuliza owed after a draw, when the SMS states it. */
  fulizaOutstandingCents: number | null;
  raw: string;
}

export type ParseFailureReason =
  | 'no_code'
  | 'not_a_transaction'
  | 'unrecognised_format'
  | 'no_timestamp';

export type ParseResult =
  | { ok: true; tx: ParsedTransaction }
  | { ok: false; reason: ParseFailureReason; raw: string };

export interface ParseOptions {
  /**
   * SMS received time (ISO). Used only for messages that carry no timestamp
   * of their own (e.g. Fuliza draw notices).
   */
  fallbackTs?: string;
}

export interface BatchResult {
  parsed: ParsedTransaction[];
  /** Messages we could not parse. Keep these for review; never drop silently. */
  unparsed: { raw: string; reason: ParseFailureReason }[];
  /** Number of messages skipped because the code was already seen. */
  duplicates: number;
}