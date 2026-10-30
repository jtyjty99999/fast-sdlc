import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  MatchCandidate,
  Workflow,
  WorkflowSummary,
  WorkflowValidationResult,
} from '@autosdd/shared';
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

describe('workflows API', () => {
  test('creates a workflow and auto-assigns step keys', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const workflowId = await createWorkflow(app, agentId, [
      { stepKey: 'req', name: '需求分析', agentId },
      { stepKey: 'dev', name: '编码实现', agentId, dependsOn: ['req'] },
    ]);

    const workflow = okData<Workflow>(
      await api(app, { method: 'GET', url: `/api/workflows/${workflowId}` }),
    );

    expect(workflow.steps).toHaveLength(2);
    expect(workflow.steps[0]?.stepKey).toBe('req');
    expect(workflow.steps[1]?.dependsOn).toEqual(['req']);
    expect(workflow.status).toBe('ENABLED');
  });

  test('rejects a workflow with a dependency cycle', async () => {
    const app = await setup();
    const agentId = await createAgent(app);

    const result = await api(app, {
      method: 'POST',
      url: '/api/workflows',
      payload: {
        name: '环',
        scenario: '测试',
        status: 'ENABLED',
        steps: [
          { stepKey: 'a', name: 'A', agentId, dependsOn: ['b'] },
          { stepKey: 'b', name: 'B', agentId, dependsOn: ['a'] },
        ],
      },
    });

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe('WORKFLOW_INVALID');
    }
  });

  test('rejects a workflow that references a missing agent', async () => {
    const app = await setup();

    const result = await api(app, {
      method: 'POST',
      url: '/api/workflows',
      payload: {
        name: '无效',
        scenario: '测试',
        steps: [{ stepKey: 'a', name: 'A', agentId: 'ghost' }],
      },
    });

    expect(result.status).toBe(400);
  });

  test('validates a saved workflow', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const workflowId = await createWorkflow(app, agentId, [
      {
        stepKey: 'a',
        name: 'A',
        agentId,
        instructionMd: '',
        gateMode: 'HUMAN_APPROVAL',
      },
    ]);

    const result = okData<WorkflowValidationResult>(
      await api(app, { method: 'POST', url: `/api/workflows/${workflowId}/validate` }),
    );

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'INSTRUCTION_EMPTY')).toBe(true);
  });

  test('matches enabled workflows by scenario, keywords and tags', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    await createWorkflow(
      app,
      agentId,
      [{ stepKey: 'a', name: 'A', agentId }],
      {
        name: '新功能开发',
        scenario: '新功能',
        tags: ['feature'],
        matchKeywords: ['新增', '功能'],
      },
    );
    await createWorkflow(
      app,
      agentId,
      [{ stepKey: 'a', name: 'A', agentId }],
      {
        name: '草稿流程',
        scenario: '新功能',
        status: 'DRAFT',
        matchKeywords: ['新增'],
      },
    );

    const candidates = okData<MatchCandidate[]>(
      await api(app, {
        method: 'POST',
        url: '/api/workflows/match',
        payload: { text: '新增一个 feature 功能', scenario: '新功能' },
      }),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.workflow.name).toBe('新功能开发');
    expect(candidates[0]?.score).toBe(17);
    expect(candidates[0]?.reasons.length).toBeGreaterThan(0);
  });

  test('lists workflow summaries with step counts and agent names', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    await createWorkflow(app, agentId, [
      { stepKey: 'a', name: 'A', agentId },
      { stepKey: 'b', name: 'B', agentId, dependsOn: ['a'] },
    ]);

    const list = okData<WorkflowSummary[]>(
      await api(app, { method: 'GET', url: '/api/workflows' }),
    );

    expect(list).toHaveLength(1);
    expect(list[0]?.stepCount).toBe(2);
    expect(list[0]?.agentNames).toContain('测试工程师');
  });

  test('replaces steps on update', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const workflowId = await createWorkflow(app, agentId, [
      { stepKey: 'a', name: 'A', agentId },
    ]);

    const updated = okData<Workflow>(
      await api(app, {
        method: 'PUT',
        url: `/api/workflows/${workflowId}`,
        payload: {
          name: '测试工作流',
          scenario: '测试',
          status: 'ENABLED',
          steps: [
            { stepKey: 'x', name: 'X', agentId },
            { stepKey: 'y', name: 'Y', agentId, dependsOn: ['x'] },
          ],
        },
      }),
    );

    expect(updated.steps.map((step) => step.stepKey)).toEqual(['x', 'y']);
  });
});
