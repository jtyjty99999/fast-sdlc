import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface PreparedStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * A thin synchronous database facade over Node's built-in `node:sqlite`.
 * Keeps repository call sites identical to the better-sqlite3 API while
 * avoiding a native addon dependency.
 */
export interface Db {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  close(): void;
  transaction<T>(fn: () => T): () => T;
}

class StatementAdapter implements PreparedStatement {
  constructor(private readonly statement: StatementSync) {}

  run(...params: unknown[]): RunResult {
    const result = this.statement.run(...(params as never[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  get(...params: unknown[]): unknown {
    return this.statement.get(...(params as never[]));
  }

  all(...params: unknown[]): unknown[] {
    return this.statement.all(...(params as never[])) as unknown[];
  }
}

class SqliteDatabase implements Db {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): PreparedStatement {
    return new StatementAdapter(this.database.prepare(sql));
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  close(): void {
    this.database.close();
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        this.database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.database.exec('ROLLBACK');
        } catch {
          // Rollback can fail if the transaction was already closed by SQLite.
        }
        throw error;
      }
    };
  }
}

export function openDatabase(databasePath: string): Db {
  let target = databasePath;
  let isMemory = databasePath === ':memory:';
  if (databasePath !== ':memory:' && !databasePath.startsWith('file:')) {
    target = resolve(databasePath);
    mkdirSync(dirname(target), { recursive: true });
  }
  if (databasePath.startsWith('file:')) {
    isMemory = databasePath.includes('mode=memory');
    target = databasePath;
  }

  const database = new DatabaseSync(target);
  if (!isMemory) database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  return new SqliteDatabase(database);
}
