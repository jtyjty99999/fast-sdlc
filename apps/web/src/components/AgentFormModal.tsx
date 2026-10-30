import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MODEL_PROVIDER_LABELS, type Agent, type AgentInput } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { useToast } from './ui/Toast';

interface AgentFormModalProps {
  open: boolean;
  agent?: Agent | null;
  onClose: () => void;
  onSaved?: (agent: Agent) => void;
}

function initialForm(agent?: Agent | null): AgentInput {
  if (agent) {
    return {
      name: agent.name,
      role: agent.role,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      modelId: agent.modelId ?? '',
      status: agent.status,
    };
  }
  return {
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    modelId: '',
    status: 'ACTIVE',
  };
}

export function AgentFormModal({ open, agent, onClose, onSaved }: AgentFormModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<AgentInput>(initialForm());
  const [error, setError] = useState<string | null>(null);
  const models = useQuery({ queryKey: ['models'], queryFn: () => api.models.list() });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(initialForm(agent));
  }, [open, agent]);

  const mutation = useMutation({
    mutationFn: (input: AgentInput) =>
      agent ? api.agents.update(agent.id, input) : api.agents.create(input),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['agent', saved.id] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success(agent ? 'Agent 已更新' : 'Agent 已创建');
      onSaved?.(saved);
      onClose();
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const update = (patch: Partial<AgentInput>): void => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.role.trim()) {
      setError('名称与角色为必填项。');
      return;
    }
    mutation.mutate({
      ...form,
      modelId: form.modelId?.trim() || undefined,
    });
  };

  return (
    <Modal
      open={open}
      title={agent ? '编辑 Agent' : '新建 Agent'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? '保存中…' : agent ? '保存修改' : '创建 Agent'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="form-grid">
        {error ? <div className="form-error span-2">{error}</div> : null}
        <Field label="名称" htmlFor="agent-name">
          <input
            id="agent-name"
            className="input"
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="例如：需求分析师"
            maxLength={80}
          />
        </Field>
        <Field label="角色" htmlFor="agent-role">
          <input
            id="agent-role"
            className="input"
            value={form.role}
            onChange={(event) => update({ role: event.target.value })}
            placeholder="例如：需求分析"
            maxLength={80}
          />
        </Field>
        <Field label="简介" htmlFor="agent-description" className="span-2">
          <textarea
            id="agent-description"
            className="textarea"
            value={form.description}
            onChange={(event) => update({ description: event.target.value })}
            placeholder="这个 Agent 负责什么、边界在哪里"
            maxLength={1000}
          />
        </Field>
        <Field label="系统提示词" htmlFor="agent-prompt" className="span-2">
          <textarea
            id="agent-prompt"
            className="textarea"
            value={form.systemPrompt}
            onChange={(event) => update({ systemPrompt: event.target.value })}
            placeholder="稳定的角色约束，例如：结论先行，不确定的信息标注“待确认”。"
            maxLength={30_000}
          />
        </Field>
        <Field label="模型" htmlFor="agent-model" hint="新建时留空则跟随默认模型。">
          <select
            id="agent-model"
            className="select"
            value={form.modelId ?? ''}
            onChange={(event) => update({ modelId: event.target.value })}
          >
            {!agent && (form.modelId ?? '') === '' ? (
              <option value="">跟随默认模型</option>
            ) : null}
            {(models.data ?? [])
              .filter((model) => model.status === 'ACTIVE' || model.id === form.modelId)
              .map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}（{MODEL_PROVIDER_LABELS[model.provider]} · {model.modelId}）
                </option>
              ))}
          </select>
        </Field>
        <Field label="状态" htmlFor="agent-status">
          <select
            id="agent-status"
            className="select"
            value={form.status}
            onChange={(event) =>
              update({ status: event.target.value === 'DISABLED' ? 'DISABLED' : 'ACTIVE' })
            }
          >
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">停用</option>
          </select>
        </Field>
      </form>
    </Modal>
  );
}
