import type { ModelProvider, ModelStatus } from '@autosdd/shared';
import type { Db } from '../../db/database';
import { nowIso } from '../../db/clock';
import { newId } from '../../db/ids';

/**
 * Server-only view of a model. It carries the stored API key; never send this
 * shape over HTTP or write it to logs. The public `Model` type lives in
 * `@autosdd/shared` and is produced by `ModelService`.
 */
export interface ModelRuntime {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  apiKey: string | null;
  maxTokens: number;
  isDefault: boolean;
  status: ModelStatus;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelWrite {
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  apiKey: string | null;
  maxTokens: number;
  status: ModelStatus;
}

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  base_url: string;
  api_key: string | null;
  max_tokens: number;
  is_default: number;
  status: string;
  agent_count: number;
  created_at: string;
  updated_at: string;
}

const MODEL_SELECT = `
  SELECT m.*,
    (SELECT COUNT(*) FROM agents a WHERE a.model_id = m.id) AS agent_count
  FROM models m
`;

export function mapModelRow(row: ModelRow): ModelRuntime {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ModelProvider,
    modelId: row.model_id,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    maxTokens: row.max_tokens,
    isDefault: row.is_default === 1,
    status: row.status as ModelStatus,
    agentCount: row.agent_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ModelRepository {
  constructor(private readonly db: Db) {}

  list(q?: string, provider?: string): ModelRuntime[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q) {
      clauses.push('(m.name LIKE ? OR m.model_id LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (provider) {
      clauses.push('m.provider = ?');
      params.push(provider);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`${MODEL_SELECT} ${where} ORDER BY m.is_default DESC, m.created_at ASC`)
      .all(...params) as ModelRow[];
    return rows.map(mapModelRow);
  }

  findById(id: string): ModelRuntime | undefined {
    const row = this.db.prepare(`${MODEL_SELECT} WHERE m.id = ?`).get(id) as ModelRow | undefined;
    return row ? mapModelRow(row) : undefined;
  }

  findDefault(): ModelRuntime | undefined {
    const row = this.db
      .prepare(`${MODEL_SELECT} WHERE m.is_default = 1`)
      .get() as ModelRow | undefined;
    return row ? mapModelRow(row) : undefined;
  }

  create(input: ModelWrite, id = newId()): ModelRuntime {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO models
           (id, name, provider, model_id, base_url, api_key, max_tokens, is_default, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.provider,
        input.modelId,
        input.baseUrl,
        input.apiKey,
        input.maxTokens,
        input.status,
        now,
        now,
      );
    return this.findById(id)!;
  }

  update(id: string, input: ModelWrite): ModelRuntime | undefined {
    const result = this.db
      .prepare(
        `UPDATE models
         SET name = ?, provider = ?, model_id = ?, base_url = ?, api_key = ?,
             max_tokens = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.provider,
        input.modelId,
        input.baseUrl,
        input.apiKey,
        input.maxTokens,
        input.status,
        nowIso(),
        id,
      );
    return result.changes === 0 ? undefined : this.findById(id);
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM models WHERE id = ?').run(id).changes > 0;
  }

  setDefault(id: string): void {
    const now = nowIso();
    const run = this.db.transaction(() => {
      this.db.prepare('UPDATE models SET is_default = 0 WHERE is_default = 1').run();
      this.db.prepare('UPDATE models SET is_default = 1, updated_at = ? WHERE id = ?').run(now, id);
    });
    run();
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM models').get() as { c: number }).c;
  }
}
