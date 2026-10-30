import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  Agent,
  AgentDetail,
  ContextPreview,
  KnowledgeItem,
  Skill,
} from '@autosdd/shared';
import { DEFAULT_MODEL_ID } from '@autosdd/shared';
import { api, createAgent, createTestApp, createWorkflow, okData } from '../helpers';

const apps: FastifyInstance[] = [];

async function setup(): Promise<FastifyInstance> {
  const app = await createTestApp();
  apps.push(app);
  return app;
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

describe('agents API', () => {
  test('creates, lists and updates an agent', async () => {
    const app = await setup();
    const created = await api<Agent>(app, {
      method: 'POST',
      url: '/api/agents',
      payload: { name: '架构师', role: '系统架构设计' },
    });

    expect(created.status).toBe(201);
    const agent = okData(created);
    expect(agent.name).toBe('架构师');
    expect(agent.status).toBe('ACTIVE');
    expect(agent.modelId).toBe(DEFAULT_MODEL_ID);
    expect(agent.modelName).toBe('Mock 模拟模型');
    expect(agent.modelProvider).toBe('mock');

    const updated = okData<Agent>(
      await api(app, {
        method: 'PUT',
        url: `/api/agents/${agent.id}`,
        payload: { name: '首席架构师', role: '系统架构设计' },
      }),
    );
    expect(updated.name).toBe('首席架构师');

    const list = okData<Agent[]>(await api(app, { method: 'GET', url: '/api/agents' }));
    expect(list).toHaveLength(1);
  });

  test('validates required fields', async () => {
    const app = await setup();
    const result = await api(app, {
      method: 'POST',
      url: '/api/agents',
      payload: { name: '', role: 'x' },
    });

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
  });

  test('mounts skills and knowledge and exposes them in detail and preview', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const skill = okData<Skill>(
      await api(app, {
        method: 'POST',
        url: '/api/skills',
        payload: {
          name: '需求澄清',
          instructionsMd: '先问五个问题。',
        },
      }),
    );
    const knowledge = okData<KnowledgeItem>(
      await api(app, {
        method: 'POST',
        url: '/api/knowledge',
        payload: {
          title: '项目宪法',
          type: 'RULE',
          contentMd: '所有输出必须可审计。',
          tags: ['规范'],
        },
      }),
    );

    const detail = okData<AgentDetail>(
      await api(app, {
        method: 'PUT',
        url: `/api/agents/${agentId}/mounts`,
        payload: { skillIds: [skill.id], knowledgeIds: [knowledge.id] },
      }),
    );

    expect(detail.skills.map((item) => item.id)).toEqual([skill.id]);
    expect(detail.knowledgeItems.map((item) => item.id)).toEqual([knowledge.id]);
    expect(detail.skillCount).toBe(1);
    expect(detail.knowledgeCount).toBe(1);

    const preview = okData<ContextPreview>(
      await api(app, { method: 'GET', url: `/api/agents/${agentId}/context-preview` }),
    );
    expect(preview.systemPrompt).toContain('需求澄清');
    expect(preview.systemPrompt).toContain('项目宪法');
    expect(preview.stats.skillCount).toBe(1);
  });

  test('rejects mounts that reference missing items', async () => {
    const app = await setup();
    const agentId = await createAgent(app);

    const result = await api(app, {
      method: 'PUT',
      url: `/api/agents/${agentId}/mounts`,
      payload: { skillIds: ['missing'], knowledgeIds: ['missing-too'] },
    });

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    if (!result.body.ok) expect(result.body.error.code).toBe('MOUNT_NOT_FOUND');
  });

  test('refuses to delete an agent referenced by a workflow', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    await createWorkflow(app, agentId, [{ stepKey: 'a', name: '步骤一', agentId }]);

    const result = await api(app, {
      method: 'DELETE',
      url: `/api/agents/${agentId}`,
    });

    expect(result.status).toBe(409);
    if (!result.body.ok) expect(result.body.error.code).toBe('AGENT_IN_USE');
  });

  test('deletes an unused agent', async () => {
    const app = await setup();
    const agentId = await createAgent(app);

    const result = await api(app, {
      method: 'DELETE',
      url: `/api/agents/${agentId}`,
    });

    expect(result.status).toBe(200);
    const list = okData<Agent[]>(await api(app, { method: 'GET', url: '/api/agents' }));
    expect(list).toHaveLength(0);
  });

  test('returns 404 for an unknown agent', async () => {
    const app = await setup();
    const result = await api(app, {
      method: 'GET',
      url: '/api/agents/does-not-exist',
    });

    expect(result.status).toBe(404);
  });

  test('binds an explicitly selected model and keeps it when updates omit the field', async () => {
    const app = await setup();
    const created = okData<Agent>(
      await api(app, {
        method: 'POST',
        url: '/api/agents',
        payload: { name: '架构师', role: '架构', modelId: 'mdl_claude_sonnet' },
      }),
    );
    expect(created.modelId).toBe('mdl_claude_sonnet');
    expect(created.modelProvider).toBe('anthropic');

    const updated = okData<Agent>(
      await api(app, {
        method: 'PUT',
        url: `/api/agents/${created.id}`,
        payload: { name: '首席架构师', role: '架构' },
      }),
    );
    expect(updated.modelId).toBe('mdl_claude_sonnet');

    const switched = okData<Agent>(
      await api(app, {
        method: 'PUT',
        url: `/api/agents/${created.id}`,
        payload: { name: '首席架构师', role: '架构', modelId: DEFAULT_MODEL_ID },
      }),
    );
    expect(switched.modelId).toBe(DEFAULT_MODEL_ID);
  });

  test('rejects unknown and disabled models', async () => {
    const app = await setup();
    const unknown = await api(app, {
      method: 'POST',
      url: '/api/agents',
      payload: { name: '架构师', role: '架构', modelId: 'mdl_missing' },
    });
    expect(unknown.status).toBe(400);
    if (!unknown.body.ok) expect(unknown.body.error.code).toBe('MODEL_NOT_FOUND');

    const disabled = await api(app, {
      method: 'PUT',
      url: '/api/models/mdl_claude_sonnet',
      payload: {
        name: 'Claude Sonnet 5',
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        status: 'DISABLED',
      },
    });
    expect(disabled.status).toBe(200);

    const result = await api(app, {
      method: 'POST',
      url: '/api/agents',
      payload: { name: '架构师', role: '架构', modelId: 'mdl_claude_sonnet' },
    });
    expect(result.status).toBe(400);
    if (!result.body.ok) expect(result.body.error.code).toBe('MODEL_DISABLED');
  });

  test('refuses to delete the default model or a model referenced by an agent', async () => {
    const app = await setup();
    const defaultDelete = await api(app, {
      method: 'DELETE',
      url: `/api/models/${DEFAULT_MODEL_ID}`,
    });
    expect(defaultDelete.status).toBe(409);
    if (!defaultDelete.body.ok) expect(defaultDelete.body.error.code).toBe('MODEL_IS_DEFAULT');

    await api(app, {
      method: 'POST',
      url: '/api/agents',
      payload: { name: '架构师', role: '架构', modelId: 'mdl_claude_sonnet' },
    });
    const inUse = await api(app, {
      method: 'DELETE',
      url: '/api/models/mdl_claude_sonnet',
    });
    expect(inUse.status).toBe(409);
    if (!inUse.body.ok) expect(inUse.body.error.code).toBe('MODEL_IN_USE');
  });
});
