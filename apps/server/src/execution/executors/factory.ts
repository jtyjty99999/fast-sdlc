import { MODEL_PROVIDER_LABELS, type OverviewData } from '@autosdd/shared';
import type { AppConfig } from '../../config';
import type { ModelRuntime } from '../../domain/models/repository';
import { badRequest } from '../../http/errors';
import type { AgentExecutor } from '../types';
import { AnthropicExecutor } from './anthropic';
import { MockExecutor } from './mock';
import { OpenAICompatibleExecutor } from './openai';

export function createExecutorForModel(
  model: ModelRuntime,
  config: AppConfig,
): AgentExecutor {
  if (model.provider === 'mock') {
    return new MockExecutor({
      delayMs: config.mockDelayMs,
      failStep: config.mockFailStep,
    });
  }

  if (model.provider === 'anthropic') {
    const apiKey = model.apiKey ?? config.anthropicApiKey;
    if (!apiKey) {
      throw badRequest(
        'LLM_NOT_CONFIGURED',
        `模型「${model.name}」未配置 API Key，请在模型管理中保存，或设置 ANTHROPIC_API_KEY`,
      );
    }
    return new AnthropicExecutor({
      apiKey,
      model: model.modelId,
      baseURL: model.baseUrl || undefined,
      maxTokens: model.maxTokens,
    });
  }

  if (!model.baseUrl) {
    throw badRequest('INVALID_BASE_URL', `模型「${model.name}」缺少 Base URL`);
  }
  return new OpenAICompatibleExecutor({
    baseUrl: model.baseUrl,
    model: model.modelId,
    apiKey: model.apiKey ?? config.openaiApiKey,
    maxTokens: model.maxTokens,
  });
}

export function executorInfoForModel(
  model: ModelRuntime | undefined,
): OverviewData['executor'] {
  if (!model) {
    return { kind: 'mock', model: 'mock', label: '未配置默认模型' };
  }
  return {
    kind: model.provider,
    model: model.modelId,
    label: `${MODEL_PROVIDER_LABELS[model.provider]} · ${model.name}`,
  };
}
