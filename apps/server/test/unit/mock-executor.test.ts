import { describe, expect, test } from 'vitest';
import type { ExecutorInput } from '../../src/execution/types';
import { MockExecutor } from '../../src/execution/executors/mock';

function input(overrides: Partial<ExecutorInput> = {}): ExecutorInput {
  return {
    agentId: 'agent_1',
    agentName: '执行者',
    role: '开发工程师',
    model: 'mock',
    stepName: '实现步骤',
    taskTitle: '实现导出功能',
    systemPrompt: 'system',
    userPrompt: 'user',
    ...overrides,
  };
}

async function collect(executor: MockExecutor, value: ExecutorInput): Promise<string> {
  const chunks: string[] = [];
  const result = await executor.run(
    value,
    (event) => chunks.push(event.text),
    new AbortController().signal,
  );
  return `${result.outputMd}\n---\n${chunks.join('')}`;
}

describe('MockExecutor', () => {
  const executor = new MockExecutor({ delayMs: 0 });

  test.each([
    ['需求分析师', '问题与目标'],
    ['系统架构师', '设计结论'],
    ['测试工程师', '验证范围'],
    ['代码评审员', '评审结论'],
    ['开发工程师', '实现概述'],
    ['技术写作者', '后续建议'],
  ])('produces a role-specific template for %s', async (role, heading) => {
    const output = await collect(executor, input({ role }));

    expect(output).toContain(heading);
    expect(output).toContain('实现导出功能');
  });

  test('streams the output in chunks that reassemble to the final text', async () => {
    const chunks: string[] = [];
    const result = await executor.run(
      input(),
      (event) => chunks.push(event.text),
      new AbortController().signal,
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(result.outputMd);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.model).toBe('mock');
  });

  test('fails when the configured step matches', async () => {
    const failing = new MockExecutor({ delayMs: 0, failStep: '实现步骤' });

    await expect(
      failing.run(input(), () => undefined, new AbortController().signal),
    ).rejects.toThrow('模拟执行失败');
  });

  test('fails when the prompt contains the [fail] marker', async () => {
    await expect(
      executor.run(
        input({ userPrompt: '请执行 [fail]' }),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow('模拟执行失败');
  });

  test('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.run(input(), () => undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('stops mid-stream when aborted', async () => {
    const slow = new MockExecutor({ delayMs: 10 });
    const controller = new AbortController();
    const chunks: string[] = [];

    const run = slow.run(
      input({ role: '需求分析师' }),
      (event) => {
        chunks.push(event.text);
        controller.abort();
      },
      controller.signal,
    );

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(chunks).toHaveLength(1);
  });
});
