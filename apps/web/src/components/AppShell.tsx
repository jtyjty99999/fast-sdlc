import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

const NAV_GROUPS = [
  {
    label: '工作台',
    items: [
      { to: '/', label: '总览', icon: '◫', end: true },
      { to: '/tasks', label: '任务', icon: '☰' },
    ],
  },
  {
    label: '资产',
    items: [
      { to: '/agents', label: 'Agents', icon: '◉' },
      { to: '/skills', label: 'Skills', icon: '✦' },
      { to: '/knowledge', label: '知识库', icon: '◇' },
      { to: '/models', label: '模型管理', icon: '◈' },
    ],
  },
  {
    label: '编排',
    items: [{ to: '/workflows', label: '工作流', icon: '⇄' }],
  },
] as const;

function breadcrumbFor(pathname: string): string[] {
  if (pathname === '/') return ['总览'];
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0] ?? '';
  const rootLabel: Record<string, string> = {
    agents: 'Agents',
    skills: 'Skills',
    knowledge: '知识库',
    models: '模型管理',
    workflows: '工作流',
    tasks: '任务',
  };
  const label = rootLabel[root] ?? root;
  if (segments.length === 1) return [label];
  if (root === 'workflows' && segments[1] === 'new') return [label, '新建'];
  if (root === 'agents') return [label, '详情'];
  if (root === 'workflows') return [label, '编排'];
  if (root === 'tasks') return [label, '详情'];
  return [label, '详情'];
}

export function AppShell() {
  const location = useLocation();
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    staleTime: 30_000,
    retry: 1,
  });
  const crumbs = breadcrumbFor(location.pathname);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">A</span>
          <div>
            <strong>AutoSDD</strong>
            <br />
            <small>AGENT SDLC CONSOLE</small>
          </div>
        </div>
        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={'end' in item ? item.end : false}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <span className="nav-ic" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="executor-card">
            <div className="k">执行器</div>
            <div className="v">
              {overview.data ? (
                <>
                  <span className="dot" />
                  {overview.data.executor.label}
                </>
              ) : overview.isLoading ? (
                <span className="muted">检测中…</span>
              ) : (
                <span className="muted">后端未连接</span>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`} className="row" style={{ gap: 7 }}>
                {index > 0 ? <span className="sep">/</span> : null}
                <span className={index === crumbs.length - 1 ? 'current' : ''}>{crumb}</span>
              </span>
            ))}
          </div>
          <div className="topbar-meta">
            <span>本地工作空间 · 无鉴权</span>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
