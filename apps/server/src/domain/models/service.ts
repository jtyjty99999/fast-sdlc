import type {
  Model,
  ModelKeySource,
  ModelTestResult,
} from '@autosdd/shared';
import type { ModelInputSchema } from '@autosdd/shared';
import type { AppConfig } from '../../config';
import { AppError, conflict, notFound } from '../../http/errors';
import { createExecutorForModel } from '../../execution/executors/factory';
import type { ModelRepository, ModelRuntime, ModelWrite } from './repository';

const TEST_TIMEOUT_MS = 15_000;
const TEST_MAX_TOKENS = 64;
const TEST_SAMPLE_LIMIT = 200;
const ERROR_MESSAGE_LIMIT = 300;

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ModelService {
  constructor(
    private readonly models: ModelRepository,
    private readonly config: AppConfig,
  ) {}

  list(q?: string, provider?: string): Model[] {
    return this.models
      .list(q?.trim() || undefined, provider?.trim() || undefined)
      .map((model) => this.toPublic(model));
  }

  get(id: string): Model {
    return this.toPublic(this.require(id));
  }

  create(input: ModelInputSchema): Model {
    const apiKey = input.apiKey && input.apiKey.trim() ? input.apiKey : null;
    return this.toPublic(this.models.create(this.toWrite(input, apiKey)));
  }

  update(id: string, input: ModelInputSchema): Model {
    const existing = this.require(id);
    this.assertCanChangeStatus(existing, input.status);
    const apiKey =
      input.apiKey === undefined ? existing.apiKey : input.apiKey.trim() ? input.apiKey : null;
    const updated = this.models.update(id, this.toWrite(input, apiKey));
    if (!updated) throw notFound('模型不存在');
    return this.toPublic(updated);
  }

  remove(id: string): void {
    const existing = this.require(id);
    if (existing.isDefault) {
      throw conflict('MODEL_IS_DEFAULT', '默认模型不能删除，请先将其他模型设为默认');
    }
    if (existing.agentCount > 0) {
      throw conflict('MODEL_IN_USE', `该模型仍被 ${existing.agentCount} 个 Agent 使用，请先切换`, {
        agentCount: existing.agentCount,
      });
    }
    this.models.remove(id);
  }

  setDefault(id: string): Model {
    const existing = this.require(id);
    if (existing.status !== 'ACTIVE') {
      throw conflict('MODEL_DISABLED', '停用的模型不能设为默认，请先启用');
    }
    this.models.setDefault(id);
    const updated = this.models.findById(id);
    if (!updated) throw notFound('模型不存在');
    return this.toPublic(updated);
  }

  async test(id: string): Promise<ModelTestResult> {
    const model = this.require(id);
    if (model.provider === 'mock') {
      return {
        ok: true,
        latencyMs: 0,
        provider: 'mock',
        model: model.modelId,
        sample: 'Mock 模型无需网络连接，可直接用于演示',
      };
    }

    const executor = createExecutorForModel(
      { ...model, maxTokens: Math.min(model.maxTokens, TEST_MAX_TOKENS) },
      this.config,
    );
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TEST_TIMEOUT_MS);
    timer.unref?.();

    const started = Date.now();
    try {
      const result = await executor.run(
        {
          agentId: 'model-test',
          agentName: '模型连通性测试',
          role: '连通性测试',
          model: model.modelId,
          stepName: '连接测试',
          taskTitle: '模型连通性测试',
          systemPrompt: '你是模型连通性检测助手，请按要求简短回复。',
          userPrompt: '只回复 OK',
        },
        () => {},
        controller.signal,
      );
      const sample = result.outputMd.trim().slice(0, TEST_SAMPLE_LIMIT);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        provider: model.provider,
        model: model.modelId,
        sample: sample || '（模型返回了空文本）',
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (timedOut) {
        throw new AppError(502, 'LLM_ERROR', `连接测试超时（${TEST_TIMEOUT_MS / 1000} 秒）`);
      }
      throw new AppError(
        502,
        'LLM_ERROR',
        `连接测试失败：${truncate(errorMessage(error), ERROR_MESSAGE_LIMIT)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private require(id: string): ModelRuntime {
    const model = this.models.findById(id);
    if (!model) throw notFound('模型不存在');
    return model;
  }

  private assertCanChangeStatus(existing: ModelRuntime, nextStatus: string): void {
    if (nextStatus !== 'DISABLED') return;
    if (existing.isDefault) {
      throw conflict('MODEL_IS_DEFAULT', '默认模型不能停用，请先切换默认模型');
    }
    if (existing.agentCount > 0) {
      throw conflict('MODEL_IN_USE', `该模型仍被 ${existing.agentCount} 个 Agent 使用，请先切换`, {
        agentCount: existing.agentCount,
      });
    }
  }

  private toWrite(input: ModelInputSchema, apiKey: string | null): ModelWrite {
    return {
      name: input.name,
      provider: input.provider,
      modelId: input.modelId,
      baseUrl: input.provider === 'mock' ? '' : input.baseUrl,
      apiKey: input.provider === 'mock' ? null : apiKey,
      maxTokens: input.maxTokens,
      status: input.status,
    };
  }

  private toPublic(model: ModelRuntime): Model {
    return {
      id: model.id,
      name: model.name,
      provider: model.provider,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      maxTokens: model.maxTokens,
      keySource: this.keySource(model),
      isDefault: model.isDefault,
      status: model.status,
      agentCount: model.agentCount,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  private keySource(model: ModelRuntime): ModelKeySource {
    if (model.provider === 'mock') return 'none';
    if (model.apiKey) return 'stored';
    if (model.provider === 'anthropic' && this.config.anthropicApiKey) return 'env';
    if (model.provider === 'openai' && this.config.openaiApiKey) return 'env';
    return 'none';
  }
}
