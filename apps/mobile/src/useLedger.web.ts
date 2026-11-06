// Web/PC: transactions are re-parsed from raw messages kept in the browser's localStorage.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { categorize, parseBatch, type Budget, type InboxMessage, type StoredTransaction } from '@mpesa/core';
import type { AddResult, Ledger } from './ledgerTypes';

const KEY = 'mpesa-manager:v1';

interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const storage = (): KV | null => {
  try {
    return (globalThis as { localStorage?: KV }).localStorage ?? null;
  } catch {
    return null;
  }
};

function load(): { messages: InboxMessage[]; budgets: Budget[] } {
  try {
    const raw = storage()?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        messages: Array.isArray(p.messages) ? p.messages : [],
        budgets: Array.isArray(p.budgets) ? p.budgets : [],
      };
    }
  } catch {
    // corrupt or unavailable storage: start empty
  }
  return { messages: [], budgets: [] };
}

export function useLedger(): Ledger {
  const [messages, setMessages] = useState<InboxMessage[]>(() => load().messages);
  const [budgets, setBudgets] = useState<Budget[]>(() => load().budgets);

  useEffect(() => {
    try {
      storage()?.setItem(KEY, JSON.stringify({ messages, budgets }));
    } catch {
      // storage full or blocked: keep working in memory
    }
  }, [messages, budgets]);

  const { txs, unparsedCount } = useMemo(() => {
    const batch = parseBatch(messages);
    const stored: StoredTransaction[] = batch.parsed
      .map((t) => ({ ...t, category: categorize(t).category }))
      .sort((a, b) => b.ts.localeCompare(a.ts));
    return { txs: stored, unparsedCount: batch.unparsed.length };
  }, [messages]);

  const add = useCallback(
    async (incoming: InboxMessage[]): Promise<AddResult> => {
      const before = parseBatch(messages);
      const after = parseBatch([...messages, ...incoming]);
      setMessages([...messages, ...incoming]);
      return {
        inserted: after.parsed.length - before.parsed.length,
        duplicates: after.duplicates - before.duplicates,
        unparsed: after.unparsed.length - before.unparsed.length,
      };
    },
    [messages],
  );

  const setBudget = useCallback(async (category: string, limitCents: number) => {
    setBudgets((prev) => [...prev.filter((b) => b.category !== category), { category, limitCents }]);
  }, []);

  return { ready: true, txs, unparsedCount, add, budgets, setBudget };
}