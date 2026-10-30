import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ExecutorInput } from '../../src/execution/types';
import { AnthropicExecutor } from '../../src/execution/executors/anthropic';

const harness = vi.hoisted(() => {
  const state = {
    textHandlers: [] as Array<(text: string) => void>,
    aborted: false,
    deferFinal: false,
    resolveFinal: undefined as (() => void) | undefined,
  };
  const stream = {
    on(event: string, handler: (text: string) => void) {
      if (event === 'text') state.textHandlers.push(handler);
      return stream;
    },
    finalMessage() {
      for (const handler of state.textHandlers) handler('流式片段');
      const message = {
        content: [{ type: 'text', text: '完整的产物内容' }],
        usage: { input_tokens: 12, output_tokens: 34 },
      };
      if (!state.deferFinal) return Promise.resolve(message);
      return new Promise((resolve) => {
        state.resolveFinal = () => resolve(message);
      });
    },
    abort() {
      state.aborted = true;
    },
  };
  return { state, stream };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: () => harness.stream };
    constructor(_options: unknown) {}
  },
}));

function input(overrides: Partial<ExecutorInput> = {}): ExecutorInput {
  return {
    agentId: 'agent_1',
    agentName: '架构师',
    role: '架构',
    model: 'claude-sonnet-5',
    stepName: '架构设计',
    taskTitle: '实现导出',
    systemPrompt: 'system prompt',
    userPrompt: 'user prompt',
    ...overrides,
  };
}

beforeEach(() => {
  harness.state.textHandlers = [];
  harness.state.aborted = false;
  harness.state.deferFinal = false;
  harness.state.resolveFinal = undefined;
});

describe('AnthropicExecutor', () => {
  test('streams text deltas and returns the final message metadata', async () => {
    const executor = new AnthropicExecutor({ apiKey: 'test-key', model: 'fallback-model' });
    const chunks: string[] = [];

    const result = await executor.run(
      input({ model: 'claude-opus-5' }),
      (event) => chunks.push(event.text),
      new AbortController().signal,
    );

    expect(chunks).toEqual(['流式片段']);
    expect(result).toEqual({
      outputMd: '完整的产物内容',
      inputTokens: 12,
      outputTokens: 34,
      model: 'claude-opus-5',
    });
  });

  test('falls back to the configured model when the agent has none', async () => {
    const executor = new AnthropicExecutor({ apiKey: 'test-key', model: 'fallback-model' });

    const result = await executor.run(
      input({ model: '' }),
      () => undefined,
      new AbortController().signal,
    );

    expect(result.model).toBe('fallback-model');
  });

  test('rejects immediately when the signal is already aborted', async () => {
    const executor = new AnthropicExecutor({ apiKey: 'test-key', model: 'm' });
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.run(input(), () => undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('aborts the SDK stream when the signal fires mid-run', async () => {
    harness.state.deferFinal = true;
    const executor = new AnthropicExecutor({ apiKey: 'test-key', model: 'm' });
    const controller = new AbortController();

    const run = executor.run(input(), () => undefined, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    harness.state.resolveFinal?.();
    await run;

    expect(harness.state.aborted).toBe(true);
  });
});
