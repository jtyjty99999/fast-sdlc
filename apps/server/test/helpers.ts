import type { FastifyInstance, InjectOptions } from 'fastify';
import type { ApiErr, ApiOk, TaskDetail } from '@autosdd/shared';
import { buildApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';

export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config: AppConfig = {
    ...loadConfig({}),
    databasePath: ':memory:',
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
    mockDelayMs: 0,
    mockFailStep: undefined,
    stepTimeoutSeconds: 5,
    ...overrides,
  };
  return buildApp({ config });
}

export interface ApiResult<T> {
  status: number;
  body: ApiOk<T> | ApiErr;
}

export async function api<T>(
  app: FastifyInstance,
  options: InjectOptions,
): Promise<ApiResult<T>> {
  const response = await app.inject(options);
  return {
    status: response.statusCode,
    body: response.json() as ApiOk<T> | ApiErr,
  };
}

export function okData<T>(result: ApiResult<T>): T {
  if (!result.body.ok) {
    throw new Error(`expected ok, got ${result.status}: ${result.body.error.message}`);
  }
  return result.body.data;
}

export async function createAgent(
  app: FastifyInstance,
  name = '测试工程师',
  role = '质量保障工程师',
): Promise<string> {
  const data = okData<{ id: string }>(
    await api(app, {
      method: 'POST',
      url: '/api/agents',
      payload: { name, role, description: '负责验证', systemPrompt: '严谨。' },
    }),
  );
  return data.id;
}

interface WorkflowStepPayload {
  stepKey: string;
  name: string;
  agentId: string;
  instructionMd?: string;
  dependsOn?: string[];
  gateMode?: 'NONE' | 'HUMAN_APPROVAL';
  orderIndex?: number;
}

export async function createWorkflow(
  app: FastifyInstance,
  agentId: string,
  steps: WorkflowStepPayload[],
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const data = okData<{ id: string }>(
    await api(app, {
      method: 'POST',
      url: '/api/workflows',
      payload: {
        name: '测试工作流',
        description: '用于集成测试',
        scenario: '测试',
        tags: ['test'],
        matchKeywords: ['测试'],
        status: 'ENABLED',
        steps: steps.map((step, index) => ({
          instructionMd: '输出测试报告',
          ...step,
          orderIndex: step.orderIndex ?? index,
        })),
        ...overrides,
      },
    }),
  );
  return data.id;
}

export async function createTask(
  app: FastifyInstance,
  workflowId: string,
  title = '测试任务',
): Promise<string> {
  const data = okData<{ id: string }>(
    await api(app, {
      method: 'POST',
      url: '/api/tasks',
      payload: { title, description: '测试任务描述', workflowId },
    }),
  );
  return data.id;
}

export async function getTask(app: FastifyInstance, taskId: string): Promise<TaskDetail> {
  return okData<TaskDetail>(
    await api(app, { method: 'GET', url: `/api/tasks/${taskId}` }),
  );
}

export async function waitForTaskStatus(
  app: FastifyInstance,
  taskId: string,
  expected: readonly string[],
  timeoutMs = 5000,
): Promise<TaskDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await getTask(app, taskId);
    if (expected.includes(detail.task.status)) return detail;
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${expected.join('/')}, got ${detail.task.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
