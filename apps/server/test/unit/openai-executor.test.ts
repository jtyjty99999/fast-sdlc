import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpenAICompatibleExecutor } from '../../src/execution/executors/openai';
import { AppError } from '../../src/http/errors';
import type { ExecutorInput } from '../../src/execution/types';

const input: ExecutorInput = {
  agentId: 'agent_1',
  agentName: '测试 Agent',
  role: '测试',
  model: 'qwen-plus',
  stepName: '步骤',
  taskTitle: '任务',
  systemPrompt: '系统提示',
  userPrompt: '用户请求',
};

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

function executor(overrides: { apiKey?: string; maxTokens?: number } = {}) {
  return new OpenAICompatibleExecutor({
    baseUrl: 'http://127.0.0.1:11434/v1/',
    model: 'qwen-plus',
    apiKey: overrides.apiKey,
    maxTokens: overrides.maxTokens,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAICompatibleExecutor', () => {
  test('streams deltas and reads usage from openai-compatible chunks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"你"}}]}\r\n\r\n',
          'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const deltas: string[] = [];
    const result = await executor().run(input, (event) => deltas.push(event.text), new AbortController().signal);

    expect(deltas).toEqual(['你', '好']);
    expect(result).toEqual({
      outputMd: '你好',
      inputTokens: 12,
      outputTokens: 3,
      model: 'qwen-plus',
    });
  });

  test('sends the expected endpoint, headers and body', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await executor({ apiKey: 'sk-test', maxTokens: 123 }).run(
      input,
      () => {},
      new AbortController().signal,
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'qwen-plus',
      max_tokens: 123,
      stream: true,
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '用户请求' },
      ],
    });
  });

  test('omits authorization for keyless local servers and does not double the path', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const keyless = new OpenAICompatibleExecutor({
      baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
      model: 'llama3',
    });
    await keyless.run(input, () => {}, new AbortController().signal);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  test('surfaces upstream errors without leaking credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 })),
    );

    try {
      await executor({ apiKey: 'sk-secret' }).run(
        input,
        () => {},
        new AbortController().signal,
      );
      throw new Error('expected executor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('LLM_ERROR');
      expect((error as Error).message).toContain('401');
      expect((error as Error).message).toContain('invalid key');
      expect((error as Error).message).not.toContain('sk-secret');
    }
  });

  test('throws when the stream contains an in-band error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['data: {"error":{"message":"rate limited"}}\n\n'])),
    );

    await expect(
      executor().run(input, () => {}, new AbortController().signal),
    ).rejects.toThrow('rate limited');
  });

  test('propagates abort before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(executor().run(input, () => {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('handles SSE comments, multi-line data and a final payload without a newline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ': keep-alive\n\n',
          'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
          'data: {"choices":\ndata: [{"delta":{"content":"B"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"C"}}]}',
        ]),
      ),
    );

    const deltas: string[] = [];
    const result = await executor().run(input, (event) => deltas.push(event.text), new AbortController().signal);

    expect(deltas).toEqual(['A', 'B', 'C']);
    expect(result.outputMd).toBe('ABC');
  });

  test('skips malformed payloads and reads fallback usage fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: not-json\n\n',
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          'data: {"usage":{"input_tokens":5,"output_tokens":7}}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const result = await executor().run(input, () => {}, new AbortController().signal);

    expect(result).toEqual({ outputMd: 'ok', inputTokens: 5, outputTokens: 7, model: 'qwen-plus' });
  });

  test('reports max_tokens exhaustion when a stream has no content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    await expect(
      executor({ maxTokens: 512 }).run(input, () => {}, new AbortController().signal),
    ).rejects.toThrow(/512 tokens.*Max Tokens/);
  });

  test('reports the finish reason for other empty completions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    await expect(
      executor().run(input, () => {}, new AbortController().signal),
    ).rejects.toThrow(/content_filter/);
  });

  test('omits the system message when the prompt is blank', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await executor().run(
      { ...input, systemPrompt: '   ' },
      () => {},
      new AbortController().signal,
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: unknown[] };
    expect(body.messages).toEqual([{ role: 'user', content: '用户请求' }]);
  });

  test('reports a missing response body and plain-text upstream errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(
      executor().run(input, () => {}, new AbortController().signal),
    ).rejects.toThrow('未返回流式响应');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream unavailable', { status: 503 })),
    );
    await expect(
      executor().run(input, () => {}, new AbortController().signal),
    ).rejects.toThrow('模型接口返回 503：upstream unavailable');
  });
});
