import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalBanner } from './ApprovalBanner';

describe('ApprovalBanner', () => {
  const handlers = {
    onCommentChange: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onViewOutput: vi.fn(),
  };

  it('shows the gated step and wires the decision actions', async () => {
    // Arrange
    const user = userEvent.setup();
    render(
      <ApprovalBanner stepName="架构设计" comment="" {...handlers} />,
    );

    // Assert
    expect(screen.getByText(/人工审批卡点：架构设计/)).toBeInTheDocument();

    // Act
    await user.type(screen.getByLabelText('审批意见'), '方案可行');
    await user.click(screen.getByRole('button', { name: '通过' }));
    await user.click(screen.getByRole('button', { name: '驳回' }));
    await user.click(screen.getByRole('button', { name: '查看产物' }));

    // Assert
    expect(handlers.onCommentChange).toHaveBeenCalled();
    expect(handlers.onApprove).toHaveBeenCalledTimes(1);
    expect(handlers.onReject).toHaveBeenCalledTimes(1);
    expect(handlers.onViewOutput).toHaveBeenCalledTimes(1);
  });

  it('disables decisions while a request is in flight', () => {
    // Arrange & Act
    render(<ApprovalBanner stepName="架构设计" comment="ok" busy {...handlers} />);

    // Assert
    expect(screen.getByRole('button', { name: '通过' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '驳回' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看产物' })).toBeEnabled();
  });
});
