import { loadConfig } from '../config';
import { openDatabase } from './database';
import { migrate } from './migrate';
import { clearAll, seed, seedIfEmpty } from './seed';

function main(): void {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    const force = process.argv.includes('--force');
    if (force) {
      clearAll(db);
      seed(db);
      process.stdout.write(`已重建种子数据：${config.databasePath}\n`);
      return;
    }
    const seeded = seedIfEmpty(db);
    if (!seeded) {
      process.stdout.write('数据库已有数据，跳过种子数据。使用 --force 可重建。\n');
      return;
    }
    process.stdout.write(`种子数据已写入：${config.databasePath}\n`);
  } finally {
    db.close();
  }
}

main();
