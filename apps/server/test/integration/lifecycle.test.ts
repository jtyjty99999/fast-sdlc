import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  OverviewData,
  RunDetail,
  RunEvent,
  StepRun,
  Task,
  TaskDetail,
} from '@autosdd/shared';
import {
  api,
  createAgent,
  createTask,
  createTestApp,
  createWorkflow,
  getTask,
  okData,
  waitForTaskStatus,
} from '../helpers';

const apps: FastifyInstance[] = [];

async function setup(overrides: Parameters<typeof createTestApp>[0] = {}): Promise<FastifyInstance> {
  const app = await createTestApp(overrides);
  apps.push(app);
  return app;
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

interface Fixture {
  workflowId: string;
  taskId: string;
}

async function createGateFixture(app: FastifyInstance): Promise<Fixture> {
  const reqAgent = await createAgent(app, '需求分析师', '需求分析');
  const devAgent = await createAgent(app, '开发工程师', '开发实现');
  const workflowId = await createWorkflow(
    app,
    reqAgent,
    [
      {
        stepKey: 'req',
        name: '需求分析',
        agentId: reqAgent,
        instructionMd: '输出需求规格',
      },
      {
        stepKey: 'dev',
        name: '编码实现',
        agentId: devAgent,
        instructionMd: '按需求实现',
        dependsOn: ['req'],
        gateMode: 'HUMAN_APPROVAL',
      },
      {
        stepKey: 'verify',
        name: '质量验证',
        agentId: devAgent,
        instructionMd: '输出验证报告',
        dependsOn: ['dev'],
      },
    ],
    { scenario: '测试', matchKeywords: ['导出'] },
  );
  const taskId = await createTask(app, workflowId, '新增导出功能');
  return { workflowId, taskId };
}

function stepByKey(detail: TaskDetail, key: string): StepRun {
  const step = detail.run?.steps.find((candidate) => candidate.stepKey === key);
  if (!step) throw new Error(`missing step ${key}`);
  return step;
}

describe('task lifecycle', () => {
  test('runs a gated workflow to success after approval', async () => {
    const app = await setup();
    const { taskId } = await createGateFixture(app);

    const started = okData<TaskDetail>(
      await api(app, { method: 'POST', url: `/api/tasks/${taskId}/run` }),
    );
    expect(started.task.status).toBe('QUEUED');
    expect(started.run?.steps).toHaveLength(3);

    const waiting = await waitForTaskStatus(app, taskId, ['WAITING_APPROVAL']);
    const gated = stepByKey(waiting, 'dev');
    expect(stepByKey(waiting, 'req').status).toBe('SUCCEEDED');
    expect(stepByKey(waiting, 'req').outputMd).toBeTruthy();
    expect(gated.status).toBe('WAITING_APPROVAL');
    expect(gated.outputMd).toBeTruthy();
    expect(gated.approval?.status).toBe('PENDING');

    // 再次启动应被拒绝
    const conflict = await api(app, {
      method: 'POST',
      url: `/api/tasks/${taskId}/run`,
    });
    expect(conflict.status).toBe(409);
    if (!conflict.body.ok) expect(conflict.body.error.code).toBe('RUN_IN_PROGRESS');

    // 未到审批卡点时审批另一步骤应报错
    const reqStep = stepByKey(waiting, 'req');
    const invalidApproval = await api(app, {
      method: 'POST',
      url: `/api/runs/${waiting.run?.id}/steps/${reqStep.id}/approval`,
      payload: { decision: 'APPROVED' },
    });
    expect(invalidApproval.status).toBe(409);

    const runId = waiting.run!.id;
    const approved = okData<StepRun>(
      await api(app, {
        method: 'POST',
        url: `/api/runs/${runId}/steps/${gated.id}/approval`,
        payload: { decision: 'APPROVED', comment: '实现符合预期' },
      }),
    );
    expect(approved.status).toBe('SUCCEEDED');

    const finished = await waitForTaskStatus(app, taskId, ['SUCCEEDED']);
    expect(finished.task.status).toBe('SUCCEEDED');
    expect(finished.run?.status).toBe('SUCCEEDED');
    expect(finished.run?.steps.map((step) => step.status)).toEqual([
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
    ]);
    for (const step of finished.run?.steps ?? []) {
      expect(step.outputMd?.length).toBeGreaterThan(0);
      expect(step.model).toBe('mock');
      expect(step.inputTokens).toBeGreaterThan(0);
    }

    const events = okData<RunEvent[]>(
      await api(app, { method: 'GET', url: `/api/runs/${runId}/events` }),
    );
    expect(events.length).toBeGreaterThan(10);
    expect(events[0]?.type).toBe('LOG');
    expect(events.at(-1)?.type).toBe('RUN_SUCCEEDED');
    expect(events.some((event) => event.type === 'APPROVAL_DECIDED')).toBe(true);

    const overview = okData<OverviewData>(
      await api(app, { method: 'GET', url: '/api/overview' }),
    );
    expect(overview.counts.tasks).toBe(1);
    expect(overview.counts.succeededTasks).toBe(1);
    expect(overview.counts.successRate).toBe(100);
    expect(overview.executor.kind).toBe('mock');
  });

  test('fails the run when a gate is rejected', async () => {
    const app = await setup();
    const { taskId } = await createGateFixture(app);
    await api(app, { method: 'POST', url: `/api/tasks/${taskId}/run` });

    const waiting = await waitForTaskStatus(app, taskId, ['WAITING_APPROVAL']);
    const gated = stepByKey(waiting, 'dev');

    const rejected = okData<StepRun>(
      await api(app, {
        method: 'POST',
        url: `/api/runs/${waiting.run?.id}/steps/${gated.id}/approval`,
        payload: { decision: 'REJECTED', comment: '实现缺少异常处理' },
      }),
    );
    expect(rejected.status).toBe('FAILED');

    const failed = await waitForTaskStatus(app, taskId, ['FAILED']);
    expect(failed.run?.status).toBe('FAILED');
    expect(failed.run?.error).toContain('实现缺少异常处理');
    expect(stepByKey(failed, 'verify').status).toBe('CANCELED');
  });

  test('rerunning a terminal task creates a new run number', async () => {
    const app = await setup();
    const reqAgent = await createAgent(app);
    const workflowId = await createWorkflow(app, reqAgent, [
      { stepKey: 'only', name: '单步', agentId: reqAgent },
    ]);
    const taskId = await createTask(app, workflowId);

    await api(app, { method: 'POST', url: `/api/tasks/${taskId}/run` });
    await waitForTaskStatus(app, taskId, ['SUCCEEDED']);
    await api(app, { method: 'POST', url: `/api/tasks/${taskId}/run` });

    const second = await waitForTaskStatus(app, taskId, ['SUCCEEDED']);
    const runs = okData<TaskDetail['runs']>(
      await api(app, { method: 'GET', url: `/api/tasks/${taskId}/runs` }),
    );

    expect(second.run?.runNumber).toBe(2);
    expect(runs.map((run) => run.runNumber)).toEqual([2, 1]);
    expect(runs.every((run) => run.status === 'SUCCEEDED')).toBe(true);
  });

  test('cancels a running task', async () => {
    const app = await setup({ mockDelayMs: 25 });
    const agentId = await createAgent(app);
    const workflowId = await createWorkflow(app, agentId, [
      { stepKey: 'long', name: '长步骤', agentId },
    ]);
    const taskId = await createTask(app, workflowId);

    await api(app, { method: 'POST', url: `/api/tasks/${taskId}/run` });
    const canceled = okData<TaskDetail>(
      await api(app, { method: 'POST', url: `/api/tasks/${taskId}/cancel` }),
    );
    expect(canceled.task.status).toBe('CANCELED');
    expect(canceled.run?.status).toBe('CANCELED');

    const again = await api(app, {
      method: 'POST',
      url: `/api/tasks/${taskId}/cancel`,
    });
    expect(again.status).toBe(409);

    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await getTask(app, taskId);
    expect(after.task.status).toBe('CANCELED');
  });

  test('fails a run when the executor reports a failure', async () => {
    const app = await setup({ mockFailStep: '编码实现' });
    const agentId = await createAgent(app, '开发工程师', '开发实现');
    const workflowId = await createWorkflow(app, agentId, [
      { stepKey: 'a', name: '需求分析', agentId },
      { stepKey: 'b', name: '编码实现', agentId, dependsOn: ['a'] },
    ]);
    const taskId = await createTask(app, workflowId);

    await api(app, { method: 'POST', url: `/api/tasks/${taskId}/run` });
    const failed = await waitForTaskStatus(app, taskId, ['FAILED']);

    expect(failed.run?.error).toContain('模拟执行失败');
    expect(stepByKey(failed, 'a').status).toBe('SUCCEEDED');
    expect(stepByKey(failed, 'b').status).toBe('FAILED');
  });
});

describe('task creation', () => {
  test('matches a workflow automatically when none is provided', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    await createWorkflow(app, agentId, [{ stepKey: 'a', name: 'A', agentId }], {
      scenario: '测试',
      matchKeywords: ['导出'],
    });

    const task = okData<Task>(
      await api(app, {
        method: 'POST',
        url: '/api/tasks',
        payload: { title: '新增导出能力', description: '支持 CSV', scenario: '测试' },
      }),
    );

    expect(task.workflowId).toBeTruthy();
    expect(task.scenario).toBe('测试');
    expect(task.status).toBe('QUEUED');
  });

  test('rejects creation when nothing matches', async () => {
    const app = await setup();
    const result = await api(app, {
      method: 'POST',
      url: '/api/tasks',
      payload: { title: '无匹配任务' },
    });

    expect(result.status).toBe(400);
    if (!result.body.ok) expect(result.body.error.code).toBe('NO_WORKFLOW_MATCH');
  });

  test('rejects a disabled workflow', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const workflowId = await createWorkflow(
      app,
      agentId,
      [{ stepKey: 'a', name: 'A', agentId }],
      { status: 'DRAFT' },
    );

    const result = await api(app, {
      method: 'POST',
      url: '/api/tasks',
      payload: { title: '任务', workflowId },
    });

    expect(result.status).toBe(409);
    if (!result.body.ok) expect(result.body.error.code).toBe('WORKFLOW_DISABLED');
  });

  test('lists tasks filtered by status and query', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const workflowId = await createWorkflow(app, agentId, [
      { stepKey: 'a', name: 'A', agentId },
    ]);
    await createTask(app, workflowId, '导出功能');
    await createTask(app, workflowId, '登录修复');

    const filtered = okData<Task[]>(
      await api(app, { method: 'GET', url: '/api/tasks?q=导出' }),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe('导出功能');

    const byStatus = okData<Task[]>(
      await api(app, { method: 'GET', url: '/api/tasks?status=QUEUED' }),
    );
    expect(byStatus).toHaveLength(2);
  });
});

describe('run lookup', () => {
  test('returns 404 for unknown runs and tasks', async () => {
    const app = await setup();

    expect((await api(app, { method: 'GET', url: '/api/tasks/nope' })).status).toBe(404);
    expect((await api(app, { method: 'GET', url: '/api/runs/nope' })).status).toBe(404);
    expect(
      (await api(app, { method: 'GET', url: '/api/runs/nope/events' })).status,
    ).toBe(404);
  });

  test('exposes the run detail and snapshot-backed steps', async () => {
    const app = await setup();
    const agentId = await createAgent(app);
    const workflowId = await createWorkflow(app, agentId, [
      { stepKey: 'a', name: '步骤一', agentId },
    ]);
    const taskId = await createTask(app, workflowId);
    const started = okData<TaskDetail>(
      await api(app, { method: 'POST', url: `/api/tasks/${taskId}/run` }),
    );

    const run = okData<RunDetail>(
      await api(app, { method: 'GET', url: `/api/runs/${started.run?.id}` }),
    );

    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]?.agentName).toBe('测试工程师');
    expect(run.steps[0]?.instructionMd).toBe('输出测试报告');
    await waitForTaskStatus(app, taskId, ['SUCCEEDED']);
  });
});
