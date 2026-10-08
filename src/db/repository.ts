import { BUILTIN_RULES, categorize, MerchantRule, ruleFromCorrection } from '../categorize/categorizer';
import { StoredTransaction } from '../analytics/summary';
import { InboxMessage, parseBatch } from '../parser/parser';
import { ParseFailureReason } from '../parser/types';
import { DEFAULT_CATEGORIES, MIGRATIONS } from './schema';

/**
 * Thin DB port. The app implements it over op-sqlite / react-native-quick-sqlite
 * (with SQLCipher); tests implement it over sql.js. Keeps core logic portable.
 */
export interface Db {
  exec(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export async function applyMigrations(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const rows = await db.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
  const current = rows.length ? parseInt(rows[0].value, 10) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.transaction(async () => {
      for (const stmt of MIGRATIONS[v]) await db.exec(stmt);
      await db.exec(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(v + 1)],
      );
    });
  }
}

/** Idempotent: inserts default categories and builtin merchant rules. */
export async function seed(db: Db, rules: MerchantRule[] = BUILTIN_RULES): Promise<void> {
  await db.transaction(async () => {
    for (const c of DEFAULT_CATEGORIES) {
      await db.exec(
        `INSERT OR IGNORE INTO categories (name, icon, color, is_income) VALUES (?, ?, ?, ?)`,
        [c.name, c.icon, c.color, c.isIncome ? 1 : 0],
      );
    }
    const ids = await categoryIds(db);
    for (const r of rules) {
      const id = ids.get(r.category);
      if (id === undefined) continue;
      await db.exec(
        `INSERT OR IGNORE INTO merchant_rules (pattern, category_id, priority, origin) VALUES (?, ?, 0, 'builtin')`,
        [r.pattern, id],
      );
    }
  });
}

async function categoryIds(db: Db): Promise<Map<string, number>> {
  const rows = await db.all<{ id: number; name: string }>(`SELECT id, name FROM categories`);
  return new Map(rows.map((r) => [r.name, r.id]));
}

export async function loadRules(db: Db): Promise<MerchantRule[]> {
  const rows = await db.all<{ pattern: string; name: string; priority: number; origin: 'builtin' | 'user' }>(
    `SELECT r.pattern, c.name, r.priority, r.origin
       FROM merchant_rules r JOIN categories c ON c.id = r.category_id`,
  );
  return rows.map((r) => ({ pattern: r.pattern, category: r.name, priority: r.priority, origin: r.origin }));
}

export interface IngestResult {
  inserted: number;
  duplicates: number;
  unparsed: number;
}

/** Parse, categorise and store SMS messages. Safe to run repeatedly on the same inbox. */
export async function ingestSms(db: Db, messages: InboxMessage[], now = new Date()): Promise<IngestResult> {
  const existing = new Set((await db.all<{ id: string }>(`SELECT id FROM transactions`)).map((r) => r.id));
  const batch = parseBatch(messages, existing);
  const rules = await loadRules(db);
  const ids = await categoryIds(db);

  await db.transaction(async () => {
    for (const tx of batch.parsed) {
      const { category, source } = categorize(tx, rules);
      await db.exec(
        `INSERT OR IGNORE INTO transactions
           (id, code, type, direction, amount_cents, fee_cents, counterparty, phone, account,
            ts, balance_cents, fuliza_outstanding_cents, category_id, category_src, raw_sms, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sms')`,
        [
          tx.id, tx.code, tx.type, tx.direction, tx.amountCents, tx.feeCents,
          tx.counterparty, tx.phone, tx.account, tx.ts, tx.balanceAfterCents, tx.fulizaOutstandingCents,
          category ? ids.get(category) ?? null : null,
          category ? source : 'none',
          tx.raw,
        ],
      );
    }
    for (const u of batch.unparsed as { raw: string; reason: ParseFailureReason }[]) {
      await db.exec(
        `INSERT OR IGNORE INTO unparsed_sms (raw_sms, reason, seen_at) VALUES (?, ?, ?)`,
        [u.raw, u.reason, now.toISOString()],
      );
    }
  });

  return { inserted: batch.parsed.length, duplicates: batch.duplicates, unparsed: batch.unparsed.length };
}

export interface TxQuery {
  /** Inclusive ISO date/time bounds (EAT strings compare lexicographically). */
  from?: string;
  to?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface TxRow {
  id: string; code: string; type: string; direction: string; amount_cents: number; fee_cents: number;
  counterparty: string | null; phone: string | null; account: string | null; ts: string;
  balance_cents: number | null; fuliza_outstanding_cents: number | null;
  raw_sms: string; category: string | null;
}

export async function listTransactions(db: Db, q: TxQuery = {}): Promise<StoredTransaction[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.from) { where.push('t.ts >= ?'); params.push(q.from); }
  if (q.to) { where.push('t.ts <= ?'); params.push(q.to); }
  if (q.category) { where.push('c.name = ?'); params.push(q.category); }
  if (q.search) {
    where.push(`(t.counterparty LIKE ? OR t.account LIKE ? OR t.phone LIKE ? OR t.code LIKE ?)`);
    const like = `%${q.search.replace(/[%_]/g, (m) => '\\' + m)}%`;
    params.push(like, like, like, like);
  }
  const sql = `
    SELECT t.id, t.code, t.type, t.direction, t.amount_cents, t.fee_cents, t.counterparty, t.phone,
           t.account, t.ts, t.balance_cents, t.fuliza_outstanding_cents, t.raw_sms, c.name AS category
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.ts DESC, t.id DESC
     LIMIT ? OFFSET ?`.replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'");
  params.push(q.limit ?? 200, q.offset ?? 0);

  const rows = await db.all<TxRow>(sql, params);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    type: r.type as StoredTransaction['type'],
    direction: r.direction as StoredTransaction['direction'],
    amountCents: r.amount_cents,
    feeCents: r.fee_cents,
    counterparty: r.counterparty,
    phone: r.phone,
    account: r.account,
    ts: r.ts,
    balanceAfterCents: r.balance_cents,
    fulizaOutstandingCents: r.fuliza_outstanding_cents,
    raw: r.raw_sms,
    category: r.category,
  }));
}

/**
 * User recategorises one transaction. Learns a user rule from the counterparty and
 * re-applies it to other transactions that were not manually categorised.
 */
export async function recategorize(db: Db, id: string, categoryName: string): Promise<MerchantRule | null> {
  const ids = await categoryIds(db);
  const catId = ids.get(categoryName);
  if (catId === undefined) throw new Error(`Unknown category: ${categoryName}`);
  const rows = await db.all<{ type: string; counterparty: string | null; account: string | null }>(
    `SELECT type, counterparty, account FROM transactions WHERE id = ?`,
    [id],
  );
  if (!rows.length) throw new Error(`Unknown transaction: ${id}`);
  const row = rows[0];

  return db.transaction(async () => {
    await db.exec(`UPDATE transactions SET category_id = ?, category_src = 'user' WHERE id = ?`, [catId, id]);
    const rule = ruleFromCorrection(
      { type: row.type as StoredTransaction['type'], counterparty: row.counterparty, account: row.account },
      categoryName,
    );
    if (rule) {
      await db.exec(
        `INSERT INTO merchant_rules (pattern, category_id, priority, origin) VALUES (?, ?, ?, 'user')
         ON CONFLICT(pattern, origin) DO UPDATE SET category_id = excluded.category_id, priority = excluded.priority`,
        [rule.pattern, catId, rule.priority ?? 100],
      );
      await db.exec(
        `UPDATE transactions SET category_id = ?, category_src = 'rule'
          WHERE counterparty = ? AND category_src != 'user'`,
        [catId, rule.pattern],
      );
    }
    return rule;
  });
}

export async function setBudget(
  db: Db,
  categoryName: string,
  limitCents: number,
  period: 'weekly' | 'monthly' = 'monthly',
): Promise<void> {
  const catId = (await categoryIds(db)).get(categoryName);
  if (catId === undefined) throw new Error(`Unknown category: ${categoryName}`);
  await db.exec(
    `INSERT INTO budgets (category_id, period, limit_cents) VALUES (?, ?, ?)
     ON CONFLICT(category_id, period) DO UPDATE SET limit_cents = excluded.limit_cents`,
    [catId, period, limitCents],
  );
}

export async function listBudgets(db: Db): Promise<{ category: string; limitCents: number; period: string }[]> {
  const rows = await db.all<{ name: string; limit_cents: number; period: string }>(
    `SELECT c.name, b.limit_cents, b.period FROM budgets b JOIN categories c ON c.id = b.category_id ORDER BY c.name`,
  );
  return rows.map((r) => ({ category: r.name, limitCents: r.limit_cents, period: r.period }));
}