import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the Chinese label and matching tone class', () => {
    // Arrange & Act
    render(<StatusBadge status="WAITING_APPROVAL" />);

    // Assert
    const badge = screen.getByText('待审批');
    expect(badge).toHaveClass('badge', 'badge-waiting');
  });

  it('falls back to the raw status when no label is known', () => {
    // Arrange & Act
    render(<StatusBadge status="UNKNOWN_STATE" />);

    // Assert
    expect(screen.getByText('UNKNOWN_STATE')).toHaveClass('badge-queued');
  });

  it('adds the plain modifier when requested', () => {
    // Arrange & Act
    render(<StatusBadge status="ENABLED" plain />);

    // Assert
    expect(screen.getByText('已启用')).toHaveClass('badge-plain', 'badge-enabled');
  });
});
