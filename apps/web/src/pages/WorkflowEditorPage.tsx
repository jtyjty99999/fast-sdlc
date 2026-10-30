import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WORKFLOW_STATUSES,
  WORKFLOW_STATUS_LABELS,
  type GateMode,
  type WorkflowInput,
  type WorkflowStatus,
  type WorkflowStepInput,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
} from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { Field } from '../components/ui/Field';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/Toast';

interface StepDraft {
  stepKey: string;
  name: string;
  agentId: string;
  instructionMd: string;
  dependsOn: string[];
  gateMode: GateMode;
  timeoutSeconds: number;
}

interface MetaDraft {
  name: string;
  description: string;
  scenario: string;
  tagsText: string;
  keywordsText: string;
  status: WorkflowStatus;
}

const EMPTY_META: MetaDraft = {
  name: '',
  description: '',
  scenario: '',
  tagsText: '',
  keywordsText: '',
  status: 'DRAFT',
};

function splitList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function nextStepKey(steps: readonly StepDraft[]): string {
  const used = new Set(steps.map((step) => step.stepKey));
  let index = steps.length + 1;
  while (used.has(`step-${index}`)) index += 1;
  return `step-${index}`;
}

function createDraft(stepKey: string, agentId: string, dependsOn: string[] = []): StepDraft {
  return {
    stepKey,
    name: '',
    agentId,
    instructionMd: '',
    dependsOn,
    gateMode: 'NONE',
    timeoutSeconds: 300,
  };
}

function localIssues(meta: MetaDraft, steps: readonly StepDraft[]): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  if (!meta.name.trim()) {
    issues.push({ level: 'ERROR', code: 'NAME_EMPTY', message: '工作流名称不能为空。' });
  }
  if (!meta.scenario.trim()) {
    issues.push({ level: 'ERROR', code: 'SCENARIO_EMPTY', message: '必须填写场景，用于任务匹配。' });
  }
  steps.forEach((step, index) => {
    if (!step.name.trim()) {
      issues.push({
        level: 'ERROR',
        code: 'STEP_NAME_EMPTY',
        message: `第 ${index + 1} 个步骤缺少名称。`,
        stepKey: step.stepKey,
      });
    }
    if (!step.agentId) {
      issues.push({
        level: 'ERROR',
        code: 'AGENT_MISSING',
        message: `步骤「${step.name || index + 1}」未选择 Agent。`,
        stepKey: step.stepKey,
      });
    }
    for (const dependency of step.dependsOn) {
      if (!steps.some((candidate) => candidate.stepKey === dependency)) {
        issues.push({
          level: 'ERROR',
          code: 'DEP_MISSING',
          message: `步骤「${step.name || index + 1}」依赖了不存在的步骤 ${dependency}。`,
          stepKey: step.stepKey,
        });
      }
    }
  });
  return issues;
}

export function WorkflowEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.agents.list() });
  const workflow = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api.workflows.get(id ?? ''),
    enabled: !isNew && Boolean(id),
  });

  const [meta, setMeta] = useState<MetaDraft>(EMPTY_META);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isNew || !workflow.data) return;
    setMeta({
      name: workflow.data.name,
      description: workflow.data.description,
      scenario: workflow.data.scenario,
      tagsText: workflow.data.tags.join('、'),
      keywordsText: workflow.data.matchKeywords.join('、'),
      status: workflow.data.status,
    });
    const drafts = workflow.data.steps
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((step) => ({
        stepKey: step.stepKey,
        name: step.name,
        agentId: step.agentId,
        instructionMd: step.instructionMd,
        dependsOn: step.dependsOn,
        gateMode: step.gateMode,
        timeoutSeconds: step.timeoutSeconds,
      }));
    setSteps(drafts);
    setSelectedKey(drafts[0]?.stepKey ?? null);
    setValidation(null);
  }, [isNew, workflow.data]);

  useEffect(() => {
    if (!isNew || steps.length > 0 || !agents.data || agents.data.length === 0) return;
    const first = agents.data.find((agent) => agent.status === 'ACTIVE') ?? agents.data[0];
    if (!first) return;
    const draft = createDraft('step-1', first.id);
    setSteps([draft]);
    setSelectedKey(draft.stepKey);
  }, [isNew, agents.data, steps.length]);

  const save = useMutation({
    mutationFn: (input: WorkflowInput) =>
      isNew || !id ? api.workflows.create(input) : api.workflows.update(id, input),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['workflow', result.id] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success(isNew ? '工作流已创建' : '工作流已保存');
      setSelectedKey(null);
      navigate(`/workflows/${result.id}`, { replace: isNew });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => api.workflows.remove(id ?? ''),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success('工作流已删除');
      navigate('/workflows');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const validate = useMutation({
    mutationFn: () => api.workflows.validate(id ?? ''),
    onSuccess: (result) => {
      setValidation(result);
      if (result.valid) {
        toast.success('校验通过');
      } else {
        toast.error('校验发现错误，请查看问题列表');
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const selected = useMemo(
    () => steps.find((step) => step.stepKey === selectedKey) ?? null,
    [steps, selectedKey],
  );

  const updateStep = (key: string, patch: Partial<StepDraft>): void => {
    setSteps((current) =>
      current.map((step) => (step.stepKey === key ? { ...step, ...patch } : step)),
    );
    setValidation(null);
  };

  const addStep = (): void => {
    const agent = agents.data?.find((item) => item.status === 'ACTIVE') ?? agents.data?.[0];
    if (!agent) {
      toast.error('请先到 Agents 页面创建至少一个 Agent');
      return;
    }
    const last = steps[steps.length - 1];
    const draft = createDraft(nextStepKey(steps), agent.id, last ? [last.stepKey] : []);
    setSteps((current) => [...current, draft]);
    setSelectedKey(draft.stepKey);
    setValidation(null);
  };

  const removeStep = (key: string): void => {
    if (steps.length <= 1) {
      toast.error('工作流至少需要一个步骤');
      return;
    }
    const next = steps
      .filter((step) => step.stepKey !== key)
      .map((step) => ({
        ...step,
        dependsOn: step.dependsOn.filter((dependency) => dependency !== key),
      }));
    setSteps(next);
    if (selectedKey === key) setSelectedKey(next[0]?.stepKey ?? null);
    setValidation(null);
  };

  const moveStep = (key: string, offset: number): void => {
    const index = steps.findIndex((step) => step.stepKey === key);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= steps.length) return;
    const next = steps.slice();
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    setSteps(next);
    setValidation(null);
  };

  const submit = (): void => {
    setFormError(null);
    const issues = localIssues(meta, steps);
    if (issues.some((issue) => issue.level === 'ERROR')) {
      setValidation({ valid: false, issues });
      setFormError('请先修复校验问题再保存。');
      return;
    }
    const payload: WorkflowInput = {
      name: meta.name,
      description: meta.description,
      scenario: meta.scenario,
      tags: splitList(meta.tagsText),
      matchKeywords: splitList(meta.keywordsText),
      status: meta.status,
      steps: steps.map<WorkflowStepInput>((step, index) => ({
        stepKey: step.stepKey,
        name: step.name,
        agentId: step.agentId,
        instructionMd: step.instructionMd,
        dependsOn: step.dependsOn,
        orderIndex: index,
        gateMode: step.gateMode,
        timeoutSeconds: step.timeoutSeconds,
      })),
    };
    save.mutate(payload);
  };

  const runValidate = (): void => {
    const issues = localIssues(meta, steps);
    if (issues.some((issue) => issue.level === 'ERROR')) {
      setValidation({ valid: false, issues });
      return;
    }
    if (isNew) {
      setValidation({ valid: true, issues: [] });
      toast.success('本地校验通过，保存后由服务端再次校验');
      return;
    }
    validate.mutate();
  };

  if (!isNew && workflow.isLoading) return <LoadingBlock label="加载工作流…" />;
  if (!isNew && workflow.isError) return <ErrorBlock message={errorMessage(workflow.error)} />;
  if (!isNew && !workflow.data) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/workflows">工作流</Link> / {isNew ? '新建' : '编排'}
          </div>
          <h1 className="row" style={{ gap: 9 }}>
            {meta.name || '未命名工作流'}
            {!isNew && workflow.data ? <StatusBadge status={workflow.data.status} plain /> : null}
          </h1>
          <div className="sub">
            {meta.scenario || '尚未填写场景'} · {steps.length} 个步骤
            {!isNew && workflow.data ? ` · 更新于 ${workflow.data.updatedAt.slice(0, 10)}` : ''}
          </div>
        </div>
        <div className="row">
          {!isNew ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              删除
            </Button>
          ) : null}
          <Button onClick={runValidate} disabled={validate.isPending}>
            {validate.isPending ? '校验中…' : '校验'}
          </Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            {save.isPending ? '保存中…' : '保存工作流'}
          </Button>
        </div>
      </div>

      {formError ? <div className="issue issue-error">{formError}</div> : null}
      {validation ? (
        <div className="issue-list">
          {validation.issues.length === 0 ? (
            <div className="issue issue-ok">
              <span className="issue-lv">OK</span>
              <span>校验通过：依赖完整、无环，所有步骤都已绑定 Agent。</span>
            </div>
          ) : (
            validation.issues.map((issue, index) => (
              <div
                key={`${issue.code}-${issue.stepKey ?? index}`}
                className={`issue ${issue.level === 'ERROR' ? 'issue-error' : 'issue-warning'}`}
              >
                <span className="issue-lv">{issue.level === 'ERROR' ? 'ERR' : 'WARN'}</span>
                <span>
                  {issue.message}
                  {issue.stepKey ? `（${issue.stepKey}）` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>基础信息</h2>
          <span className="small muted">场景 + 关键词决定任务自动匹配的结果</span>
        </div>
        <div className="editor-meta">
          <Field label="名称" htmlFor="wf-name">
            <input
              id="wf-name"
              className="input"
              value={meta.name}
              onChange={(event) => setMeta({ ...meta, name: event.target.value })}
              placeholder="例如：新功能开发"
              maxLength={120}
            />
          </Field>
          <Field label="场景" htmlFor="wf-scenario">
            <input
              id="wf-scenario"
              className="input"
              value={meta.scenario}
              onChange={(event) => setMeta({ ...meta, scenario: event.target.value })}
              placeholder="例如：功能开发"
              maxLength={80}
            />
          </Field>
          <Field label="状态" htmlFor="wf-status">
            <select
              id="wf-status"
              className="select"
              value={meta.status}
              onChange={(event) =>
                setMeta({ ...meta, status: event.target.value as WorkflowStatus })
              }
            >
              {WORKFLOW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {WORKFLOW_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="描述" htmlFor="wf-desc" className="span-all">
            <input
              id="wf-desc"
              className="input"
              value={meta.description}
              onChange={(event) => setMeta({ ...meta, description: event.target.value })}
              placeholder="这条流水线解决什么问题"
              maxLength={2000}
            />
          </Field>
          <Field label="标签（逗号分隔）" htmlFor="wf-tags">
            <input
              id="wf-tags"
              className="input"
              value={meta.tagsText}
              onChange={(event) => setMeta({ ...meta, tagsText: event.target.value })}
              placeholder="开发、评审"
            />
          </Field>
          <Field label="匹配关键词（逗号分隔）" htmlFor="wf-keywords" className="span-2">
            <input
              id="wf-keywords"
              className="input"
              value={meta.keywordsText}
              onChange={(event) => setMeta({ ...meta, keywordsText: event.target.value })}
              placeholder="新功能、接口、迭代"
            />
          </Field>
        </div>
      </section>

      {agents.isError ? (
        <ErrorBlock message={`加载 Agent 失败：${errorMessage(agents.error)}`} />
      ) : !agents.isLoading && (agents.data ?? []).length === 0 ? (
        <EmptyState
          icon="◉"
          title="还没有可用的 Agent"
          description="编排步骤前，需要先创建至少一个 Agent。"
          action={
            <Link className="btn btn-primary" to="/agents?new=1">
              创建 Agent
            </Link>
          }
        />
      ) : (
        <div className="editor-grid">
          <section className="editor-col">
            <div className="editor-col-head">
              <span>Steps · {steps.length}</span>
              <button className="btn btn-ghost btn-sm" onClick={addStep}>
                + 步骤
              </button>
            </div>
            <div className="step-list">
              {steps.map((step, index) => (
                <button
                  key={step.stepKey}
                  className={`step-row${selectedKey === step.stepKey ? ' selected' : ''}`}
                  onClick={() => setSelectedKey(step.stepKey)}
                >
                  <span className="sr-idx">{String(index + 1).padStart(2, '0')}</span>
                  <span className="sr-name">{step.name || '未命名步骤'}</span>
                  {step.gateMode === 'HUMAN_APPROVAL' ? (
                    <span className="sr-gate" title="人工审批卡点">
                      ◆
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>

          <section className="editor-col">
            <div className="editor-col-head">
              <span>Pipeline</span>
              <span>DAG READY</span>
            </div>
            <div className="pipeline">
              {steps.map((step, index) => {
                const agent = agents.data?.find((item) => item.id === step.agentId);
                return (
                  <div key={step.stepKey}>
                    <button
                      className={`pipe-node${selectedKey === step.stepKey ? ' selected' : ''}`}
                      onClick={() => setSelectedKey(step.stepKey)}
                      style={{ display: 'block', width: '100%', textAlign: 'left' }}
                    >
                      <div className="pn-top">
                        <span className="pn-idx">{String(index + 1).padStart(2, '0')}</span>
                        <span className="pn-name">{step.name || '未命名步骤'}</span>
                        {step.gateMode === 'HUMAN_APPROVAL' ? (
                          <span className="sr-gate" title="人工审批卡点">
                            ◆
                          </span>
                        ) : null}
                      </div>
                      <div className="pn-agent">
                        ◎ {agent?.name ?? '未选择 Agent'} · {agent?.role ?? '—'}
                      </div>
                      {step.dependsOn.length > 0 ? (
                        <div className="pn-agent">依赖：{step.dependsOn.join('、')}</div>
                      ) : null}
                      <div className="pn-instruction">
                        {step.instructionMd || '尚未填写本步骤产出要求'}
                      </div>
                    </button>
                    {index < steps.length - 1 ? <div className="pipe-connector" /> : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="editor-col">
            <div className="editor-col-head">
              <span>Inspector</span>
              {selected ? <span>{selected.stepKey}</span> : <span>—</span>}
            </div>
            {!selected ? (
              <div className="inspector-empty">选择左侧或中间的步骤开始编辑。</div>
            ) : (
              <div className="inspector">
                <Field label="步骤名称" htmlFor="step-name">
                  <input
                    id="step-name"
                    className="input"
                    value={selected.name}
                    onChange={(event) =>
                      updateStep(selected.stepKey, { name: event.target.value })
                    }
                    placeholder="例如：架构设计"
                    maxLength={120}
                  />
                </Field>
                <Field label="执行 Agent" htmlFor="step-agent">
                  <select
                    id="step-agent"
                    className="select"
                    value={selected.agentId}
                    onChange={(event) =>
                      updateStep(selected.stepKey, { agentId: event.target.value })
                    }
                  >
                    {(agents.data ?? []).map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                        {agent.status === 'DISABLED' ? '（已停用）' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="产出要求（Markdown）" htmlFor="step-instruction">
                  <textarea
                    id="step-instruction"
                    className="textarea textarea-code"
                    style={{ minHeight: 150 }}
                    value={selected.instructionMd}
                    onChange={(event) =>
                      updateStep(selected.stepKey, { instructionMd: event.target.value })
                    }
                    placeholder="描述本步骤需要交付什么、遵循什么约束。"
                    maxLength={30_000}
                  />
                </Field>
                <Field
                  label="依赖步骤"
                  hint="所有依赖成功后才进入就绪队列；留空表示可立即执行。"
                >
                  <div className="stack" style={{ gap: 5 }}>
                    {steps.filter((step) => step.stepKey !== selected.stepKey).length === 0 ? (
                      <span className="small muted">暂无其他步骤</span>
                    ) : (
                      steps
                        .filter((step) => step.stepKey !== selected.stepKey)
                        .map((step) => (
                          <label className="checkbox-row" key={step.stepKey}>
                            <input
                              type="checkbox"
                              checked={selected.dependsOn.includes(step.stepKey)}
                              onChange={(event) => {
                                const next = event.target.checked
                                  ? [...selected.dependsOn, step.stepKey]
                                  : selected.dependsOn.filter(
                                      (dependency) => dependency !== step.stepKey,
                                    );
                                updateStep(selected.stepKey, { dependsOn: next });
                              }}
                            />
                            <span>
                              <span className="cr-title">
                                {step.name || step.stepKey}
                              </span>
                              <span className="cr-desc">{step.stepKey}</span>
                            </span>
                          </label>
                        ))
                    )}
                  </div>
                </Field>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={selected.gateMode === 'HUMAN_APPROVAL'}
                    onChange={(event) =>
                      updateStep(selected.stepKey, {
                        gateMode: event.target.checked ? 'HUMAN_APPROVAL' : 'NONE',
                      })
                    }
                  />
                  执行完成后等待人工审批
                </label>
                <Field label="超时（秒）" htmlFor="step-timeout">
                  <input
                    id="step-timeout"
                    className="input"
                    type="number"
                    min={10}
                    max={3600}
                    value={selected.timeoutSeconds}
                    onChange={(event) =>
                      updateStep(selected.stepKey, {
                        timeoutSeconds: Math.min(
                          3600,
                          Math.max(10, Number(event.target.value) || 10),
                        ),
                      })
                    }
                  />
                </Field>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <Button size="sm" onClick={() => moveStep(selected.stepKey, -1)}>
                    ↑ 上移
                  </Button>
                  <Button size="sm" onClick={() => moveStep(selected.stepKey, 1)}>
                    ↓ 下移
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => removeStep(selected.stepKey)}>
                    删除步骤
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="删除工作流"
        description={`确定删除「${meta.name}」？已有任务引用时服务端会拒绝删除。`}
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
