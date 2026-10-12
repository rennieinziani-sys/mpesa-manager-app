import * as SQLite from 'expo-sqlite';
import type { Db } from '@mpesa/core';

/** Adapts expo-sqlite to the platform-neutral Db port used by @mpesa/core. */
export async function openDb(name = 'mpesa.db'): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync(name);
  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  let depth = 0;
  const db: Db = {
    async exec(sql, params = []) {
      if (params.length === 0) await raw.execAsync(sql);
      else await raw.runAsync(sql, params as SQLite.SQLiteBindValue[]);
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return raw.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
    },
    async transaction<T>(fn: () => Promise<T>) {
      if (depth > 0) return fn(); // flatten nested calls
      depth++;
      try {
        let out!: T;
        await raw.withTransactionAsync(async () => {
          out = await fn();
        });
        return out;
      } finally {
        depth--;
      }
    },
  };
  return db;
}