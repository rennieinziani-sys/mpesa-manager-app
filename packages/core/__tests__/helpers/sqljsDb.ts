import initSqlJs from 'sql.js';
import { Db } from '../../src/db/repository';

/** In-memory SQLite (pure JS/WASM) implementing the app's Db port, for tests. */
export async function createTestDb(): Promise<Db> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  raw.run('PRAGMA foreign_keys = ON');

  let depth = 0;
  const db: Db = {
    async exec(sql, params = []) {
      raw.run(sql, params as never[]);
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(params as never[]);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async transaction<T>(fn: () => Promise<T>) {
      if (depth > 0) return fn(); // flatten nested calls
      depth++;
      raw.run('BEGIN');
      try {
        const out = await fn();
        raw.run('COMMIT');
        return out;
      } catch (e) {
        raw.run('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
  return db;
}