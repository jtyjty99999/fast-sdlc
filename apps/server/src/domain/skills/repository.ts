import type { Skill, SkillInput } from '@autosdd/shared';
import type { Db } from '../../db/database';
import { nowIso } from '../../db/clock';
import { newId } from '../../db/ids';
import { mapSkillRow } from '../agents/repository';

interface SkillRow {
  id: string;
  name: string;
  category: string;
  description: string;
  instructions_md: string;
  created_at: string;
  updated_at: string;
}

export class SkillRepository {
  constructor(private readonly db: Db) {}

  list(q?: string, category?: string): Skill[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q) {
      clauses.push('(name LIKE ? OR description LIKE ? OR instructions_md LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (category) {
      clauses.push('category = ?');
      params.push(category);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM skills ${where} ORDER BY category ASC, name ASC`)
      .all(...params) as SkillRow[];
    return rows.map(mapSkillRow);
  }

  findById(id: string): Skill | undefined {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined;
    return row ? mapSkillRow(row) : undefined;
  }

  findManyByIds(ids: string[]): Skill[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM skills WHERE id IN (${placeholders})`)
      .all(...ids) as SkillRow[];
    return rows.map(mapSkillRow);
  }

  create(input: SkillInput, id = newId()): Skill {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO skills (id, name, category, description, instructions_md, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.category ?? '通用', input.description ?? '', input.instructionsMd, now, now);
    return this.findById(id)!;
  }

  update(id: string, input: SkillInput): Skill | undefined {
    const result = this.db
      .prepare(
        `UPDATE skills
         SET name = ?, category = ?, description = ?, instructions_md = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.name, input.category ?? '通用', input.description ?? '', input.instructionsMd, nowIso(), id);
    return result.changes === 0 ? undefined : this.findById(id);
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes > 0;
  }

  countAgentUsage(skillId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM agent_skills WHERE skill_id = ?')
      .get(skillId) as { c: number };
    return row.c;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM skills').get() as { c: number }).c;
  }
}
