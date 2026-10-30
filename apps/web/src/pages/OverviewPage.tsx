import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { formatDate, statusLabel } from '../lib/format';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { StatusBadge } from '../components/ui/StatusBadge';

export function OverviewPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview });

  if (overview.isLoading) return <LoadingBlock label="加载总览数据…" />;
  if (overview.isError) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>总览</h1>
            <div className="sub">观察 Agent、工作流与任务的整体运行情况。</div>
          </div>
        </div>
        <ErrorBlock message={errorMessage(overview.error)} />
      </div>
    );
  }

  const data = overview.data;
  if (!data) return null;
  const { counts } = data;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Workspace overview</div>
          <h1>总览</h1>
          <div className="sub">
            所有数字来自本地 SQLite。执行器：{data.executor.label}
          </div>
        </div>
        <div className="row">
          <Link className="btn btn-primary" to="/tasks?new=1">
            + 新建任务
          </Link>
          <Link className="btn" to="/workflows/new">
            编排工作流
          </Link>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi accent">
          <div className="kpi-k">Agents</div>
          <div className="kpi-v">{counts.agents}</div>
          <div className="kpi-sub">角色化数字员工</div>
        </div>
        <div className="kpi skill">
          <div className="kpi-k">Skills</div>
          <div className="kpi-v">{counts.skills}</div>
          <div className="kpi-sub">可挂载技能包</div>
        </div>
        <div className="kpi know">
          <div className="kpi-k">知识</div>
          <div className="kpi-v">{counts.knowledge}</div>
          <div className="kpi-sub">规范 / 业务 / 经验</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">工作流</div>
          <div className="kpi-v">
            {counts.enabledWorkflows}
            <small>/ {counts.workflows}</small>
          </div>
          <div className="kpi-sub">已启用 / 总数</div>
        </div>
        <div className="kpi hook">
          <div className="kpi-k">任务</div>
          <div className="kpi-v">{counts.tasks}</div>
          <div className="kpi-sub">
            {counts.runningTasks} 个进行中 · {counts.succeededTasks} 个成功
          </div>
        </div>
        <div className="kpi skill">
          <div className="kpi-k">成功率</div>
          <div className="kpi-v">
            {counts.terminalTasks === 0 ? '—' : counts.successRate}
            {counts.terminalTasks === 0 ? null : <small>%</small>}
          </div>
          <div className="kpi-sub">{counts.terminalTasks} 个已结束任务</div>
        </div>
      </div>

      <div className="overview-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>最近任务</h2>
            <Link className="small" to="/tasks">
              查看全部 →
            </Link>
          </div>
          {data.recentTasks.length === 0 ? (
            <EmptyState
              icon="☰"
              title="还没有任务"
              description="输入一个任务描述，系统会推荐匹配的工作流并执行。"
              action={
                <Link className="btn btn-primary" to="/tasks?new=1">
                  创建第一个任务
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>工作流</th>
                    <th>状态</th>
                    <th>当前步骤</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTasks.map((task) => (
                    <tr key={task.id}>
                      <td className="td-title">
                        <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                      </td>
                      <td className="muted">{task.workflowName}</td>
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="muted">
                        {task.currentStepName ?? (task.status === 'QUEUED' ? '待启动' : '—')}
                      </td>
                      <td className="muted mono small">{formatDate(task.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>执行器</h2>
            </div>
            <div className="panel-body">
              <div className="row-between">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{data.executor.label}</div>
                  <div className="small muted" style={{ marginTop: 3 }}>
                    模型：<span className="mono">{data.executor.model}</span>
                  </div>
                </div>
                <span className={`badge badge-${data.executor.kind === 'mock' ? 'queued' : 'succeeded'}`}>
                  {data.executor.kind === 'mock' ? 'Mock' : 'LLM'}
                </span>
              </div>
              <p className="small muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
                {data.executor.kind === 'mock'
                  ? '当前使用内置模拟执行器，每个角色会生成结构化 Markdown 产物。设置 ANTHROPIC_API_KEY 后可切换真实模型。'
                  : '当前使用 Anthropic 真实模型执行步骤，密钥仅存在于服务端环境变量中。'}
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>快速开始</h2>
            </div>
            <div className="panel-body">
              <div className="quick-actions">
                <Link className="quick-action" to="/agents?new=1">
                  <span className="qa-ic">◉</span>
                  <span>
                    <div className="qa-t">创建 Agent</div>
                    <div className="qa-d">定义角色，并挂载技能与知识</div>
                  </span>
                </Link>
                <Link className="quick-action" to="/workflows/new">
                  <span className="qa-ic">⇄</span>
                  <span>
                    <div className="qa-t">编排工作流</div>
                    <div className="qa-d">把任务拆给多个 Agent 依次执行</div>
                  </span>
                </Link>
                <Link className="quick-action" to="/tasks?new=1">
                  <span className="qa-ic">☰</span>
                  <span>
                    <div className="qa-t">发起任务</div>
                    <div className="qa-d">按场景匹配工作流并实时观察</div>
                  </span>
                </Link>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>最近任务状态</h2>
            </div>
            <div className="panel-body">
              {data.recentTasks.length === 0 ? (
                <span className="small muted">暂无任务数据。</span>
              ) : (
                <div className="stack" style={{ gap: 7 }}>
                  {data.recentTasks.slice(0, 4).map((task) => (
                    <div className="row-between" key={task.id}>
                      <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {task.title}
                      </span>
                      <span className="small muted mono">{statusLabel(task.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
