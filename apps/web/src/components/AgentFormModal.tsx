import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Agent, AgentInput } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { useToast } from './ui/Toast';

const DEFAULT_MODEL = 'claude-sonnet-5';

interface AgentFormModalProps {
  open: boolean;
  agent?: Agent | null;
  onClose: () => void;
  onSaved?: (agent: Agent) => void;
}

export function AgentFormModal({ open, agent, onClose, onSaved }: AgentFormModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<AgentInput>({
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    model: DEFAULT_MODEL,
    status: 'ACTIVE',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      agent
        ? {
            name: agent.name,
            role: agent.role,
            description: agent.description,
            systemPrompt: agent.systemPrompt,
            model: agent.model,
            status: agent.status,
          }
        : {
            name: '',
            role: '',
            description: '',
            systemPrompt: '',
            model: DEFAULT_MODEL,
            status: 'ACTIVE',
          },
    );
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
    mutation.mutate(form);
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
        <Field label="模型" htmlFor="agent-model">
          <input
            id="agent-model"
            className="input"
            value={form.model}
            onChange={(event) => update({ model: event.target.value })}
            maxLength={120}
          />
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
