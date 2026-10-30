import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stepper } from './Stepper';
import { makeStep } from '../../test/fixtures';

describe('Stepper', () => {
  const steps = [
    makeStep({ id: 'a', stepName: '需求分析', status: 'SUCCEEDED' }),
    makeStep({
      id: 'b',
      stepName: '架构设计',
      status: 'WAITING_APPROVAL',
      gateMode: 'HUMAN_APPROVAL',
    }),
    makeStep({ id: 'c', stepName: '编码实现', status: 'PENDING' }),
  ];

  it('renders every step with its status label and gate marker', () => {
    // Arrange & Act
    render(<Stepper steps={steps} selectedId={null} onSelect={() => undefined} />);

    // Assert
    expect(screen.getByText('需求分析')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('待审批')).toBeInTheDocument();
    expect(screen.getByText('等待中')).toBeInTheDocument();
    const nodes = screen.getAllByRole('listitem');
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toHaveAttribute('title', '架构设计 · 待审批');
    expect(nodes[1]).toHaveTextContent('◆');
  });

  it('marks the selected step and reports clicks', async () => {
    // Arrange
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Stepper steps={steps} selectedId="b" onSelect={onSelect} />);
    const nodes = screen.getAllByRole('listitem');

    // Act
    expect(nodes[1]).toHaveClass('selected');
    await user.click(nodes[2]!);

    // Assert
    expect(onSelect).toHaveBeenCalledWith('c');
  });
});
