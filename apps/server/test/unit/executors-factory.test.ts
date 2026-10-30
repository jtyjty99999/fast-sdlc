import { describe, expect, test } from 'vitest';
import type { AppConfig } from '../../src/config';
import { loadConfig } from '../../src/config';
import { createExecutor, executorInfo, resolveExecutorKind } from '../../src/execution/executors/factory';
import { AppError } from '../../src/http/errors';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({}),
    llmProvider: 'mock',
    anthropicApiKey: undefined,
    ...overrides,
  };
}

describe('resolveExecutorKind', () => {
  test('uses mock when explicitly configured', () => {
    expect(resolveExecutorKind(config({ llmProvider: 'mock' }))).toBe('mock');
  });

  test('uses anthropic when explicitly configured', () => {
    expect(
      resolveExecutorKind(
        config({ llmProvider: 'anthropic', anthropicApiKey: 'test-key' }),
      ),
    ).toBe('anthropic');
  });

  test('auto mode follows the presence of an API key', () => {
    expect(resolveExecutorKind(config({ llmProvider: 'auto' }))).toBe('mock');
    expect(
      resolveExecutorKind(
        config({ llmProvider: 'auto', anthropicApiKey: 'test-key' }),
      ),
    ).toBe('anthropic');
  });
});

describe('executorInfo', () => {
  test('describes the mock executor', () => {
    expect(executorInfo(config())).toEqual({
      kind: 'mock',
      model: 'mock',
      label: 'Mock 模拟执行器',
    });
  });

  test('describes the anthropic executor with the configured model', () => {
    const info = executorInfo(
      config({
        llmProvider: 'anthropic',
        anthropicApiKey: 'test-key',
        anthropicModel: 'claude-sonnet-5',
      }),
    );

    expect(info.kind).toBe('anthropic');
    expect(info.model).toBe('claude-sonnet-5');
    expect(info.label).toContain('Anthropic');
  });
});

describe('createExecutor', () => {
  test('creates a mock executor by default', () => {
    expect(createExecutor(config()).kind).toBe('mock');
  });

  test('rejects anthropic mode without an API key', () => {
    try {
      createExecutor(config({ llmProvider: 'anthropic', anthropicApiKey: undefined }));
      throw new Error('expected createExecutor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('LLM_NOT_CONFIGURED');
    }
  });

  test('creates an anthropic executor when a key is present', () => {
    const executor = createExecutor(
      config({ llmProvider: 'anthropic', anthropicApiKey: 'test-key' }),
    );

    expect(executor.kind).toBe('anthropic');
    expect(executor.model).toBe(config().anthropicModel);
  });
});
