import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowSummary } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { formatDate, truncate } from '../lib/format';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { useToast } from '../components/ui/Toast';

export function WorkflowsPage() {
  const [deleting, setDeleting] = useState<WorkflowSummary | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const workflows = useQuery({ queryKey: ['workflows'], queryFn: api.workflows.list });

  const remove = useMutation({
    mutationFn: (id: string) => api.workflows.remove(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success('工作流已删除');
      setDeleting(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Orchestration</div>
          <h1>工作流</h1>
          <div className="sub">
            按步骤编排不同 Agent 的接力顺序。依赖显式声明，引擎按 DAG 就绪队列推进。
          </div>
        </div>
        <Button variant="primary" onClick={() => navigate('/workflows/new')}>
          + 新建工作流
        </Button>
      </div>

      {workflows.isLoading ? (
        <LoadingBlock label="加载工作流…" />
      ) : workflows.isError ? (
        <ErrorBlock message={errorMessage(workflows.error)} />
      ) : (workflows.data ?? []).length === 0 ? (
        <EmptyState
          icon="⇄"
          title="还没有工作流"
          description="创建第一个工作流：把需求分析、开发、测试等步骤交给不同 Agent。"
          action={
            <Button variant="primary" onClick={() => navigate('/workflows/new')}>
              新建工作流
            </Button>
          }
        />
      ) : (
        <section className="panel">
          <div className="list">
            {workflows.data?.map((workflow) => (
              <div className="list-row" key={workflow.id}>
                <span className="lr-ic">⇄</span>
                <div className="lr-main">
                  <div className="lr-title">
                    <Link to={`/workflows/${workflow.id}`}>{workflow.name}</Link>
                    <StatusBadge status={workflow.status} plain />
                    <span className="small muted">{workflow.scenario}</span>
                  </div>
                  <div className="lr-desc">
                    {workflow.description || '暂无描述'}
                  </div>
                  <div className="tag-list">
                    <span className="chip">{workflow.stepCount} 个步骤</span>
                    {workflow.agentNames.slice(0, 4).map((name) => (
                      <span className="chip" key={name}>
                        ◎ {name}
                      </span>
                    ))}
                    {workflow.tags.map((tag) => (
                      <span className="chip" key={`tag-${tag}`}>
                        #{tag}
                      </span>
                    ))}
                    <span className="small muted">
                      更新于 {formatDate(workflow.updatedAt)}
                    </span>
                  </div>
                </div>
                <div className="lr-actions">
                  <Link className="btn btn-sm" to={`/workflows/${workflow.id}`}>
                    编排
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(workflow)}
                    title={truncate(workflow.name, 20)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="删除工作流"
        description={`确定删除「${deleting?.name}」？已有任务引用时服务端会拒绝删除。`}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
