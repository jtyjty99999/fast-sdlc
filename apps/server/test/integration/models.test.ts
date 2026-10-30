import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Model, ModelTestResult } from '@autosdd/shared';
import { DEFAULT_MODEL_ID } from '@autosdd/shared';
import { api, createTestApp, createAgent, okData } from '../helpers';

const apps: FastifyInstance[] = [];

async function setup(): Promise<FastifyInstance> {
  const app = await createTestApp();
  apps.push(app);
  return app;
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

const CLAUDE = 'mdl_claude_sonnet';

function openaiModel(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Qwen 测试模型',
    provider: 'openai',
    modelId: 'qwen-plus',
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-secret-key',
    maxTokens: 2048,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('models API', () => {
  test('lists the built-in models and marks the mock model as default', async () => {
    const app = await setup();
    const models = okData<Model[]>(await api(app, { method: 'GET', url: '/api/models' }));

    expect(models).toHaveLength(2);
    const mock = models.find((model) => model.id === DEFAULT_MODEL_ID);
    expect(mock).toMatchObject({
      name: 'Mock 模拟模型',
      provider: 'mock',
      modelId: 'mock',
      keySource: 'none',
      isDefault: true,
      status: 'ACTIVE',
      agentCount: 0,
    });
    expect(models.find((model) => model.id === CLAUDE)?.isDefault).toBe(false);
    expect(JSON.stringify(models)).not.toContain('apiKey');
  });

  test('creates a model and never exposes the API key', async () => {
    const app = await setup();
    const created = okData<Model>(
      await api(app, { method: 'POST', url: '/api/models', payload: openaiModel() }),
    );

    expect(created.keySource).toBe('stored');
    expect(created.baseUrl).toBe('https://example.com/v1');

    const raw = await app.inject({ method: 'GET', url: '/api/models' });
    expect(raw.body).not.toContain('sk-secret-key');
  });

  test('keeps a stored key when the update omits it and clears it with an empty string', async () => {
    const app = await setup();
    const created = okData<Model>(
      await api(app, { method: 'POST', url: '/api/models', payload: openaiModel() }),
    );

    const kept = okData<Model>(
      await api(app, {
        method: 'PUT',
        url: `/api/models/${created.id}`,
        payload: openaiModel({ name: 'Qwen 改名', maxTokens: 1024 }),
      }),
    );
    expect(kept.name).toBe('Qwen 改名');
    expect(kept.maxTokens).toBe(1024);
    expect(kept.keySource).toBe('stored');

    const cleared = okData<Model>(
      await api(app, {
        method: 'PUT',
        url: `/api/models/${created.id}`,
        payload: openaiModel({ apiKey: '' }),
      }),
    );
    expect(cleared.keySource).toBe('none');
  });

  test('switches the default model and protects the current default', async () => {
    const app = await setup();
    const promoted = okData<Model>(
      await api(app, { method: 'POST', url: `/api/models/${CLAUDE}/default` }),
    );
    expect(promoted.isDefault).toBe(true);

    const models = okData<Model[]>(await api(app, { method: 'GET', url: '/api/models' }));
    expect(models.find((model) => model.id === DEFAULT_MODEL_ID)?.isDefault).toBe(false);
    expect(models.find((model) => model.id === CLAUDE)?.isDefault).toBe(true);

    const disable = await api(app, {
      method: 'PUT',
      url: `/api/models/${CLAUDE}`,
      payload: {
        name: 'Claude Sonnet 5',
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        status: 'DISABLED',
      },
    });
    expect(disable.status).toBe(409);
    if (!disable.body.ok) expect(disable.body.error.code).toBe('MODEL_IS_DEFAULT');

    const restored = okData<Model>(
      await api(app, { method: 'POST', url: `/api/models/${DEFAULT_MODEL_ID}/default` }),
    );
    expect(restored.isDefault).toBe(true);
  });

  test('refuses to disable a model still referenced by an agent', async () => {
    const app = await setup();
    await createAgent(app, '架构师', '架构');
    const agent = okData<{ id: string }>(
      await api(app, {
        method: 'POST',
        url: '/api/agents',
        payload: { name: '架构师二', role: '架构', modelId: CLAUDE },
      }),
    );
    expect(agent.id).toBeDefined();

    const result = await api(app, {
      method: 'PUT',
      url: `/api/models/${CLAUDE}`,
      payload: {
        name: 'Claude Sonnet 5',
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        status: 'DISABLED',
      },
    });
    expect(result.status).toBe(409);
    if (!result.body.ok) expect(result.body.error.code).toBe('MODEL_IN_USE');
  });

  test('deletes an unused model and returns 404 afterwards', async () => {
    const app = await setup();
    const created = okData<Model>(
      await api(app, { method: 'POST', url: '/api/models', payload: openaiModel() }),
    );

    const deleted = await api(app, { method: 'DELETE', url: `/api/models/${created.id}` });
    expect(deleted.status).toBe(200);

    const missing = await api(app, { method: 'GET', url: `/api/models/${created.id}` });
    expect(missing.status).toBe(404);
  });

  test('validates provider-specific base URLs', async () => {
    const app = await setup();
    const result = await api(app, {
      method: 'POST',
      url: '/api/models',
      payload: openaiModel({ baseUrl: '' }),
    });
    expect(result.status).toBe(400);

    const credentials = await api(app, {
      method: 'POST',
      url: '/api/models',
      payload: openaiModel({ baseUrl: 'https://user:pass@example.com/v1' }),
    });
    expect(credentials.status).toBe(400);
  });

  test('tests the mock model without network access', async () => {
    const app = await setup();
    const result = okData<ModelTestResult>(
      await api(app, { method: 'POST', url: `/api/models/${DEFAULT_MODEL_ID}/test` }),
    );

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('mock');
    expect(result.latencyMs).toBe(0);
    expect(result.sample).toContain('Mock');
  });

  test('reports missing credentials when testing an anthropic model without a key', async () => {
    const app = await setup();
    const result = await api(app, { method: 'POST', url: `/api/models/${CLAUDE}/test` });

    expect(result.status).toBe(400);
    if (!result.body.ok) expect(result.body.error.code).toBe('LLM_NOT_CONFIGURED');
  });

  test('filters by provider and searches by name', async () => {
    const app = await setup();
    await api(app, { method: 'POST', url: '/api/models', payload: openaiModel() });

    const filtered = okData<Model[]>(
      await api(app, { method: 'GET', url: '/api/models?provider=openai' }),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.provider).toBe('openai');

    const searched = okData<Model[]>(
      await api(app, { method: 'GET', url: '/api/models?q=Qwen' }),
    );
    expect(searched).toHaveLength(1);
  });

  test('returns 404 for unknown models', async () => {
    const app = await setup();
    expect((await api(app, { method: 'GET', url: '/api/models/missing' })).status).toBe(404);
    expect((await api(app, { method: 'DELETE', url: '/api/models/missing' })).status).toBe(404);
    expect((await api(app, { method: 'POST', url: '/api/models/missing/test' })).status).toBe(404);
  });
});
