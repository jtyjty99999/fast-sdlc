import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatchCandidate, Task } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { MatchList } from './MatchList';
import { useToast } from './ui/Toast';

interface TaskCreateModalProps {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  title: string;
  description: string;
  scenario: string;
}

const EMPTY: FormState = { title: '', description: '', scenario: '' };
const MATCH_MIN_CHARS = 2;

export function TaskCreateModal({ open, onClose }: TaskCreateModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedText = useDebounce(
    `${form.title}\n${form.description}`.trim(),
    400,
  );
  const debouncedScenario = useDebounce(form.scenario.trim(), 400);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setWorkflowId(null);
    setTouched(false);
    setError(null);
  }, [open]);

  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: api.workflows.list,
    enabled: open,
  });
  const enabledWorkflows = (workflows.data ?? []).filter(
    (workflow) => workflow.status === 'ENABLED',
  );

  const canMatch = debouncedText.length >= MATCH_MIN_CHARS;
  const matches = useQuery({
    queryKey: ['task-match', debouncedText, debouncedScenario],
    queryFn: () =>
      api.workflows.match({
        text: debouncedText,
        scenario: debouncedScenario || undefined,
      }),
    enabled: open && canMatch,
    staleTime: 10_000,
    retry: false,
  });

  useEffect(() => {
    if (!open || touched) return;
    setWorkflowId(matches.data?.[0]?.workflow.id ?? null);
  }, [open, touched, matches.data]);

  const create = useMutation({
    mutationFn: async (shouldRun: boolean): Promise<Task> => {
      const task = await api.tasks.create({
        title: form.title,
        description: form.description,
        scenario: form.scenario,
        workflowId: workflowId ?? undefined,
      });
      if (!shouldRun) return task;
      const detail = await api.tasks.run(task.id);
      return detail.task;
    },
    onSuccess: async (task, shouldRun) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success(shouldRun ? '任务已创建并启动' : '任务已创建');
      onClose();
      navigate(`/tasks/${task.id}`);
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const submit = (shouldRun: boolean) => {
    setError(null);
    if (!form.title.trim()) {
      setError('请填写任务标题。');
      return;
    }
    if (!workflowId) {
      setError('请选择一个工作流。没有推荐结果时可以从下拉框手动指定。');
      return;
    }
    create.mutate(shouldRun);
  };

  const onSubmitForm = (event: FormEvent): void => {
    event.preventDefault();
    submit(false);
  };

  const selectCandidate = (candidate: MatchCandidate): void => {
    setTouched(true);
    setWorkflowId(candidate.workflow.id);
  };

  return (
    <Modal
      open={open}
      title="新建任务"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            取消
          </Button>
          <Button onClick={() => submit(false)} disabled={create.isPending}>
            仅创建
          </Button>
          <Button
            variant="primary"
            onClick={() => submit(true)}
            disabled={create.isPending}
          >
            {create.isPending ? '处理中…' : '创建并运行'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={onSubmitForm}>
        {error ? <div className="form-error span-2">{error}</div> : null}
        <Field label="标题" htmlFor="task-title" className="span-2">
          <input
            id="task-title"
            className="input"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="例如：为订单中心增加批量取消接口"
            maxLength={200}
          />
        </Field>
        <Field label="场景（可选）" htmlFor="task-scenario">
          <input
            id="task-scenario"
            className="input"
            value={form.scenario}
            onChange={(event) => setForm({ ...form, scenario: event.target.value })}
            placeholder="例如：功能开发"
            maxLength={80}
          />
        </Field>
        <Field label="描述" htmlFor="task-desc" className="span-2">
          <textarea
            id="task-desc"
            className="textarea"
            style={{ minHeight: 120 }}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="描述目标、范围与约束。系统会据此匹配工作流。"
            maxLength={30_000}
          />
        </Field>

        <div className="span-2">
          <div className="row-between">
            <span className="field-label">推荐工作流</span>
            {matches.isFetching ? <span className="small muted">匹配中…</span> : null}
          </div>
          {!canMatch ? (
            <div className="match-empty">
              输入至少 {MATCH_MIN_CHARS} 个字符后，系统会按场景、关键词与标签推荐工作流。
            </div>
          ) : matches.isError ? (
            <div className="match-empty">匹配失败：{errorMessage(matches.error)}</div>
          ) : (
            <MatchList
              candidates={matches.data ?? []}
              selectedId={workflowId}
              onSelect={selectCandidate}
            />
          )}
        </div>

        <Field label="指定工作流" htmlFor="task-workflow" className="span-2">
          <select
            id="task-workflow"
            className="select"
            value={workflowId ?? ''}
            onChange={(event) => {
              setTouched(true);
              setWorkflowId(event.target.value || null);
            }}
          >
            <option value="">请选择工作流…</option>
            {enabledWorkflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name} · {workflow.scenario}（{workflow.stepCount} 步）
              </option>
            ))}
          </select>
        </Field>
        {!workflows.isLoading && enabledWorkflows.length === 0 ? (
          <div className="form-error span-2">
            当前没有已启用的工作流。请先到「工作流」页面创建并启用一条流水线。
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
