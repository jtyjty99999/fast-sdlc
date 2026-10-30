import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Model } from '@autosdd/shared';
import { ModelFormModal } from './ModelFormModal';
import { ToastProvider } from './ui/Toast';
import { makeModel } from '../test/fixtures';

function renderModal(model?: Model | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ModelFormModal open model={model} onClose={() => undefined} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, data: makeModel() }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModelFormModal', () => {
  it('requires a name and a model id', async () => {
    // Arrange
    const user = userEvent.setup();
    renderModal();

    // Act
    await user.click(screen.getByRole('button', { name: '保存模型' }));

    // Assert
    expect(await screen.findByText('名称与模型 ID 为必填项。')).toBeInTheDocument();
  });

  it('hides Base URL and API Key for the mock provider', async () => {
    // Arrange
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();

    // Act
    await user.selectOptions(screen.getByLabelText('提供方'), 'mock');

    // Assert
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  });

  it('submits the entered API key for a new OpenAI-compatible model', async () => {
    // Arrange
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    renderModal();

    // Act
    await user.type(screen.getByLabelText('名称'), 'Qwen Plus');
    await user.type(screen.getByLabelText('模型 ID'), 'qwen-plus');
    await user.type(screen.getByLabelText('Base URL'), 'https://example.com/v1');
    await user.type(screen.getByLabelText('API Key'), 'sk-test');
    await user.click(screen.getByRole('button', { name: '保存模型' }));

    // Assert
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: 'Qwen Plus',
      provider: 'openai',
      modelId: 'qwen-plus',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      maxTokens: 4096,
    });
  });

  it('omits the API key when editing without entering a new one', async () => {
    // Arrange
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    renderModal(
      makeModel({
        provider: 'anthropic',
        name: 'Claude Sonnet 5',
        modelId: 'claude-sonnet-5',
        keySource: 'stored',
        isDefault: false,
      }),
    );

    // Act
    await user.click(screen.getByRole('button', { name: '保存模型' }));

    // Assert
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/models/mdl_mock_default');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('apiKey');
  });
});
