import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentExecutor,
  ExecutorEmit,
  ExecutorInput,
  ExecutorResult,
} from '../types';

interface AnthropicExecutorOptions {
  apiKey: string;
  model: string;
}

export class AnthropicExecutor implements AgentExecutor {
  readonly kind = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicExecutorOptions) {
    this.model = options.model;
    this.client = new Anthropic({ apiKey: options.apiKey });
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
      max_tokens: 4096,
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
