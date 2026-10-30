import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_MODEL_MAX_TOKENS,
  MODEL_PROVIDERS,
  MODEL_PROVIDER_LABELS,
  type Model,
  type ModelInput,
  type ModelProvider,
  type ModelStatus,
} from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { useToast } from './ui/Toast';

interface ModelFormModalProps {
  open: boolean;
  model?: Model | null;
  onClose: () => void;
}

interface FormState {
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  maxTokens: string;
  status: ModelStatus;
}

const EMPTY: FormState = {
  name: '',
  provider: 'openai',
  modelId: '',
  baseUrl: '',
  apiKey: '',
  maxTokens: String(DEFAULT_MODEL_MAX_TOKENS),
  status: 'ACTIVE',
};

const HTTP_URL = /^https?:\/\/\S+$/i;

function toForm(model: Model): FormState {
  return {
    name: model.name,
    provider: model.provider,
    modelId: model.modelId,
    baseUrl: model.baseUrl,
    apiKey: '',
    maxTokens: String(model.maxTokens),
    status: model.status,
  };
}

export function ModelFormModal({ open, model, onClose }: ModelFormModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(model ? toForm(model) : EMPTY);
  }, [open, model]);

  const mutation = useMutation({
    mutationFn: (input: ModelInput) =>
      model ? api.models.update(model.id, input) : api.models.create(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['models'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success(model ? '模型已更新' : '模型已创建');
      onClose();
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const update = (patch: Partial<FormState>): void => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);

    const maxTokens = Number(form.maxTokens);
    if (!form.name.trim() || !form.modelId.trim()) {
      setError('名称与模型 ID 为必填项。');
      return;
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 65_536) {
      setError('Max Tokens 必须是 1–65536 之间的整数。');
      return;
    }
    const baseUrl = form.baseUrl.trim();
    if (form.provider === 'openai' && !HTTP_URL.test(baseUrl)) {
      setError('OpenAI 兼容模型必须填写 http(s) Base URL。');
      return;
    }
    if (form.provider === 'anthropic' && baseUrl !== '' && !HTTP_URL.test(baseUrl)) {
      setError('Base URL 必须是 http(s) 地址。');
      return;
    }

    const apiKey = form.apiKey.trim();
    mutation.mutate({
      name: form.name.trim(),
      provider: form.provider,
      modelId: form.modelId.trim(),
      baseUrl: form.provider === 'mock' ? '' : baseUrl,
      apiKey: apiKey === '' ? undefined : apiKey,
      maxTokens,
      status: form.status,
    });
  };

  const keyHint = model
    ? '留空保持不变；填写新值将覆盖已保存的 Key。'
    : '可留空，运行时回退到环境变量；本地 Ollama 等无鉴权服务也无需填写。';

  return (
    <Modal
      open={open}
      title={model ? '编辑模型' : '新建模型'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? '保存中…' : '保存模型'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        {error ? <div className="form-error span-2">{error}</div> : null}
        <Field label="名称" htmlFor="model-name">
          <input
            id="model-name"
            className="input"
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="例如：Qwen Plus"
            maxLength={80}
          />
        </Field>
        <Field label="提供方" htmlFor="model-provider">
          <select
            id="model-provider"
            className="select"
            value={form.provider}
            onChange={(event) => update({ provider: event.target.value as ModelProvider })}
          >
            {MODEL_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {MODEL_PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="模型 ID" htmlFor="model-id">
          <input
            id="model-id"
            className="input"
            value={form.modelId}
            onChange={(event) => update({ modelId: event.target.value })}
            placeholder="例如：qwen-plus / claude-sonnet-5"
            maxLength={120}
          />
        </Field>
        <Field label="Max Tokens" htmlFor="model-max-tokens">
          <input
            id="model-max-tokens"
            className="input"
            type="number"
            min={1}
            max={65_536}
            value={form.maxTokens}
            onChange={(event) => update({ maxTokens: event.target.value })}
          />
        </Field>
        {form.provider !== 'mock' ? (
          <Field
            label={form.provider === 'openai' ? 'Base URL' : 'Base URL（可选）'}
            htmlFor="model-base-url"
            className="span-2"
            hint={
              form.provider === 'openai'
                ? 'Chat Completions 兼容端点，例如 https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1。'
                : '留空使用 Anthropic 官方地址；自建代理时填写。'
            }
          >
            <input
              id="model-base-url"
              className="input"
              value={form.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
              placeholder="https://api.example.com/v1"
              maxLength={500}
            />
          </Field>
        ) : null}
        {form.provider !== 'mock' ? (
          <Field label="API Key" htmlFor="model-api-key" className="span-2" hint={keyHint}>
            <input
              id="model-api-key"
              className="input"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
              placeholder={model ? '留空保持不变' : '可选，仅保存在本地数据库'}
              maxLength={500}
            />
          </Field>
        ) : null}
        <Field label="状态" htmlFor="model-status">
          <select
            id="model-status"
            className="select"
            value={form.status}
            onChange={(event) => update({ status: event.target.value as ModelStatus })}
          >
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">停用</option>
          </select>
        </Field>
      </form>
    </Modal>
  );
}
