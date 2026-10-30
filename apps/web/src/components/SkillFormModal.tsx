import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Skill, SkillInput } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { useToast } from './ui/Toast';

interface SkillFormModalProps {
  open: boolean;
  skill?: Skill | null;
  onClose: () => void;
}

const EMPTY: SkillInput = {
  name: '',
  category: '通用',
  description: '',
  instructionsMd: '',
};

export function SkillFormModal({ open, skill, onClose }: SkillFormModalProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<SkillInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      skill
        ? {
            name: skill.name,
            category: skill.category,
            description: skill.description,
            instructionsMd: skill.instructionsMd,
          }
        : EMPTY,
    );
  }, [open, skill]);

  const mutation = useMutation({
    mutationFn: (input: SkillInput) =>
      skill ? api.skills.update(skill.id, input) : api.skills.create(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['skills'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success(skill ? 'Skill 已更新' : 'Skill 已创建');
      onClose();
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.instructionsMd.trim()) {
      setError('名称与指令内容为必填项。');
      return;
    }
    mutation.mutate(form);
  };

  return (
    <Modal
      open={open}
      title={skill ? '编辑 Skill' : '新建 Skill'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? '保存中…' : '保存 Skill'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        {error ? <div className="form-error span-2">{error}</div> : null}
        <Field label="名称" htmlFor="skill-name">
          <input
            id="skill-name"
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如：需求澄清"
            maxLength={80}
          />
        </Field>
        <Field label="分类" htmlFor="skill-category">
          <input
            id="skill-category"
            className="input"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            maxLength={40}
          />
        </Field>
        <Field label="简介" htmlFor="skill-desc" className="span-2">
          <input
            id="skill-desc"
            className="input"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="一句话说明这个技能解决什么问题"
            maxLength={1000}
          />
        </Field>
        <Field
          label="指令正文（Markdown）"
          htmlFor="skill-instructions"
          className="span-2"
          hint="会原样注入挂载该技能的 Agent 的系统提示词。"
        >
          <textarea
            id="skill-instructions"
            className="textarea textarea-code"
            style={{ minHeight: 220 }}
            value={form.instructionsMd}
            onChange={(event) => setForm({ ...form, instructionsMd: event.target.value })}
            placeholder={'## 使用方式\n1. 先确认目标与约束\n2. 再给出结构化产物'}
            maxLength={50_000}
          />
        </Field>
      </form>
    </Modal>
  );
}
