import { describe, expect, test } from 'vitest';
import type { AppConfig } from '../../src/config';
import { loadConfig } from '../../src/config';
import type { ModelRuntime } from '../../src/domain/models/repository';
import {
  createExecutorForModel,
  executorInfoForModel,
} from '../../src/execution/executors/factory';
import { AppError } from '../../src/http/errors';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({}),
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
    ...overrides,
  };
}

function model(overrides: Partial<ModelRuntime> = {}): ModelRuntime {
  return {
    id: 'mdl_test',
    name: '测试模型',
    provider: 'mock',
    modelId: 'mock',
    baseUrl: '',
    apiKey: null,
    maxTokens: 4096,
    isDefault: false,
    status: 'ACTIVE',
    agentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createExecutorForModel', () => {
  test('creates a mock executor without any key', () => {
    expect(createExecutorForModel(model(), config()).kind).toBe('mock');
  });

  test('rejects anthropic models without a stored or environment key', () => {
    try {
      createExecutorForModel(
        model({ provider: 'anthropic', modelId: 'claude-sonnet-5' }),
        config(),
      );
      throw new Error('expected createExecutorForModel to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('LLM_NOT_CONFIGURED');
    }
  });

  test('uses the environment key for anthropic models', () => {
    const executor = createExecutorForModel(
      model({ provider: 'anthropic', modelId: 'claude-sonnet-5' }),
      config({ anthropicApiKey: 'test-key' }),
    );

    expect(executor.kind).toBe('anthropic');
    expect(executor.model).toBe('claude-sonnet-5');
  });

  test('prefers a stored key over the environment', () => {
    const executor = createExecutorForModel(
      model({ provider: 'anthropic', modelId: 'claude-sonnet-5', apiKey: 'stored-key' }),
      config({ anthropicApiKey: 'env-key' }),
    );

    expect(executor.kind).toBe('anthropic');
  });

  test('requires a base URL for openai-compatible models', () => {
    try {
      createExecutorForModel(model({ provider: 'openai', modelId: 'qwen' }), config());
      throw new Error('expected createExecutorForModel to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('INVALID_BASE_URL');
    }
  });

  test('allows keyless openai-compatible models such as local Ollama', () => {
    const executor = createExecutorForModel(
      model({
        provider: 'openai',
        modelId: 'llama3',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
      config(),
    );

    expect(executor.kind).toBe('openai');
    expect(executor.model).toBe('llama3');
  });
});

describe('executorInfoForModel', () => {
  test('falls back when no default model exists', () => {
    expect(executorInfoForModel(undefined)).toEqual({
      kind: 'mock',
      model: 'mock',
      label: '未配置默认模型',
    });
  });

  test('describes the default model', () => {
    const info = executorInfoForModel(
      model({ name: 'Claude Sonnet 5', provider: 'anthropic', modelId: 'claude-sonnet-5' }),
    );

    expect(info).toEqual({
      kind: 'anthropic',
      model: 'claude-sonnet-5',
      label: 'Anthropic · Claude Sonnet 5',
    });
  });
});
