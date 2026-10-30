import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KNOWLEDGE_TYPES, KNOWLEDGE_TYPE_LABELS, type KnowledgeItem } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { truncate } from '../lib/format';
import { KnowledgeFormModal } from '../components/KnowledgeFormModal';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { useToast } from '../components/ui/Toast';

export function KnowledgePage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeItem | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const knowledge = useQuery({
    queryKey: ['knowledge', query, type],
    queryFn: () => api.knowledge.list({ q: query || undefined, type: type || undefined }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.knowledge.remove(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success('知识条目已删除');
      setDeleting(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Project memory</div>
          <h1>知识库</h1>
          <div className="sub">项目规范、业务术语、API 约定与历史经验，按需注入 Agent 上下文。</div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + 新建知识
        </Button>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索标题、正文或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索知识"
          />
        </div>
        <select
          className="select"
          value={type}
          onChange={(event) => setType(event.target.value)}
          aria-label="按类型筛选"
        >
          <option value="">全部类型</option>
          {KNOWLEDGE_TYPES.map((item) => (
            <option key={item} value={item}>
              {KNOWLEDGE_TYPE_LABELS[item]}
            </option>
          ))}
        </select>
        <span className="small muted">
          {knowledge.data ? `${knowledge.data.length} 条知识` : ''}
        </span>
      </div>

      {knowledge.isLoading ? (
        <LoadingBlock label="加载知识库…" />
      ) : knowledge.isError ? (
        <ErrorBlock message={errorMessage(knowledge.error)} />
      ) : (knowledge.data ?? []).length === 0 ? (
        <EmptyState
          icon="◇"
          title={query || type ? '没有匹配的知识' : '知识库还是空的'}
          description={
            query || type ? '换一个关键词或类型试试。' : '沉淀第一条项目规则，让 Agent 更懂你的上下文。'
          }
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              创建知识
            </Button>
          }
        />
      ) : (
        <section className="panel">
          <div className="list">
            {knowledge.data?.map((item) => (
              <div className="list-row" key={item.id}>
                <span className="lr-ic know">◇</span>
                <div className="lr-main">
                  <div className="lr-title">
                    {item.title}
                    <span className="badge badge-know badge-plain">
                      {KNOWLEDGE_TYPE_LABELS[item.type]}
                    </span>
                  </div>
                  <div className="lr-desc">{truncate(item.contentMd, 110)}</div>
                  {item.tags.length > 0 ? (
                    <div className="tag-list">
                      {item.tags.map((tag) => (
                        <span className="chip" key={tag}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="lr-actions">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(item)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <KnowledgeFormModal open={creating} onClose={() => setCreating(false)} />
      <KnowledgeFormModal
        open={editing !== null}
        item={editing}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="删除知识"
        description={`确定删除「${deleting?.title}」？仍被 Agent 挂载时服务端会拒绝删除。`}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
