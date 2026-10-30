import type { MatchCandidate } from '@autosdd/shared';

interface MatchListProps {
  candidates: readonly MatchCandidate[];
  selectedId: string | null;
  onSelect: (candidate: MatchCandidate) => void;
}

export function MatchList({ candidates, selectedId, onSelect }: MatchListProps) {
  if (candidates.length === 0) {
    return (
      <div className="match-empty">
        没有自动匹配结果。请从下方手动选择已启用的工作流。
      </div>
    );
  }

  return (
    <div className="match-list">
      {candidates.map((candidate) => (
        <button
          type="button"
          key={candidate.workflow.id}
          className={`match-card${
            selectedId === candidate.workflow.id ? ' selected' : ''
          }`}
          onClick={() => onSelect(candidate)}
          aria-pressed={selectedId === candidate.workflow.id}
        >
          <span className="mc-score">{candidate.score}</span>
          <span style={{ flex: 1 }}>
            <span className="mc-name">{candidate.workflow.name}</span>
            <span className="mc-reason">
              {candidate.workflow.stepCount} 步 · {candidate.reasons.join(' · ') || '无命中说明'}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
