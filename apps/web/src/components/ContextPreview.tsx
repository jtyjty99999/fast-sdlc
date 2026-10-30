import type { BuiltContextSection } from '@autosdd/shared';

export interface ContextStats {
  systemChars: number;
  userChars: number;
  skillCount: number;
  knowledgeCount: number;
  truncated: boolean;
  sections: readonly BuiltContextSection[];
}

interface ContextPreviewProps {
  systemPrompt: string;
  userPrompt: string;
  stats: ContextStats;
}

export function ContextPreview({ systemPrompt, userPrompt, stats }: ContextPreviewProps) {
  return (
    <>
      <div className="context-stats">
        <div className="stat-box">
          <div className="sk">System</div>
          <div className="sv">{stats.systemChars}</div>
        </div>
        <div className="stat-box">
          <div className="sk">User</div>
          <div className="sv">{stats.userChars}</div>
        </div>
        <div className="stat-box">
          <div className="sk">Skills</div>
          <div className="sv">{stats.skillCount}</div>
        </div>
        <div className="stat-box">
          <div className="sk">Knowledge</div>
          <div className="sv">{stats.knowledgeCount}</div>
        </div>
        <div className="stat-box">
          <div className="sk">Truncated</div>
          <div className="sv">{stats.truncated ? 'YES' : 'NO'}</div>
        </div>
      </div>
      {stats.truncated ? (
        <div className="issue issue-warning" style={{ marginBottom: 10 }}>
          <span className="issue-lv">WARN</span>
          <span>部分内容超出预算，已按条目截断。查看分段统计定位来源。</span>
        </div>
      ) : null}
      <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginBottom: 5 }}>
        {stats.sections.map((section) => (
          <span
            key={section.label}
            className={`chip${section.truncated ? ' chip-warning' : ''}`}
          >
            {section.label} · {section.chars}
          </span>
        ))}
      </div>
      <div className="prompt-label">
        <span>System prompt</span>
        <span>{stats.systemChars} chars</span>
      </div>
      <pre className="prompt-block">{systemPrompt}</pre>
      <div className="prompt-label">
        <span>User prompt</span>
        <span>{stats.userChars} chars</span>
      </div>
      <pre className="prompt-block">{userPrompt}</pre>
    </>
  );
}
