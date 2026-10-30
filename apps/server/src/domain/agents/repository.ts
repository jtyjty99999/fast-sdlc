import type {
  Agent,
  AgentDetail,
  AgentInput,
  AgentMountInput,
  AgentStatus,
  KnowledgeItem,
  KnowledgeType,
  Skill,
} from '@autosdd/shared';
import type { Db } from '../../db/database';
import { nowIso } from '../../db/clock';
import { newId } from '../../db/ids';

interface AgentRow {
  id: string;
  name: string;
  role: string;
  description: string;
  system_prompt: string;
  model: string;
  status: string;
  skill_count: number;
  knowledge_count: number;
  created_at: string;
  updated_at: string;
}

interface SkillRow {
  id: string;
  name: string;
  category: string;
  description: string;
  instructions_md: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRow {
  id: string;
  title: string;
  type: string;
  content_md: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

const AGENT_SELECT = `
  SELECT a.*,
    (SELECT COUNT(*) FROM agent_skills x WHERE x.agent_id = a.id) AS skill_count,
    (SELECT COUNT(*) FROM agent_knowledge x WHERE x.agent_id = a.id) AS knowledge_count
  FROM agents a
`;

export function mapSkillRow(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    instructionsMd: row.instructions_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapKnowledgeRow(row: KnowledgeRow): KnowledgeItem {
  return {
    id: row.id,
    title: row.title,
    type: row.type as KnowledgeType,
    contentMd: row.content_md,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAgentRow(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    systemPrompt: row.system_prompt,
    model: row.model,
    status: row.status as AgentStatus,
    skillCount: row.skill_count,
    knowledgeCount: row.knowledge_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentRepository {
  constructor(private readonly db: Db) {}

  list(q?: string): Agent[] {
    const rows = q
      ? (this.db
          .prepare(`${AGENT_SELECT} WHERE a.name LIKE ? OR a.role LIKE ? OR a.description LIKE ? ORDER BY a.created_at ASC`)
          .all(`%${q}%`, `%${q}%`, `%${q}%`) as AgentRow[])
      : (this.db.prepare(`${AGENT_SELECT} ORDER BY a.created_at ASC`).all() as AgentRow[]);
    return rows.map(mapAgentRow);
  }

  findById(id: string): Agent | undefined {
    const row = this.db.prepare(`${AGENT_SELECT} WHERE a.id = ?`).get(id) as AgentRow | undefined;
    return row ? mapAgentRow(row) : undefined;
  }

  findDetail(id: string): AgentDetail | undefined {
    const agent = this.findById(id);
    if (!agent) return undefined;
    return { ...agent, skills: this.listSkills(id), knowledgeItems: this.listKnowledge(id) };
  }

  listSkills(agentId: string): Skill[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM skills s
         JOIN agent_skills x ON x.skill_id = s.id
         WHERE x.agent_id = ?
         ORDER BY x.sort_order ASC, s.name ASC`,
      )
      .all(agentId) as SkillRow[];
    return rows.map(mapSkillRow);
  }

  listKnowledge(agentId: string): KnowledgeItem[] {
    const rows = this.db
      .prepare(
        `SELECT k.* FROM knowledge_items k
         JOIN agent_knowledge x ON x.knowledge_id = k.id
         WHERE x.agent_id = ?
         ORDER BY x.sort_order ASC, k.title ASC`,
      )
      .all(agentId) as KnowledgeRow[];
    return rows.map(mapKnowledgeRow);
  }

  create(input: AgentInput, id = newId()): Agent {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO agents (id, name, role, description, system_prompt, model, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.role,
        input.description ?? '',
        input.systemPrompt ?? '',
        input.model ?? 'claude-sonnet-5',
        input.status ?? 'ACTIVE',
        now,
        now,
      );
    return this.findById(id)!;
  }

  update(id: string, input: AgentInput): Agent | undefined {
    const result = this.db
      .prepare(
        `UPDATE agents
         SET name = ?, role = ?, description = ?, system_prompt = ?, model = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.role,
        input.description ?? '',
        input.systemPrompt ?? '',
        input.model ?? 'claude-sonnet-5',
        input.status ?? 'ACTIVE',
        nowIso(),
        id,
      );
    return result.changes === 0 ? undefined : this.findById(id);
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM agents WHERE id = ?').run(id).changes > 0;
  }

  setMounts(agentId: string, input: AgentMountInput): void {
    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(agentId);
      this.db.prepare('DELETE FROM agent_knowledge WHERE agent_id = ?').run(agentId);
      const skillStmt = this.db.prepare(
        'INSERT INTO agent_skills (agent_id, skill_id, sort_order) VALUES (?, ?, ?)',
      );
      input.skillIds.forEach((skillId, index) => skillStmt.run(agentId, skillId, index));
      const knowledgeStmt = this.db.prepare(
        'INSERT INTO agent_knowledge (agent_id, knowledge_id, sort_order) VALUES (?, ?, ?)',
      );
      input.knowledgeIds.forEach((knowledgeId, index) =>
        knowledgeStmt.run(agentId, knowledgeId, index),
      );
    });
    run();
  }

  countWorkflowUsage(agentId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM workflow_steps WHERE agent_id = ?')
      .get(agentId) as { c: number };
    return row.c;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM agents').get() as { c: number }).c;
  }
}
