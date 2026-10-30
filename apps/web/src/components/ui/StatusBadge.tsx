import type { ReactNode } from 'react';
import { statusLabel, statusTone } from '../../lib/format';

interface StatusBadgeProps {
  status: string;
  plain?: boolean;
}

export function StatusBadge({ status, plain = false }: StatusBadgeProps) {
  return (
    <span className={`badge badge-${statusTone(status)}${plain ? ' badge-plain' : ''}`}>
      {statusLabel(status)}
    </span>
  );
}

interface BadgeProps {
  tone?: string;
  plain?: boolean;
  children: ReactNode;
}

export function Badge({ tone = 'queued', plain = false, children }: BadgeProps) {
  return (
    <span className={`badge badge-${tone}${plain ? ' badge-plain' : ''}`}>{children}</span>
  );
}

export function Chip({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'accent' | 'warning' | 'danger';
}) {
  return <span className={`chip${tone ? ` chip-${tone}` : ''}`}>{children}</span>;
}
