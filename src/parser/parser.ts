import {
  BatchResult,
  Direction,
  ParsedTransaction,
  ParseOptions,
  ParseResult,
  TxType,
} from './types';

const AMT = String.raw`Ksh\s*(?<amt>[\d,]+(?:\.\d{1,2})?)`;
const DATE_TIME = String.raw`(?<date>\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(?<time>\d{1,2}:\d{2}\s?(?:AM|PM)?)`;
const PHONE = String.raw`(?<phone>[\d*+]{9,13})`;

const CODE_RE = /^\s*([A-Z0-9]{10})\s+confirmed\b/i;
const BALANCE_RE = /M-PESA balance is Ksh\s*([\d,]+(?:\.\d{1,2})?)/i;
const COST_RE = /Transaction cost,?\s*Ksh\s*([\d,]+(?:\.\d{1,2})?)/i;
const ACCESS_FEE_RE = /Access Fee charged Ksh\s*([\d,]+(?:\.\d{1,2})?)/i;
const FULIZA_OUTSTANDING_RE = /Total Fuliza M-PESA outstanding amount is Ksh\s*([\d,]+(?:\.\d{1,2})?)/i;

interface Rule {
  type: TxType;
  direction: Direction;
  /** Order matters: more specific rules must come before more general ones. */
  re: RegExp;
}

const rule = (type: TxType, direction: Direction, pattern: string): Rule => ({
  type,
  direction,
  re: new RegExp(pattern, 'i'),
});

const RULES: Rule[] = [
  // Paybill before "sent": "sent to X for account 123 on ..." would otherwise
  // be mistaken for a person-to-person send with an 11-digit "phone".
  rule(
    'paybill',
    'out',
    String.raw`${AMT}\s+sent to\s+(?<name>.+?)\s+for account\s+(?<account>\S+?)\s+on\s+${DATE_TIME}`,
  ),
  rule(
    'sent',
    'out',
    String.raw`${AMT}\s+sent to\s+(?<name>.+?)\s+${PHONE}\s+on\s+${DATE_TIME}`,
  ),
  rule('till', 'out', String.raw`${AMT}\s+paid to\s+(?<name>.+?)\.?\s*on\s+${DATE_TIME}`),
  rule(
    'received',
    'in',
    String.raw`You have received\s+${AMT}\s+from\s+(?<name>.+?)(?:\s+${PHONE})?\.?\s+on\s+${DATE_TIME}`,
  ),
  rule(
    'withdraw',
    'out',
    String.raw`on\s+${DATE_TIME}\s+Withdraw\s+${AMT}\s+from\s+(?<account>\S+)\s+-\s+(?<name>.+?)\s+New M-PESA`,
  ),
  rule(
    'deposit',
    'in',
    String.raw`on\s+${DATE_TIME}\s+Give\s+${AMT}\s+cash to\s+(?<name>.+?)\s+New M-PESA`,
  ),
  rule(
    'airtime',
    'out',
    String.raw`You bought\s+${AMT}\s+of airtime(?:\s+for\s+${PHONE})?\s+on\s+${DATE_TIME}`,
  ),
  rule(
    'reversal',
    'in',
    String.raw`Reversal of transaction\s+(?<account>[A-Z0-9]{10})\s+has been successfully reversed on\s+${DATE_TIME}\s+and\s+${AMT}\s+is credited`,
  ),
  // Fuliza notices carry no timestamp of their own.
  rule('fuliza_draw', 'neutral', String.raw`Fuliza M-PESA amount is\s+${AMT}`),
  rule(
    'fuliza_repay',
    'out',
    String.raw`${AMT}\s+from your M-PESA has been used to (?:partially |fully )?pay`,
  ),
];

export function toCents(s: string): number {
  const clean = s.replace(/,/g, '');
  const [whole, frac = ''] = clean.split('.');
  return parseInt(whole || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
}

/** "0712345678" / "+254712345678" -> "+254712345678"; masked numbers pass through. */
export function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.includes('*')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return '+254' + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return '+' + digits;
  return raw;
}

/** "5/10/26" + "3:45 PM" -> "2026-10-05T15:45:00+03:00" (EAT), or null if invalid. */
export function toIso(date: string, time: string): string | null {
  const d = date.split('/').map((n) => parseInt(n, 10));
  if (d.length !== 3) return null;
  const [day, month] = d;
  let year = d[2];
  if (year < 100) year += 2000;
  const m = /^(\d{1,2}):(\d{2})\s?(AM|PM)?$/i.exec(time.trim());
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const mer = m[3]?.toUpperCase();
  if (mer === 'PM' && hour < 12) hour += 12;
  if (mer === 'AM' && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:00+03:00`;
}

const cleanName = (s: string | undefined): string | null => {
  const v = s?.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
  return v ? v.toUpperCase() : null;
};

export function parseMpesaSms(body: string, opts: ParseOptions = {}): ParseResult {
  const raw = body;
  const text = body.replace(/\s+/g, ' ').trim();

  const codeMatch = CODE_RE.exec(text);
  if (!codeMatch) {
    return {
      ok: false,
      reason: /confirmed/i.test(text) ? 'no_code' : 'not_a_transaction',
      raw,
    };
  }
  const code = codeMatch[1].toUpperCase();

  for (const r of RULES) {
    const m = r.re.exec(text);
    if (!m || !m.groups) continue;
    const g = m.groups;

    let ts: string | null = null;
    if (g.date && g.time) ts = toIso(g.date, g.time);
    else ts = opts.fallbackTs ?? null;
    if (!ts) return { ok: false, reason: 'no_timestamp', raw };

    const isFuliza = r.type === 'fuliza_draw' || r.type === 'fuliza_repay';
    const feeMatch = r.type === 'fuliza_draw' ? ACCESS_FEE_RE.exec(text) : COST_RE.exec(text);
    const balance = BALANCE_RE.exec(text);
    const outstanding = FULIZA_OUTSTANDING_RE.exec(text);

    const tx: ParsedTransaction = {
      id: isFuliza ? `${code}:${r.type}` : code,
      code,
      type: r.type,
      direction: r.direction,
      amountCents: toCents(g.amt),
      feeCents: feeMatch ? toCents(feeMatch[1]) : 0,
      counterparty: cleanName(g.name),
      phone: normalisePhone(g.phone),
      account: g.account ?? null,
      ts,
      balanceAfterCents: balance ? toCents(balance[1]) : null,
      fulizaOutstandingCents: outstanding ? toCents(outstanding[1]) : null,
      raw,
    };
    return { ok: true, tx };
  }

  return { ok: false, reason: 'unrecognised_format', raw };
}

export interface InboxMessage {
  body: string;
  /** SMS received time (ISO), used as fallback timestamp. */
  receivedAt?: string;
}

/** Parse many messages, deduping by transaction id and keeping failures for review. */
export function parseBatch(messages: InboxMessage[], seen: Set<string> = new Set()): BatchResult {
  const out: BatchResult = { parsed: [], unparsed: [], duplicates: 0 };
  for (const msg of messages) {
    const res = parseMpesaSms(msg.body, { fallbackTs: msg.receivedAt });
    if (!res.ok) {
      // Non-transaction SMS (promos, OTPs) are expected noise, not failures.
      if (res.reason !== 'not_a_transaction') {
        out.unparsed.push({ raw: res.raw, reason: res.reason });
      }
      continue;
    }
    if (seen.has(res.tx.id)) {
      out.duplicates++;
      continue;
    }
    seen.add(res.tx.id);
    out.parsed.push(res.tx);
  }
  return out;
}