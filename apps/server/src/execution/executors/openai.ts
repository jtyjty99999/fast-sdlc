import { DEFAULT_MODEL_MAX_TOKENS } from '@autosdd/shared';
import { AppError } from '../../http/errors';
import type {
  AgentExecutor,
  ExecutorEmit,
  ExecutorInput,
  ExecutorResult,
} from '../types';

const ERROR_BODY_LIMIT = 500;
const ERROR_MESSAGE_LIMIT = 300;

interface OpenAIChatChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  } | null;
  error?: { message?: string } | null;
}

interface OpenAICompatibleExecutorOptions {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  maxTokens?: number | undefined;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function normalizeEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'INVALID_BASE_URL', 'Base URL 必须是 http(s) 地址');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  url.hash = '';
  return url.toString();
}

function errorDetail(raw: string): string {
  const text = raw.trim().slice(0, ERROR_BODY_LIMIT);
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return truncate(parsed.error, ERROR_MESSAGE_LIMIT);
    if (parsed.error?.message) return truncate(parsed.error.message, ERROR_MESSAGE_LIMIT);
    if (parsed.message) return truncate(parsed.message, ERROR_MESSAGE_LIMIT);
  } catch {
    // Non-JSON error bodies (proxies, HTML pages) fall through to plain text.
  }
  return truncate(text, ERROR_MESSAGE_LIMIT);
}

/**
 * Yields the `data:` payload of each SSE event. Multi-line data is joined with
 * newlines as required by the SSE spec; comments and other fields are ignored.
 */
async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  const takePayload = (): string | undefined => {
    if (dataLines.length === 0) return undefined;
    const payload = dataLines.join('\n');
    dataLines = [];
    return payload;
  };

  const consumeLine = (line: string): string | undefined => {
    if (line === '') return takePayload();
    if (!line.startsWith('data:')) return undefined;
    const value = line.slice(5);
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        const payload = consumeLine(line);
        if (payload !== undefined) yield payload;
        newlineIndex = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const rawLine = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      const payload = consumeLine(rawLine);
      if (payload !== undefined) yield payload;
    }
    const trailing = takePayload();
    if (trailing !== undefined) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

export class OpenAICompatibleExecutor implements AgentExecutor {
  readonly kind = 'openai' as const;
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly maxTokens: number;

  constructor(options: OpenAICompatibleExecutorOptions) {
    this.model = options.model;
    this.endpoint = normalizeEndpoint(options.baseUrl);
    this.apiKey = options.apiKey;
    this.maxTokens = options.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS;
  }

  async run(
    input: ExecutorInput,
    emit: ExecutorEmit,
    signal: AbortSignal,
  ): Promise<ExecutorResult> {
    signal.throwIfAborted();

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const messages = [
      ...(input.systemPrompt.trim() ? [{ role: 'system', content: input.systemPrompt }] : []),
      { role: 'user', content: input.userPrompt },
    ];

    const response = await fetch(this.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        stream: true,
        messages,
      }),
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      const detail = errorDetail(raw);
      throw new AppError(
        502,
        'LLM_ERROR',
        `模型接口返回 ${response.status}${detail ? `：${detail}` : ''}`,
      );
    }
    if (!response.body) {
      throw new AppError(502, 'LLM_ERROR', '模型接口未返回流式响应');
    }

    let outputMd = '';
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    for await (const payload of readSseData(response.body)) {
      if (payload === '[DONE]') break;
      let chunk: OpenAIChatChunk;
      try {
        chunk = JSON.parse(payload) as OpenAIChatChunk;
      } catch {
        // Keep-alive comments and proxy noise are not JSON payloads.
        continue;
      }
      if (chunk.error?.message) {
        throw new AppError(502, 'LLM_ERROR', truncate(chunk.error.message, ERROR_MESSAGE_LIMIT));
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        outputMd += delta;
        emit({ type: 'delta', text: delta });
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? outputTokens;
      }
    }

    return { outputMd, inputTokens, outputTokens, model: this.model };
  }
}
