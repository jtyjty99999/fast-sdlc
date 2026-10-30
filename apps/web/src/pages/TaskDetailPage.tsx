import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_TYPES,
  type ApprovalDecision,
  type RunEvent,
  type StepRun,
} from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import {
  formatDate,
  formatDuration,
  isActiveTask,
  statusLabel,
} from '../lib/format';
import { Markdown } from '../components/ui/Markdown';
import { ApprovalBanner } from '../components/ApprovalBanner';
import { ContextPreview } from '../components/ContextPreview';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Stepper } from '../components/ui/Stepper';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';

type DetailTab = 'output' | 'context' | 'events' | 'meta';

const TAB_ITEMS = [
  { key: 'output' as const, label: '产物' },
  { key: 'context' as const, label: '输入上下文' },
  { key: 'events' as const, label: '事件' },
  { key: 'meta' as const, label: '元数据' },
];

function dotClass(status: string): string {
  if (status === 'SUCCEEDED' || status === 'SKIPPED') return 'succeeded';
  if (status === 'RUNNING' || status === 'READY') return 'running';
  if (status === 'WAITING_APPROVAL') return 'waiting';
  if (status === 'FAILED') return 'failed';
  return '';
}

function eventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function eventText(event: RunEvent): string {
  if (event.message) return event.message;
  const text = event.payload.text;
  return typeof text === 'string' ? text : '';
}

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();

  const task = useQuery({
    queryKey: ['task', id],
    queryFn: () => api.tasks.get(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && isActiveTask(data.task.status) ? 5000 : false;
    },
  });

  const [tab, setTab] = useState<DetailTab>('output');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [liveText, setLiveText] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const detail = task.data;
  const run = detail?.run ?? null;
  const runId = run?.id ?? null;
  const steps = run?.steps ?? [];

  useEffect(() => {
    if (!run) return;
    setSelectedStepId((current) => {
      if (current && run.steps.some((step) => step.id === current)) return current;
      const active =
        run.steps.find((step) => step.status === 'WAITING_APPROVAL') ??
        run.steps.find((step) => step.status === 'RUNNING') ??
        run.steps[0];
      return active?.id ?? null;
    });
  }, [run]);

  useEffect(() => {
    setEvents([]);
    setLiveText({});
    setConnected(false);
    if (!runId) return undefined;

    const source = new EventSource(`/api/runs/${runId}/stream`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const handle = (message: Event): void => {
      let event: RunEvent;
      try {
        event = JSON.parse((message as MessageEvent).data as string) as RunEvent;
      } catch {
        return;
      }
      setEvents((current) =>
        current.some((item) => item.id === event.id) ? current : [...current, event],
      );

      const stepRunId = event.stepRunId;
      if (event.type === 'STEP_DELTA' && stepRunId) {
        const text = typeof event.payload.text === 'string' ? event.payload.text : '';
        if (text) {
          setLiveText((current) => ({
            ...current,
            [stepRunId]: `${current[stepRunId] ?? ''}${text}`,
          }));
        }
        return;
      }
      if (event.type === 'STEP_OUTPUT' && stepRunId) {
        setLiveText((current) => {
          if (!(stepRunId in current)) return current;
          const next = { ...current };
          delete next[stepRunId];
          return next;
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['task', id] });
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, handle);
    }
    return () => {
      source.close();
      setConnected(false);
    };
  }, [runId, id, queryClient]);

  useEffect(() => {
    if (tab !== 'events') return;
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events.length, tab]);

  const invalidateAll = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task', id] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);
  };

  const start = useMutation({
    mutationFn: () => api.tasks.run(id),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('任务已启动');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: () => api.tasks.cancel(id),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('任务已取消');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const approve = useMutation({
    mutationFn: (input: { runId: string; stepRunId: string; decision: ApprovalDecision }) =>
      api.runs.approve(input.runId, input.stepRunId, {
        decision: input.decision,
        comment,
      }),
    onSuccess: async (_result, input) => {
      setComment('');
      await invalidateAll();
      toast.success(input.decision === 'APPROVED' ? '审批已通过' : '审批已驳回');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const selectedStep = useMemo(
    () => steps.find((step) => step.id === selectedStepId) ?? null,
    [steps, selectedStepId],
  );

  const pendingStep = useMemo(
    () => steps.find((step) => step.approval?.status === 'PENDING') ?? null,
    [steps],
  );

  if (task.isLoading) return <LoadingBlock label="加载任务…" />;
  if (task.isError) return <ErrorBlock message={errorMessage(task.error)} />;
  if (!detail) return null;

  const active = isActiveTask(detail.task.status);
  const canRun = !active && detail.workflow?.status === 'ENABLED';
  const canCancel = active && run !== null;

  const renderStepOutput = (step: StepRun) => {
    const live = liveText[step.id];
    if (live && step.status === 'RUNNING') {
      return (
        <div className="live-output">
          <div className="live-label">
            <span className="dot" /> 实时输出
          </div>
          <Markdown content={live} />
        </div>
      );
    }
    if (step.outputMd) return <Markdown content={step.outputMd} />;
    if (step.error) {
      return (
        <div className="issue issue-error">
          <span className="issue-lv">ERR</span>
          <span>{step.error}</span>
        </div>
      );
    }
    return (
      <div className="empty" style={{ padding: 30 }}>
        <div className="empty-desc">
          {step.status === 'PENDING' || step.status === 'READY'
            ? '该步骤尚未开始，产物生成后会显示在这里。'
            : '该步骤没有可显示的产物。'}
        </div>
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="task-head">
        <div>
          <div className="eyebrow">
            <Link to="/tasks">任务</Link> / {detail.task.scenario || '未分类'}
          </div>
          <h1>{detail.task.title}</h1>
          <div className="task-meta">
            <StatusBadge status={detail.task.status} />
            {detail.workflow ? (
              <span>
                工作流{' '}
                <Link to={`/workflows/${detail.workflow.id}`}>{detail.workflow.name}</Link>
              </span>
            ) : (
              <span>工作流已不可用</span>
            )}
            {run ? <span className="mono">RUN #{run.runNumber}</span> : null}
            <span>创建于 {formatDate(detail.task.createdAt)}</span>
            {runId ? (
              <span
                className={`badge badge-${connected ? 'enabled' : 'canceled'} badge-plain`}
              >
                {connected ? 'SSE 已连接' : 'SSE 重连中'}
              </span>
            ) : null}
          </div>
        </div>
        <div className="task-actions">
          <Button onClick={() => void task.refetch()} disabled={task.isFetching}>
            {task.isFetching ? '刷新中…' : '刷新'}
          </Button>
          {canCancel ? (
            <Button
              variant="danger"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? '取消中…' : '取消任务'}
            </Button>
          ) : null}
          {canRun ? (
            <Button
              variant="primary"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              {start.isPending
                ? '启动中…'
                : detail.task.currentRunId
                  ? '重新运行'
                  : '开始运行'}
            </Button>
          ) : null}
        </div>
      </div>

      {detail.task.description ? (
        <section className="panel">
          <div className="panel-body">
            <div className="prompt-label">
              <span>任务描述</span>
            </div>
            <Markdown content={detail.task.description} />
          </div>
        </section>
      ) : null}

      {pendingStep && run ? (
        <ApprovalBanner
          stepName={pendingStep.stepName}
          comment={comment}
          busy={approve.isPending}
          onCommentChange={setComment}
          onApprove={() =>
            approve.mutate({
              runId: run.id,
              stepRunId: pendingStep.id,
              decision: 'APPROVED',
            })
          }
          onReject={() =>
            approve.mutate({
              runId: run.id,
              stepRunId: pendingStep.id,
              decision: 'REJECTED',
            })
          }
          onViewOutput={() => {
            setSelectedStepId(pendingStep.id);
            setTab('output');
          }}
        />
      ) : null}

      {run && steps.length > 0 ? (
        <div className="step-progress">
          <Stepper
            steps={steps}
            selectedId={selectedStepId}
            onSelect={(stepId) => {
              setSelectedStepId(stepId);
              setTab('output');
            }}
          />
        </div>
      ) : null}

      {!run ? (
        <EmptyState
          icon="☰"
          title="任务尚未运行"
          description={
            detail.workflow?.status === 'ENABLED'
              ? '点击右上角「开始运行」，工作流会按步骤依次调度 Agent。'
              : '关联的工作流未启用或已被删除，无法执行。'
          }
          action={
            canRun ? (
              <Button
                variant="primary"
                onClick={() => start.mutate()}
                disabled={start.isPending}
              >
                开始运行
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="task-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>步骤</h2>
              <span className="small muted">
                {run.status === 'RUNNING' ? `运行中 · ${formatDuration(run.startedAt, null)}` : statusLabel(run.status)}
              </span>
            </div>
            <div className="step-timeline">
              {steps.map((step) => (
                <button
                  key={step.id}
                  className={`timeline-item${selectedStepId === step.id ? ' selected' : ''}`}
                  onClick={() => {
                    setSelectedStepId(step.id);
                    setTab('output');
                  }}
                >
                  <span className={`tl-dot ${dotClass(step.status)}`} />
                  <span className="tl-main">
                    <span className="tl-name">
                      {step.stepName}
                      {step.gateMode === 'HUMAN_APPROVAL' ? (
                        <span className="sr-gate" title="人工审批卡点">
                          ◆
                        </span>
                      ) : null}
                    </span>
                    <span className="tl-sub">
                      {step.agentName} · {statusLabel(step.status)} ·{' '}
                      {formatDuration(step.startedAt, step.finishedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {run.error ? (
              <div className="panel-body">
                <div className="issue issue-error">
                  <span className="issue-lv">ERR</span>
                  <span>{run.error}</span>
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-head">
              <Tabs
                items={TAB_ITEMS.map((item) =>
                  item.key === 'events' ? { ...item, count: events.length } : item,
                )}
                value={tab}
                onChange={setTab}
              />
              {selectedStep ? (
                <span className="row" style={{ gap: 7 }}>
                  <span className="small muted">{selectedStep.stepName}</span>
                  <StatusBadge status={selectedStep.status} plain />
                </span>
              ) : null}
            </div>

            <div className="panel-body">
              {tab === 'output' ? (
                selectedStep ? (
                  <div className="output-pane">{renderStepOutput(selectedStep)}</div>
                ) : (
                  <span className="small muted">选择一个步骤查看产物。</span>
                )
              ) : null}

              {tab === 'context' ? (
                selectedStep?.context ? (
                  <ContextPreview
                    systemPrompt={selectedStep.context.systemPrompt}
                    userPrompt={selectedStep.context.userPrompt}
                    stats={selectedStep.context}
                  />
                ) : (
                  <span className="small muted">
                    该步骤尚未开始，运行后会记录实际发送给 Agent 的上下文快照。
                  </span>
                )
              ) : null}

              {tab === 'events' ? (
                <div className="log-list" ref={logRef}>
                  {events.length === 0 ? (
                    <div className="log-line">
                      <span className="lm">等待执行事件…</span>
                    </div>
                  ) : (
                    events.map((event) => (
                      <div
                        key={event.id}
                        className={`log-line${event.type === 'STEP_DELTA' ? ' delta' : ''}`}
                      >
                        <span className="lt">{eventTime(event.createdAt)}</span>
                        <span className="le">{event.type}</span>
                        <span className="lm">{eventText(event)}</span>
                      </div>
                    ))
                  )}
                </div>
              ) : null}

              {tab === 'meta' ? (
                <div className="stack">
                  <div>
                    <div className="prompt-label">
                      <span>运行</span>
                    </div>
                    <dl className="meta-grid">
                      <dt>Run ID</dt>
                      <dd>{run.id}</dd>
                      <dt>运行序号</dt>
                      <dd>#{run.runNumber}</dd>
                      <dt>状态</dt>
                      <dd>{run.status}</dd>
                      <dt>开始时间</dt>
                      <dd>{run.startedAt ?? '—'}</dd>
                      <dt>结束时间</dt>
                      <dd>{run.finishedAt ?? '—'}</dd>
                      <dt>错误</dt>
                      <dd>{run.error ?? '—'}</dd>
                    </dl>
                  </div>
                  {selectedStep ? (
                    <div>
                      <div className="prompt-label">
                        <span>步骤 · {selectedStep.stepName}</span>
                      </div>
                      <dl className="meta-grid">
                        <dt>Step Run ID</dt>
                        <dd>{selectedStep.id}</dd>
                        <dt>Step Key</dt>
                        <dd>{selectedStep.stepKey}</dd>
                        <dt>Agent</dt>
                        <dd>
                          {selectedStep.agentName} · {selectedStep.agentId}
                        </dd>
                        <dt>模型</dt>
                        <dd>{selectedStep.model ?? '—'}</dd>
                        <dt>尝试次数</dt>
                        <dd>{selectedStep.attempt}</dd>
                        <dt>输入 tokens</dt>
                        <dd>{selectedStep.inputTokens ?? '—'}</dd>
                        <dt>输出 tokens</dt>
                        <dd>{selectedStep.outputTokens ?? '—'}</dd>
                        <dt>开始</dt>
                        <dd>{selectedStep.startedAt ?? '—'}</dd>
                        <dt>结束</dt>
                        <dd>{selectedStep.finishedAt ?? '—'}</dd>
                        <dt>依赖</dt>
                        <dd>{selectedStep.dependsOn.join('、') || '—'}</dd>
                      </dl>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
