import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { KnowledgeItem, Skill } from '@autosdd/shared';
import { api, createAgent, createTestApp, okData } from '../helpers';

const apps: FastifyInstance[] = [];

async function setup(): Promise<FastifyInstance> {
  const app = await createTestApp();
  apps.push(app);
  return app;
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

async function createSkill(app: FastifyInstance, name = '需求澄清'): Promise<Skill> {
  return okData<Skill>(
    await api(app, {
      method: 'POST',
      url: '/api/skills',
      payload: {
        name,
        category: '需求',
        description: '澄清需求',
        instructionsMd: '先问五个问题。',
      },
    }),
  );
}

async function createKnowledge(
  app: FastifyInstance,
  title = '项目宪法',
  type: 'RULE' | 'BUSINESS' | 'API' | 'LESSON' | 'MEMORY' = 'RULE',
): Promise<KnowledgeItem> {
  return okData<KnowledgeItem>(
    await api(app, {
      method: 'POST',
      url: '/api/knowledge',
      payload: {
        title,
        type,
        contentMd: '所有输出必须可审计。',
        tags: ['规范'],
      },
    }),
  );
}

describe('skills API', () => {
  test('creates, reads, lists, updates and deletes a skill', async () => {
    const app = await setup();
    const skill = await createSkill(app);

    const fetched = okData<Skill>(
      await api(app, { method: 'GET', url: `/api/skills/${skill.id}` }),
    );
    expect(fetched.name).toBe('需求澄清');
    expect(fetched.category).toBe('需求');

    const list = okData<Skill[]>(await api(app, { method: 'GET', url: '/api/skills' }));
    expect(list).toHaveLength(1);

    const filtered = okData<Skill[]>(
      await api(app, { method: 'GET', url: '/api/skills?q=需求&category=需求' }),
    );
    expect(filtered).toHaveLength(1);

    const empty = okData<Skill[]>(
      await api(app, { method: 'GET', url: '/api/skills?category=其他' }),
    );
    expect(empty).toHaveLength(0);

    const updated = okData<Skill>(
      await api(app, {
        method: 'PUT',
        url: `/api/skills/${skill.id}`,
        payload: {
          name: '需求澄清 v2',
          category: '需求',
          instructionsMd: '先问七个问题。',
        },
      }),
    );
    expect(updated.name).toBe('需求澄清 v2');

    const deleted = okData<{ deleted: boolean }>(
      await api(app, { method: 'DELETE', url: `/api/skills/${skill.id}` }),
    );
    expect(deleted.deleted).toBe(true);
    expect((await api(app, { method: 'GET', url: `/api/skills/${skill.id}` })).status).toBe(404);
  });

  test('refuses to delete a skill mounted on an agent', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const skill = await createSkill(app);
    await api(app, {
      method: 'PUT',
      url: `/api/agents/${agentId}/mounts`,
      payload: { skillIds: [skill.id], knowledgeIds: [] },
    });

    const result = await api(app, { method: 'DELETE', url: `/api/skills/${skill.id}` });

    expect(result.status).toBe(409);
    if (!result.body.ok) expect(result.body.error.code).toBe('SKILL_IN_USE');
  });

  test('returns 404 for unknown skills and validates input', async () => {
    const app = await setup();
    expect((await api(app, { method: 'GET', url: '/api/skills/nope' })).status).toBe(404);
    expect(
      (
        await api(app, {
          method: 'POST',
          url: '/api/skills',
          payload: { name: '空指令', instructionsMd: '' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('knowledge API', () => {
  test('creates, reads, filters, updates and deletes knowledge', async () => {
    const app = await setup();
    const rule = await createKnowledge(app);
    await createKnowledge(app, '业务术语表', 'BUSINESS');

    const fetched = okData<KnowledgeItem>(
      await api(app, { method: 'GET', url: `/api/knowledge/${rule.id}` }),
    );
    expect(fetched.type).toBe('RULE');
    expect(fetched.tags).toEqual(['规范']);

    const rules = okData<KnowledgeItem[]>(
      await api(app, { method: 'GET', url: '/api/knowledge?type=RULE' }),
    );
    expect(rules.map((item) => item.title)).toEqual(['项目宪法']);

    const business = okData<KnowledgeItem[]>(
      await api(app, { method: 'GET', url: '/api/knowledge?q=术语' }),
    );
    expect(business).toHaveLength(1);

    const updated = okData<KnowledgeItem>(
      await api(app, {
        method: 'PUT',
        url: `/api/knowledge/${rule.id}`,
        payload: {
          title: '项目宪法 v2',
          type: 'RULE',
          contentMd: '输出必须可审计，且可回滚。',
          tags: ['规范', '审计'],
        },
      }),
    );
    expect(updated.tags).toEqual(['规范', '审计']);

    const deleted = okData<{ deleted: boolean }>(
      await api(app, { method: 'DELETE', url: `/api/knowledge/${rule.id}` }),
    );
    expect(deleted.deleted).toBe(true);
  });

  test('refuses to delete knowledge mounted on an agent', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const knowledge = await createKnowledge(app);
    await api(app, {
      method: 'PUT',
      url: `/api/agents/${agentId}/mounts`,
      payload: { skillIds: [], knowledgeIds: [knowledge.id] },
    });

    const result = await api(app, {
      method: 'DELETE',
      url: `/api/knowledge/${knowledge.id}`,
    });

    expect(result.status).toBe(409);
    if (!result.body.ok) expect(result.body.error.code).toBe('KNOWLEDGE_IN_USE');
  });

  test('returns 404 for unknown knowledge and rejects invalid types', async () => {
    const app = await setup();
    expect(
      (await api(app, { method: 'GET', url: '/api/knowledge/nope' })).status,
    ).toBe(404);
    expect(
      (
        await api(app, {
          method: 'POST',
          url: '/api/knowledge',
          payload: { title: 'x', type: 'UNKNOWN', contentMd: 'y' },
        })
      ).status,
    ).toBe(400);
  });
});
