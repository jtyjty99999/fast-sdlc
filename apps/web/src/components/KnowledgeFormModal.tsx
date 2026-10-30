import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KNOWLEDGE_TYPES,
  KNOWLEDGE_TYPE_LABELS,
  type KnowledgeInput,
  type KnowledgeItem,
  type KnowledgeType,
} from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { useToast } from './ui/Toast';

interface KnowledgeFormModalProps {
  open: boolean;
  item?: KnowledgeItem | null;
  onClose: () => void;
}

interface FormState {
  title: string;
  type: KnowledgeType;
  contentMd: string;
  tagsText: string;
}

const EMPTY: FormState = { title: '', type: 'RULE', contentMd: '', tagsText: '' };

function parseTags(text: string): string[] {
  const tags = text
    .split(/[,，、]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

export function KnowledgeFormModal({ open, item, onClose }: KnowledgeFormModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      item
        ? {
            title: item.title,
            type: item.type,
            contentMd: item.contentMd,
            tagsText: item.tags.join('、'),
          }
        : EMPTY,
    );
  }, [open, item]);

  const mutation = useMutation({
    mutationFn: (input: KnowledgeInput) =>
      item ? api.knowledge.update(item.id, input) : api.knowledge.create(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success(item ? '知识条目已更新' : '知识条目已创建');
      onClose();
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    if (!form.title.trim() || !form.contentMd.trim()) {
      setError('标题与正文为必填项。');
      return;
    }
    mutation.mutate({
      title: form.title,
      type: form.type,
      contentMd: form.contentMd,
      tags: parseTags(form.tagsText),
    });
  };

  return (
    <Modal
      open={open}
      title={item ? '编辑知识' : '新建知识'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? '保存中…' : '保存知识'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        {error ? <div className="form-error span-2">{error}</div> : null}
        <Field label="标题" htmlFor="knowledge-title">
          <input
            id="knowledge-title"
            className="input"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="例如：项目宪法"
            maxLength={120}
          />
        </Field>
        <Field label="类型" htmlFor="knowledge-type">
          <select
            id="knowledge-type"
            className="select"
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value as KnowledgeType })}
          >
            {KNOWLEDGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {KNOWLEDGE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="标签（逗号分隔）" htmlFor="knowledge-tags" className="span-2">
          <input
            id="knowledge-tags"
            className="input"
            value={form.tagsText}
            onChange={(event) => setForm({ ...form, tagsText: event.target.value })}
            placeholder="规范、审计、安全"
          />
        </Field>
        <Field label="正文（Markdown）" htmlFor="knowledge-content" className="span-2">
          <textarea
            id="knowledge-content"
            className="textarea textarea-code"
            style={{ minHeight: 220 }}
            value={form.contentMd}
            onChange={(event) => setForm({ ...form, contentMd: event.target.value })}
            placeholder="把团队必须遵守的规则、术语或历史经验写清楚。"
            maxLength={100_000}
          />
        </Field>
      </form>
    </Modal>
  );
}
