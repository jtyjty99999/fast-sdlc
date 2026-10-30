import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Agent } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { initials } from '../lib/format';
import { AgentFormModal } from '../components/AgentFormModal';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { useToast } from '../components/ui/Toast';

export function AgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(searchParams.get('new') === '1');
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const agents = useQuery({
    queryKey: ['agents', query],
    queryFn: () => api.agents.list(query || undefined),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.agents.remove(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success('Agent 已删除');
      setDeleting(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const closeCreate = (): void => {
    setCreating(false);
    if (searchParams.has('new')) {
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Digital workers</div>
          <h1>Agents</h1>
          <div className="sub">角色化智能体。挂载 Skill 与知识后，它们会成为工作流中的执行者。</div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + 新建 Agent
        </Button>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索名称、角色或简介"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索 Agent"
          />
        </div>
        <span className="small muted">
          {agents.data ? `${agents.data.length} 个 Agent` : ''}
        </span>
      </div>

      {agents.isLoading ? (
        <LoadingBlock label="加载 Agents…" />
      ) : agents.isError ? (
        <ErrorBlock message={errorMessage(agents.error)} />
      ) : agents.data && agents.data.length === 0 ? (
        <EmptyState
          icon="◉"
          title={query ? '没有匹配的 Agent' : '还没有 Agent'}
          description={
            query
              ? '换一个关键词试试。'
              : '先创建一个角色，再为它挂载技能和项目知识。'
          }
          action={
            !query ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                创建 Agent
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="card-grid">
          {agents.data?.map((agent) => (
            <article className="agent-card" key={agent.id}>
              <div className="ac-head">
                <div className="row">
                  <span className="avatar">{initials(agent.name)}</span>
                  <div>
                    <div className="ac-name">{agent.name}</div>
                    <div className="ac-role">{agent.role}</div>
                  </div>
                </div>
                <span className={`badge badge-${agent.status === 'ACTIVE' ? 'enabled' : 'canceled'}`}>
                  {agent.status === 'ACTIVE' ? '启用' : '停用'}
                </span>
              </div>
              <div className="ac-desc">{agent.description || '未填写简介。'}</div>
              <div className="ac-foot">
                <span className="ac-stat">
                  ✦ {agent.skillCount} · ◇ {agent.knowledgeCount} · {agent.modelName ?? '未配置模型'}
                </span>
                <div className="row" style={{ gap: 4 }}>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(agent)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/agents/${agent.id}`)}>
                    打开 →
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {agents.data && agents.data.length > 0 ? (
        <div className="small muted">
          提示：删除 Agent 前需要先把工作流中对它的引用移除。
        </div>
      ) : null}

      <AgentFormModal open={creating} onClose={closeCreate} />
      <AgentFormModal
        open={editing !== null}
        agent={editing}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="删除 Agent"
        description={
          <>
            确定删除「{deleting?.name}」？挂载关系会一并移除；如果它仍被工作流引用，服务端会拒绝删除。
          </>
        }
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
