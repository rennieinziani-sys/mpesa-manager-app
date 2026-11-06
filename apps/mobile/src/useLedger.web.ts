// Web/PC: transactions are re-parsed from raw messages kept in the browser's localStorage.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_RULES,
  categorize,
  parseBatch,
  type Budget,
  type InboxMessage,
  type MerchantRule,
  type StoredTransaction,
} from '@mpesa/core';
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

interface Saved {
  messages: InboxMessage[];
  budgets: Budget[];
  rules: MerchantRule[];
  overrides: Record<string, string>;
}

function load(): Saved {
  const empty: Saved = { messages: [], budgets: [], rules: [], overrides: {} };
  try {
    const raw = storage()?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        messages: Array.isArray(p.messages) ? p.messages : [],
        budgets: Array.isArray(p.budgets) ? p.budgets : [],
        rules: Array.isArray(p.rules) ? p.rules : [],
        overrides: p.overrides && typeof p.overrides === 'object' ? p.overrides : {},
      };
    }
  } catch {
    // corrupt or unavailable storage: start empty
  }
  return empty;
}

export function useLedger(): Ledger {
  const [init] = useState(load);
  const [messages, setMessages] = useState<InboxMessage[]>(init.messages);
  const [budgets, setBudgets] = useState<Budget[]>(init.budgets);
  const [rules, setRules] = useState<MerchantRule[]>(init.rules);
  const [overrides, setOverrides] = useState<Record<string, string>>(init.overrides);

  useEffect(() => {
    try {
      storage()?.setItem(KEY, JSON.stringify({ messages, budgets, rules, overrides }));
    } catch {
      // storage full or blocked: keep working in memory
    }
  }, [messages, budgets, rules, overrides]);

  const { txs, unparsedCount, unparsed } = useMemo(() => {
    const batch = parseBatch(messages);
    const allRules = [...BUILTIN_RULES, ...rules];
    const stored: StoredTransaction[] = batch.parsed
      .map((t) => ({ ...t, category: overrides[t.id] ?? categorize(t, allRules).category }))
      .sort((a, b) => b.ts.localeCompare(a.ts));
    return {
      txs: stored,
      unparsedCount: batch.unparsed.length,
      unparsed: batch.unparsed.map((u) => ({ raw: u.raw, reason: String(u.reason) })).reverse(),
    };
  }, [messages, rules, overrides]);

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

  const setCategory = useCallback(
    async (id: string, category: string) => {
      setOverrides((prev) => ({ ...prev, [id]: category }));
      const tx = txs.find((t) => t.id === id);
      const payee = tx?.counterparty?.toUpperCase();
      if (payee) {
        setRules((prev) => [
          ...prev.filter((r) => r.pattern !== payee),
          { pattern: payee, category, priority: 100, origin: 'user' },
        ]);
      }
    },
    [txs],
  );

  return { ready: true, txs, unparsedCount, unparsed, add, budgets, setBudget, setCategory };
}