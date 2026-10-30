import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MODEL_KEY_SOURCE_LABELS,
  MODEL_PROVIDERS,
  MODEL_PROVIDER_LABELS,
  type Model,
} from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { ModelFormModal } from '../components/ModelFormModal';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { useToast } from '../components/ui/Toast';

export function ModelsPage() {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);
  const [deleting, setDeleting] = useState<Model | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const models = useQuery({
    queryKey: ['models', query, provider],
    queryFn: () => api.models.list({ q: query || undefined, provider: provider || undefined }),
  });

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['models'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);
  };

  const test = useMutation({
    mutationFn: (model: Model) => api.models.test(model.id),
    onMutate: (model) => setTestingId(model.id),
    onSuccess: (result) => toast.success(`连接成功 · ${result.latencyMs} ms`),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setTestingId(null),
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => api.models.setDefault(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('默认模型已切换');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.models.remove(id),
    onSuccess: async () => {
      await invalidate();
      toast.success('模型已删除');
      setDeleting(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Model registry</div>
          <h1>模型管理</h1>
          <div className="sub">
            为 Agent 注册可执行模型。API Key 只保存在本地数据库，接口永不回传明文。
          </div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + 新建模型
        </Button>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索模型名称或模型 ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索模型"
          />
        </div>
        <select
          className="select"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          aria-label="按提供方筛选"
        >
          <option value="">全部提供方</option>
          {MODEL_PROVIDERS.map((item) => (
            <option key={item} value={item}>
              {MODEL_PROVIDER_LABELS[item]}
            </option>
          ))}
        </select>
        <span className="small muted">
          {models.data ? `${models.data.length} 个模型` : ''}
        </span>
      </div>

      {models.isLoading ? (
        <LoadingBlock label="加载模型…" />
      ) : models.isError ? (
        <ErrorBlock message={errorMessage(models.error)} />
      ) : (models.data ?? []).length === 0 ? (
        <EmptyState
          icon="◈"
          title={query || provider ? '没有匹配的模型' : '还没有模型'}
          description={
            query || provider
              ? '调整搜索条件，或注册一个新的模型。'
              : '注册 Anthropic 或任意 OpenAI 兼容端点，供 Agent 调用。'
          }
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              注册模型
            </Button>
          }
        />
      ) : (
        <section className="panel">
          <div className="list">
            {models.data?.map((model) => (
              <div className="list-row" key={model.id}>
                <span className="lr-ic model">◈</span>
                <div className="lr-main">
                  <div className="lr-title">
                    {model.name}
                    <span className="badge badge-plain">
                      {MODEL_PROVIDER_LABELS[model.provider]}
                    </span>
                    {model.isDefault ? <span className="badge badge-enabled">默认</span> : null}
                    {model.status === 'DISABLED' ? (
                      <span className="badge badge-canceled">停用</span>
                    ) : null}
                  </div>
                  <div className="lr-desc">
                    {model.modelId}
                    {model.baseUrl ? ` · ${model.baseUrl}` : ''} · Key：
                    {MODEL_KEY_SOURCE_LABELS[model.keySource]} · 引用 {model.agentCount} 个 Agent
                  </div>
                </div>
                <div className="lr-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => test.mutate(model)}
                    disabled={testingId !== null}
                  >
                    {testingId === model.id ? '测试中…' : '测试连接'}
                  </Button>
                  {!model.isDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDefault.mutate(model.id)}
                      disabled={setDefault.isPending || model.status !== 'ACTIVE'}
                    >
                      设为默认
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(model)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(model)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="small muted">
        默认模型用于未显式绑定模型的 Agent；被 Agent 引用的模型不可删除或停用。
      </div>

      <ModelFormModal open={creating} onClose={() => setCreating(false)} />
      <ModelFormModal
        open={editing !== null}
        model={editing}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="删除模型"
        description={`确定删除「${deleting?.name}」？默认模型或被 Agent 引用的模型会被服务端拒绝删除。`}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
