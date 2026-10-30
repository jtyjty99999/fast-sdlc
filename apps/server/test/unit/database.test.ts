import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../../src/db/database';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function track(db: Db): Db {
  cleanups.push(() => db.close());
  return db;
}

describe('openDatabase', () => {
  test('creates an in-memory database with the expected pragmas', () => {
    const db = track(openDatabase(':memory:'));

    const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    const busyTimeout = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };

    expect(foreignKeys.foreign_keys).toBe(1);
    expect(busyTimeout.timeout).toBe(5000);
  });

  test('creates missing parent directories for file databases', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autosdd-db-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'nested', 'deep', 'test.db');

    const db = track(openDatabase(path));
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO sample (name) VALUES (?)').run('x');

    const row = db.prepare('SELECT name FROM sample').get() as { name: string };
    expect(row.name).toBe('x');
  });

  test('commits a successful transaction and returns its value', () => {
    const db = track(openDatabase(':memory:'));
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)');
    const insert = db.prepare('INSERT INTO sample (name) VALUES (?)');

    const result = db.transaction(() => {
      insert.run('a');
      insert.run('b');
      return 'done';
    })();

    expect(result).toBe('done');
    const count = db.prepare('SELECT COUNT(*) AS c FROM sample').get() as { c: number };
    expect(count.c).toBe(2);
  });

  test('rolls back a failing transaction and rethrows', () => {
    const db = track(openDatabase(':memory:'));
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)');
    const insert = db.prepare('INSERT INTO sample (name) VALUES (?)');

    const failing = db.transaction(() => {
      insert.run('a');
      throw new Error('boom');
    });

    expect(() => failing()).toThrow('boom');
    const count = db.prepare('SELECT COUNT(*) AS c FROM sample').get() as { c: number };
    expect(count.c).toBe(0);
  });

  test('normalizes driver row counts and row ids to numbers', () => {
    const db = track(openDatabase(':memory:'));
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)');

    const result = db.prepare('INSERT INTO sample (name) VALUES (?)').run('a');

    expect(result.changes).toBe(1);
    expect(typeof result.lastInsertRowid).toBe('number');
  });
});
