/**
 * SQLite schema (local-first). Money is stored as integer cents.
 * Apply statements in order inside one transaction; bump SCHEMA_VERSION and
 * append to MIGRATIONS for future changes.
 */
export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS categories (
       id        INTEGER PRIMARY KEY AUTOINCREMENT,
       name      TEXT NOT NULL UNIQUE,
       icon      TEXT,
       color     TEXT,
       is_income INTEGER NOT NULL DEFAULT 0
     )`,

    `CREATE TABLE IF NOT EXISTS transactions (
       id             TEXT PRIMARY KEY,          -- parser id (code, or code:fuliza_*)
       code           TEXT NOT NULL,
       type           TEXT NOT NULL,
       direction      TEXT NOT NULL CHECK (direction IN ('in','out','neutral')),
       amount_cents   INTEGER NOT NULL,
       fee_cents      INTEGER NOT NULL DEFAULT 0,
       counterparty   TEXT,
       phone          TEXT,
       account        TEXT,
       ts             TEXT NOT NULL,             -- ISO 8601, +03:00
       balance_cents  INTEGER,
       fuliza_outstanding_cents INTEGER,         -- total Fuliza owed after a draw, if stated
       category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
       category_src   TEXT NOT NULL DEFAULT 'none' CHECK (category_src IN ('none','rule','user')),
       raw_sms        TEXT NOT NULL,
       source         TEXT NOT NULL DEFAULT 'sms' CHECK (source IN ('sms','statement','manual'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_tx_ts ON transactions(ts)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tx_counterparty ON transactions(counterparty)`,

    // Messages we could not parse; kept for review, never dropped.
    `CREATE TABLE IF NOT EXISTS unparsed_sms (
       id       INTEGER PRIMARY KEY AUTOINCREMENT,
       raw_sms  TEXT NOT NULL UNIQUE,
       reason   TEXT NOT NULL,
       seen_at  TEXT NOT NULL
     )`,

    // Auto-categorisation rules. User-created rules (learned from corrections)
    // outrank built-in ones; higher priority wins, then longer pattern.
    `CREATE TABLE IF NOT EXISTS merchant_rules (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       pattern     TEXT NOT NULL,                -- case-insensitive whole-word match on counterparty/account
       category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
       priority    INTEGER NOT NULL DEFAULT 0,
       origin      TEXT NOT NULL DEFAULT 'builtin' CHECK (origin IN ('builtin','user')),
       UNIQUE (pattern, origin)
     )`,

    `CREATE TABLE IF NOT EXISTS budgets (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
       period      TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly')),
       limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
       UNIQUE (category_id, period)
     )`,

    `CREATE TABLE IF NOT EXISTS meta (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
  ],
];

export const DEFAULT_CATEGORIES: { name: string; icon: string; color: string; isIncome?: boolean }[] = [
  { name: 'Income', icon: 'arrow-down-circle', color: '#2E7D32', isIncome: true },
  { name: 'Food & Dining', icon: 'utensils', color: '#EF6C00' },
  { name: 'Groceries', icon: 'shopping-basket', color: '#7CB342' },
  { name: 'Transport', icon: 'car', color: '#1E88E5' },
  { name: 'Utilities', icon: 'zap', color: '#FDD835' },
  { name: 'Airtime & Data', icon: 'smartphone', color: '#8E24AA' },
  { name: 'Rent & Housing', icon: 'home', color: '#6D4C41' },
  { name: 'Entertainment', icon: 'film', color: '#D81B60' },
  { name: 'Health', icon: 'heart', color: '#E53935' },
  { name: 'Education', icon: 'book', color: '#3949AB' },
  { name: 'Savings & Loans', icon: 'piggy-bank', color: '#00897B' },
  { name: 'Cash Withdrawal', icon: 'banknote', color: '#546E7A' },
  { name: 'Fees & Charges', icon: 'receipt', color: '#757575' },
  { name: 'Transfers', icon: 'repeat', color: '#5C6BC0' },
  { name: 'Other', icon: 'tag', color: '#9E9E9E' },
];