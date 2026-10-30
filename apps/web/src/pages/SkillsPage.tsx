import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Skill } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { truncate } from '../lib/format';
import { SkillFormModal } from '../components/SkillFormModal';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { useToast } from '../components/ui/Toast';

export function SkillsPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const skills = useQuery({
    queryKey: ['skills', query, category],
    queryFn: () => api.skills.list({ q: query || undefined, category: category || undefined }),
  });

  const categories = useMemo(() => {
    const found = new Set<string>();
    for (const skill of skills.data ?? []) found.add(skill.category);
    return [...found];
  }, [skills.data]);

  const remove = useMutation({
    mutationFn: (id: string) => api.skills.remove(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['skills'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success('Skill 已删除');
      setDeleting(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Reusable methods</div>
          <h1>Skills</h1>
          <div className="sub">可复用的方法包。挂载到 Agent 后，其指令会注入每一次执行。</div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + 新建 Skill
        </Button>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索技能名称或描述"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索 Skill"
          />
        </div>
        <select
          className="select"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="按分类筛选"
        >
          <option value="">全部分类</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="small muted">{skills.data ? `${skills.data.length} 个 Skill` : ''}</span>
      </div>

      {skills.isLoading ? (
        <LoadingBlock label="加载技能库…" />
      ) : skills.isError ? (
        <ErrorBlock message={errorMessage(skills.error)} />
      ) : (skills.data ?? []).length === 0 ? (
        <EmptyState
          icon="✦"
          title={query || category ? '没有匹配的 Skill' : '技能库还是空的'}
          description={
            query || category
              ? '调整搜索条件，或创建一个新的技能包。'
              : '把团队重复使用的做法沉淀成 Skill，挂载给 Agent。'
          }
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              创建 Skill
            </Button>
          }
        />
      ) : (
        <section className="panel">
          <div className="list">
            {skills.data?.map((skill) => (
              <div className="list-row" key={skill.id}>
                <span className="lr-ic skill">✦</span>
                <div className="lr-main">
                  <div className="lr-title">
                    {skill.name}
                    <span className="badge badge-skill badge-plain">{skill.category}</span>
                  </div>
                  <div className="lr-desc">
                    {skill.description || truncate(skill.instructionsMd, 90)}
                  </div>
                </div>
                <div className="lr-actions">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(skill)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(skill)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <SkillFormModal open={creating} onClose={() => setCreating(false)} />
      <SkillFormModal open={editing !== null} skill={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="删除 Skill"
        description={`确定删除「${deleting?.name}」？仍被 Agent 挂载时服务端会拒绝删除。`}
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
