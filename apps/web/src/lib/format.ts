import type {
  AgentStatus,
  ApprovalStatus,
  KnowledgeType,
  StepStatus,
  TaskStatus,
  WorkflowStatus,
} from '@autosdd/shared';
import {
  AGENT_STATUS_LABELS,
  APPROVAL_STATUS_LABELS,
  KNOWLEDGE_TYPE_LABELS,
  STEP_STATUS_LABELS,
  TASK_STATUS_LABELS,
  WORKFLOW_STATUS_LABELS,
} from '@autosdd/shared';

export type BadgeTone =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'draft'
  | 'enabled'
  | 'skill'
  | 'know'
  | 'hook';

const STATUS_TONES: Record<string, BadgeTone> = {
  QUEUED: 'queued',
  PENDING: 'queued',
  RUNNING: 'running',
  READY: 'running',
  WAITING_APPROVAL: 'waiting',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  SKIPPED: 'canceled',
  DRAFT: 'draft',
  ENABLED: 'enabled',
  ACTIVE: 'enabled',
  DISABLED: 'canceled',
  APPROVED: 'succeeded',
  REJECTED: 'failed',
};

const ALL_STATUS_LABELS: Record<string, string> = {
  ...APPROVAL_STATUS_LABELS,
  ...KNOWLEDGE_TYPE_LABELS,
  ...WORKFLOW_STATUS_LABELS,
  ...AGENT_STATUS_LABELS,
  ...TASK_STATUS_LABELS,
  ...STEP_STATUS_LABELS,
};

export function statusLabel(status: TaskStatus | StepStatus | AgentStatus | WorkflowStatus | ApprovalStatus | string): string {
  return ALL_STATUS_LABELS[status] ?? status;
}

export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? 'queued';
}

export function typeLabel(type: KnowledgeType): string {
  return KNOWLEDGE_TYPE_LABELS[type] ?? type;
}

const TASK_TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED']);
const TASK_ACTIVE = new Set(['QUEUED', 'RUNNING', 'WAITING_APPROVAL']);

export function isTerminalTask(status: string): boolean {
  return TASK_TERMINAL.has(status);
}

export function isActiveTask(status: string): boolean {
  return TASK_ACTIVE.has(status);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to)) return '—';
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

export function initials(name: string): string {
  return name.trim().slice(0, 2) || 'AG';
}

export function truncate(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}
