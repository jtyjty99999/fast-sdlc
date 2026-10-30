import type { KnowledgeItem, KnowledgeInput, KnowledgeType } from '@autosdd/shared';
import type { Db } from '../../db/database';
import { nowIso } from '../../db/clock';
import { newId } from '../../db/ids';
import { mapKnowledgeRow } from '../agents/repository';

interface KnowledgeRow {
  id: string;
  title: string;
  type: string;
  content_md: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

export class KnowledgeRepository {
  constructor(private readonly db: Db) {}

  list(q?: string, type?: KnowledgeType): KnowledgeItem[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q) {
      clauses.push('(title LIKE ? OR content_md LIKE ? OR tags_json LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (type) {
      clauses.push('type = ?');
      params.push(type);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_items ${where} ORDER BY type ASC, title ASC`)
      .all(...params) as KnowledgeRow[];
    return rows.map(mapKnowledgeRow);
  }

  findById(id: string): KnowledgeItem | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(id) as
      | KnowledgeRow
      | undefined;
    return row ? mapKnowledgeRow(row) : undefined;
  }

  create(input: KnowledgeInput, id = newId()): KnowledgeItem {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO knowledge_items (id, title, type, content_md, tags_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.title, input.type ?? 'RULE', input.contentMd, JSON.stringify(input.tags ?? []), now, now);
    return this.findById(id)!;
  }

  update(id: string, input: KnowledgeInput): KnowledgeItem | undefined {
    const result = this.db
      .prepare(
        `UPDATE knowledge_items
         SET title = ?, type = ?, content_md = ?, tags_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.title, input.type ?? 'RULE', input.contentMd, JSON.stringify(input.tags ?? []), nowIso(), id);
    return result.changes === 0 ? undefined : this.findById(id);
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM knowledge_items WHERE id = ?').run(id).changes > 0;
  }

  countAgentUsage(knowledgeId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM agent_knowledge WHERE knowledge_id = ?')
      .get(knowledgeId) as { c: number };
    return row.c;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM knowledge_items').get() as { c: number }).c;
  }
}
