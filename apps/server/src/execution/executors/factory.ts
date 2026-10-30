import type { AppConfig } from '../../config';
import { badRequest } from '../../http/errors';
import type { AgentExecutor } from '../types';
import { AnthropicExecutor } from './anthropic';
import { MockExecutor } from './mock';

export function resolveExecutorKind(config: AppConfig): 'mock' | 'anthropic' {
  if (config.llmProvider === 'auto') {
    return config.anthropicApiKey ? 'anthropic' : 'mock';
  }
  return config.llmProvider;
}

export function executorInfo(config: AppConfig): {
  kind: 'mock' | 'anthropic';
  model: string;
  label: string;
} {
  const kind = resolveExecutorKind(config);
  if (kind === 'anthropic') {
    return {
      kind,
      model: config.anthropicModel,
      label: `Anthropic · ${config.anthropicModel}`,
    };
  }
  return { kind: 'mock', model: 'mock', label: 'Mock 模拟执行器' };
}

export function createExecutor(config: AppConfig): AgentExecutor {
  if (resolveExecutorKind(config) === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw badRequest('LLM_NOT_CONFIGURED', '已指定 anthropic 执行器，但未配置 ANTHROPIC_API_KEY');
    }
    return new AnthropicExecutor({
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
    });
  }
  return new MockExecutor({
    delayMs: config.mockDelayMs,
    failStep: config.mockFailStep,
  });
}
