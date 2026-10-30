import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL_MAX_TOKENS } from '@autosdd/shared';
import type {
  AgentExecutor,
  ExecutorEmit,
  ExecutorInput,
  ExecutorResult,
} from '../types';
import { emptyOutputError } from './empty-output';

interface AnthropicExecutorOptions {
  apiKey: string;
  model: string;
  baseURL?: string | undefined;
  maxTokens?: number | undefined;
}

export class AnthropicExecutor implements AgentExecutor {
  readonly kind = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options: AnthropicExecutorOptions) {
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async run(
    input: ExecutorInput,
    emit: ExecutorEmit,
    signal: AbortSignal,
  ): Promise<ExecutorResult> {
    signal.throwIfAborted();
    const model = input.model || this.model;
    const stream = this.client.messages.stream({
      model,
      max_tokens: this.maxTokens,
      system: input.systemPrompt,
      messages: [{ role: 'user', content: input.userPrompt }],
    });

    const onAbort = () => stream.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      stream.on('text', (text) => emit({ type: 'delta', text }));
      const message = await stream.finalMessage();
      const outputMd = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      if (!outputMd.trim()) {
        throw emptyOutputError(this.maxTokens, message.stop_reason);
      }
      return {
        outputMd,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        model,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
