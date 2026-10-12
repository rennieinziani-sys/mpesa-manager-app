// Web preview: in-memory only (expo-sqlite on web is alpha). Real storage is native.
import { useCallback, useMemo, useState } from 'react';
import { categorize, parseBatch, type InboxMessage, type StoredTransaction } from '@mpesa/core';
import type { AddResult, Ledger } from './ledgerTypes';

export function useLedger(): Ledger {
  const [messages, setMessages] = useState<InboxMessage[]>([]);

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

  return { ready: true, txs, unparsedCount, add };
}