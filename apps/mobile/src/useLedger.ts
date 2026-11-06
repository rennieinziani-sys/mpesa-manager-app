// Native (Android/iOS): transactions live in an on-device SQLite database.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyMigrations,
  ingestSms,
  listBudgets,
  listTransactions,
  recategorize,
  seed,
  setBudget as saveBudget,
  type Budget,
  type Db,
  type InboxMessage,
  type StoredTransaction,
} from '@mpesa/core';
import { openDb } from './sqliteDb';
import type { AddResult, Ledger } from './ledgerTypes';

export function useLedger(): Ledger {
  const dbRef = useRef<Db | null>(null);
  const [ready, setReady] = useState(false);
  const [txs, setTxs] = useState<StoredTransaction[]>([]);
  const [unparsedCount, setUnparsedCount] = useState(0);
  const [unparsed, setUnparsed] = useState<{ raw: string; reason: string }[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);

  const refresh = useCallback(async (db: Db) => {
    setTxs(await listTransactions(db, { limit: 5000 }));
    const [row] = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM unparsed_sms');
    setUnparsedCount(row?.n ?? 0);
    setUnparsed(await db.all<{ raw: string; reason: string }>('SELECT raw_sms AS raw, reason FROM unparsed_sms ORDER BY seen_at DESC LIMIT 100'));
    setBudgets((await listBudgets(db)).filter((b) => b.period === 'monthly').map((b) => ({ category: b.category, limitCents: b.limitCents })));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await openDb();
      await applyMigrations(db);
      await seed(db);
      if (cancelled) return;
      dbRef.current = db;
      await refresh(db);
      if (!cancelled) setReady(true);
    })().catch((e) => console.error('Failed to open database', e));
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const add = useCallback(
    async (messages: InboxMessage[]): Promise<AddResult> => {
      const db = dbRef.current;
      if (!db) throw new Error('Database not ready');
      const res = await ingestSms(db, messages);
      await refresh(db);
      return res;
    },
    [refresh],
  );

  const setBudget = useCallback(
    async (category: string, limitCents: number) => {
      const db = dbRef.current;
      if (!db) throw new Error('Database not ready');
      await saveBudget(db, category, limitCents);
      await refresh(db);
    },
    [refresh],
  );

  const setCategory = useCallback(
    async (id: string, category: string) => {
      const db = dbRef.current;
      if (!db) throw new Error('Database not ready');
      await recategorize(db, id, category);
      await refresh(db);
    },
    [refresh],
  );

  return { ready, txs, unparsedCount, unparsed, add, budgets, setBudget, setCategory };
}