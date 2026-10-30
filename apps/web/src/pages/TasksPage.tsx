import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';
import { TaskCreateModal } from '../components/TaskCreateModal';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Tabs } from '../components/ui/Tabs';

type StatusTab = 'ALL' | (typeof TASK_STATUSES)[number];

const STATUS_TABS: readonly { key: StatusTab; label: string }[] = [
  { key: 'ALL', label: '全部' },
  ...TASK_STATUSES.map((status) => ({
    key: status,
    label: TASK_STATUS_LABELS[status] ?? status,
  })),
];

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusTab>('ALL');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(searchParams.get('new') === '1');
  const debouncedQuery = useDebounce(query, 300);

  const tasks = useQuery({
    queryKey: ['tasks', status, debouncedQuery],
    queryFn: () =>
      api.tasks.list({
        status: status === 'ALL' ? undefined : status,
        q: debouncedQuery || undefined,
      }),
    refetchInterval: 5000,
  });

  const closeCreate = (): void => {
    setCreating(false);
    if (searchParams.has('new')) {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Work items</div>
          <h1>任务</h1>
          <div className="sub">输入场景与目标，匹配工作流并交给 Agent 团队执行。</div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + 新建任务
        </Button>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索任务标题或描述"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索任务"
          />
        </div>
        <span className="small muted">
          {tasks.data ? `${tasks.data.length} 个任务` : ''}
          {tasks.isFetching && tasks.data ? ' · 刷新中…' : ''}
        </span>
      </div>

      <Tabs items={STATUS_TABS} value={status} onChange={setStatus} />

      {tasks.isLoading ? (
        <LoadingBlock label="加载任务…" />
      ) : tasks.isError ? (
        <ErrorBlock message={errorMessage(tasks.error)} />
      ) : (tasks.data ?? []).length === 0 ? (
        <EmptyState
          icon="☰"
          title={query || status !== 'ALL' ? '没有匹配的任务' : '还没有任务'}
          description={
            query || status !== 'ALL'
              ? '调整筛选条件或搜索关键词。'
              : '创建第一个任务，系统会推荐匹配的工作流并实时展示执行过程。'
          }
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              新建任务
            </Button>
          }
        />
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>场景</th>
                  <th>工作流</th>
                  <th>状态</th>
                  <th>当前步骤</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {tasks.data?.map((task) => (
                  <tr key={task.id}>
                    <td className="td-title">
                      <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                    </td>
                    <td className="muted">{task.scenario || '—'}</td>
                    <td className="muted">{task.workflowName}</td>
                    <td>
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="muted">
                      {task.currentStepName ??
                        (task.status === 'QUEUED' ? '待启动' : '—')}
                    </td>
                    <td className="muted mono small">{formatDate(task.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <TaskCreateModal open={creating} onClose={closeCreate} />
    </div>
  );
}
