import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentInput, AgentMountInput } from '@autosdd/shared';
import { api, errorMessage } from '../lib/api';
import { formatDate, initials } from '../lib/format';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorBlock, LoadingBlock } from '../components/ui/Feedback';
import { Field } from '../components/ui/Field';
import { Tabs } from '../components/ui/Tabs';
import { ContextPreview } from '../components/ContextPreview';
import { useToast } from '../components/ui/Toast';

type DetailTab = 'mounts' | 'context';

export function AgentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const agent = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.agents.get(id),
    enabled: Boolean(id),
  });
  const skills = useQuery({ queryKey: ['skills', ''], queryFn: () => api.skills.list() });
  const knowledge = useQuery({
    queryKey: ['knowledge', ''],
    queryFn: () => api.knowledge.list(),
  });
  const preview = useQuery({
    queryKey: ['agent-preview', id],
    queryFn: () => api.agents.contextPreview(id),
    enabled: Boolean(id),
  });

  const [tab, setTab] = useState<DetailTab>('mounts');
  const [form, setForm] = useState<AgentInput | null>(null);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!agent.data) return;
    setForm({
      name: agent.data.name,
      role: agent.data.role,
      description: agent.data.description,
      systemPrompt: agent.data.systemPrompt,
      model: agent.data.model,
      status: agent.data.status,
    });
    setSkillIds(agent.data.skills.map((skill) => skill.id));
    setKnowledgeIds(agent.data.knowledgeItems.map((item) => item.id));
  }, [agent.data]);

  const saveProfile = useMutation({
    mutationFn: (input: AgentInput) => api.agents.update(id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agent', id] }),
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-preview', id] }),
      ]);
      toast.success('Agent 资料已保存');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveMounts = useMutation({
    mutationFn: (input: AgentMountInput) => api.agents.setMounts(id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agent', id] }),
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['agent-preview', id] }),
      ]);
      toast.success('挂载关系已保存');
      setTab('context');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => api.agents.remove(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      toast.success('Agent 已删除');
      navigate('/agents');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (agent.isLoading) return <LoadingBlock label="加载 Agent…" />;
  if (agent.isError) return <ErrorBlock message={errorMessage(agent.error)} />;
  if (!agent.data || !form) return null;

  const toggle = (list: string[], setList: (next: string[]) => void, value: string): void => {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const submitProfile = (event: FormEvent): void => {
    event.preventDefault();
    saveProfile.mutate(form);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/agents">Agents</Link> / {agent.data.name}
          </div>
          <h1 className="row" style={{ gap: 10 }}>
            <span className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>
              {initials(agent.data.name)}
            </span>
            {agent.data.name}
          </h1>
          <div className="sub">
            {agent.data.role} · 更新于 {formatDate(agent.data.updatedAt)}
          </div>
        </div>
        <div className="row">
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            删除
          </Button>
          <Link className="btn" to="/agents">
            返回列表
          </Link>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>基本资料</h2>
            <span className={`badge badge-${agent.data.status === 'ACTIVE' ? 'enabled' : 'canceled'}`}>
              {agent.data.status === 'ACTIVE' ? '启用' : '停用'}
            </span>
          </div>
          <div className="panel-body">
            <form className="profile-form" onSubmit={submitProfile}>
              <div className="form-grid">
                <Field label="名称" htmlFor="detail-name">
                  <input
                    id="detail-name"
                    className="input"
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    maxLength={80}
                  />
                </Field>
                <Field label="角色" htmlFor="detail-role">
                  <input
                    id="detail-role"
                    className="input"
                    value={form.role}
                    onChange={(event) =>
                      setForm({ ...form, role: event.target.value })
                    }
                    maxLength={80}
                  />
                </Field>
                <Field label="简介" htmlFor="detail-desc" className="span-2">
                  <textarea
                    id="detail-desc"
                    className="textarea"
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                    maxLength={1000}
                  />
                </Field>
                <Field label="系统提示词" htmlFor="detail-prompt" className="span-2">
                  <textarea
                    id="detail-prompt"
                    className="textarea textarea-code"
                    style={{ minHeight: 130 }}
                    value={form.systemPrompt}
                    onChange={(event) =>
                      setForm({ ...form, systemPrompt: event.target.value })
                    }
                    maxLength={30_000}
                  />
                </Field>
                <Field label="模型" htmlFor="detail-model">
                  <input
                    id="detail-model"
                    className="input"
                    value={form.model}
                    onChange={(event) =>
                      setForm({ ...form, model: event.target.value })
                    }
                    maxLength={120}
                  />
                </Field>
                <Field label="状态" htmlFor="detail-status">
                  <select
                    id="detail-status"
                    className="select"
                    value={form.status}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        status: event.target.value === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
                      })
                    }
                  >
                    <option value="ACTIVE">启用</option>
                    <option value="DISABLED">停用</option>
                  </select>
                </Field>
              </div>
              <div className="row-between">
                <span className="small muted">
                  已挂载 {agent.data.skillCount} 个 Skill / {agent.data.knowledgeCount} 条知识
                </span>
                <Button variant="primary" type="submit" disabled={saveProfile.isPending}>
                  {saveProfile.isPending ? '保存中…' : '保存资料'}
                </Button>
              </div>
            </form>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <Tabs
              items={[
                { key: 'mounts', label: '技能与知识' },
                { key: 'context', label: '上下文预览' },
              ]}
              value={tab}
              onChange={setTab}
            />
            {tab === 'context' ? (
              <Button
                size="sm"
                onClick={() => preview.refetch()}
                disabled={preview.isFetching}
              >
                {preview.isFetching ? '刷新中…' : '刷新预览'}
              </Button>
            ) : null}
          </div>

          {tab === 'mounts' ? (
            <div className="panel-body">
              <div className="mount-section-title">
                <span className="badge badge-skill badge-plain">SKILLS</span>
                选择要注入系统提示词的技能包
              </div>
              {skills.isLoading ? (
                <LoadingBlock label="加载技能库…" />
              ) : (skills.data ?? []).length === 0 ? (
                <p className="small muted">
                  技能库为空，先到 <Link to="/skills">Skills</Link> 创建。
                </p>
              ) : (
                <div className="mount-grid">
                  {skills.data?.map((skill) => (
                    <label className="checkbox-row" key={skill.id}>
                      <input
                        type="checkbox"
                        checked={skillIds.includes(skill.id)}
                        onChange={() => toggle(skillIds, setSkillIds, skill.id)}
                      />
                      <span>
                        <span className="cr-title">{skill.name}</span>
                        <span className="cr-desc">
                          {skill.category} · {skill.description || '无描述'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="mount-section-title" style={{ marginTop: 18 }}>
                <span className="badge badge-know badge-plain">KNOWLEDGE</span>
                选择要注入项目知识的条目
              </div>
              {knowledge.isLoading ? (
                <LoadingBlock label="加载知识库…" />
              ) : (knowledge.data ?? []).length === 0 ? (
                <p className="small muted">
                  知识库为空，先到 <Link to="/knowledge">知识库</Link> 创建。
                </p>
              ) : (
                <div className="mount-grid">
                  {knowledge.data?.map((item) => (
                    <label className="checkbox-row" key={item.id}>
                      <input
                        type="checkbox"
                        checked={knowledgeIds.includes(item.id)}
                        onChange={() => toggle(knowledgeIds, setKnowledgeIds, item.id)}
                      />
                      <span>
                        <span className="cr-title">{item.title}</span>
                        <span className="cr-desc">
                          {item.type} · {item.tags.join('、') || '无标签'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="row-between" style={{ marginTop: 18 }}>
                <span className="small muted">
                  已选 {skillIds.length} 个技能、{knowledgeIds.length} 条知识
                </span>
                <Button
                  variant="primary"
                  onClick={() => saveMounts.mutate({ skillIds, knowledgeIds })}
                  disabled={saveMounts.isPending}
                >
                  {saveMounts.isPending ? '保存中…' : '保存挂载'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="panel-body">
              {preview.isLoading ? (
                <LoadingBlock label="组装上下文…" />
              ) : preview.isError ? (
                <ErrorBlock message={errorMessage(preview.error)} />
              ) : preview.data ? (
                <ContextPreview
                  systemPrompt={preview.data.systemPrompt}
                  userPrompt={preview.data.userPrompt}
                  stats={preview.data.stats}
                />
              ) : null}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除 Agent"
        description={`确定删除「${agent.data.name}」？如果它仍被工作流引用，服务端会拒绝删除。`}
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
