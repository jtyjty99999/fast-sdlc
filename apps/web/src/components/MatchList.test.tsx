import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MatchList } from './MatchList';
import { makeCandidate, makeWorkflowSummary } from '../test/fixtures';

describe('MatchList', () => {
  const top = makeCandidate();
  const second = makeCandidate({
    workflow: makeWorkflowSummary({
      id: 'workflow-2',
      name: 'Bug 修复',
      scenario: '缺陷修复',
      stepCount: 2,
    }),
    score: 8,
    reasons: ['关键词：报错'],
  });

  it('renders score, step count and reasons for every candidate', () => {
    // Arrange & Act
    render(<MatchList candidates={[top, second]} selectedId={null} onSelect={() => undefined} />);

    // Assert
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('新功能开发')).toBeInTheDocument();
    expect(screen.getByText(/3 步 · 场景匹配：功能开发/)).toBeInTheDocument();
    expect(screen.getByText(/2 步 · 关键词：报错/)).toBeInTheDocument();
  });

  it('marks the selected card and reports the chosen candidate', async () => {
    // Arrange
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MatchList candidates={[top, second]} selectedId={top.workflow.id} onSelect={onSelect} />);
    const cards = screen.getAllByRole('button');

    // Assert
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true');
    expect(cards[1]).toHaveAttribute('aria-pressed', 'false');

    // Act
    await user.click(cards[1]!);

    // Assert
    expect(onSelect).toHaveBeenCalledWith(second);
  });

  it('guides the user to pick manually when nothing matches', () => {
    // Arrange & Act
    render(<MatchList candidates={[]} selectedId={null} onSelect={() => undefined} />);

    // Assert
    expect(screen.getByText(/没有自动匹配结果/)).toBeInTheDocument();
  });
});
