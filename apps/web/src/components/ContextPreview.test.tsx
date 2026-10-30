import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextPreview, type ContextStats } from './ContextPreview';

const baseStats: ContextStats = {
  systemChars: 1240,
  userChars: 320,
  skillCount: 2,
  knowledgeCount: 3,
  truncated: false,
  sections: [
    { label: '身份', chars: 400, truncated: false },
    { label: '技能', chars: 840, truncated: false },
  ],
};

describe('ContextPreview', () => {
  it('renders budget stats, sections and both prompts', () => {
    // Arrange & Act
    render(
      <ContextPreview
        systemPrompt="你是需求分析师"
        userPrompt="请分析订单取消需求"
        stats={baseStats}
      />,
    );

    // Assert
    expect(screen.getByText('1240')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.getByText('身份 · 400')).toBeInTheDocument();
    expect(screen.getByText('技能 · 840')).toBeInTheDocument();
    expect(screen.getByText('你是需求分析师')).toBeInTheDocument();
    expect(screen.getByText('请分析订单取消需求')).toBeInTheDocument();
    expect(screen.queryByText(/部分内容超出预算/)).not.toBeInTheDocument();
  });

  it('warns and flags sections when the context was truncated', () => {
    // Arrange & Act
    render(
      <ContextPreview
        systemPrompt="system"
        userPrompt="user"
        stats={{
          ...baseStats,
          truncated: true,
          sections: [{ label: '知识', chars: 12000, truncated: true }],
        }}
      />,
    );

    // Assert
    expect(screen.getByText(/部分内容超出预算/)).toBeInTheDocument();
    expect(screen.getByText('知识 · 12000')).toHaveClass('chip-warning');
    expect(screen.getAllByText('YES')).toHaveLength(1);
  });
});
