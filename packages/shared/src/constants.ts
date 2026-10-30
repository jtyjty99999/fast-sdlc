export const AGENT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export const WORKFLOW_STATUSES = ['DRAFT', 'ENABLED'] as const;
export const GATE_MODES = ['NONE', 'HUMAN_APPROVAL'] as const;
export const TASK_STATUSES = [
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
] as const;
export const STEP_STATUSES = [
  'PENDING',
  'READY',
  'RUNNING',
  'WAITING_APPROVAL',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'SKIPPED',
] as const;
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const KNOWLEDGE_TYPES = ['RULE', 'BUSINESS', 'API', 'LESSON', 'MEMORY'] as const;

export const TERMINAL_TASK_STATUSES: readonly string[] = ['SUCCEEDED', 'FAILED', 'CANCELED'];
export const ACTIVE_TASK_STATUSES: readonly string[] = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'];
export const SUCCESS_STEP_STATUSES: readonly string[] = ['SUCCEEDED', 'SKIPPED'];

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const DEFAULT_STEP_TIMEOUT_SECONDS = 300;
export const DEFAULT_MOCK_DELAY_MS = 250;

export const CONTEXT_BUDGETS = {
  system: 24_000,
  skills: 8_000,
  knowledge: 12_000,
  dependencies: 12_000,
  maxKnowledgeItems: 50,
} as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  QUEUED: '待启动',
  RUNNING: '执行中',
  WAITING_APPROVAL: '待审批',
  SUCCEEDED: '已成功',
  FAILED: '已失败',
  CANCELED: '已取消',
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: '等待中',
  READY: '就绪',
  RUNNING: '执行中',
  WAITING_APPROVAL: '待审批',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  CANCELED: '已取消',
  SKIPPED: '跳过',
};

export const AGENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '启用',
  DISABLED: '停用',
};

export const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  ENABLED: '已启用',
};

export const KNOWLEDGE_TYPE_LABELS: Record<string, string> = {
  RULE: '工程规范',
  BUSINESS: '业务知识',
  API: '外部 API',
  LESSON: '历史经验',
  MEMORY: '项目记忆',
};

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  PENDING: '待决策',
  APPROVED: '已通过',
  REJECTED: '已驳回',
};

export const EVENT_TYPES = [
  'RUN_STARTED',
  'STEP_READY',
  'STEP_STARTED',
  'STEP_DELTA',
  'STEP_OUTPUT',
  'APPROVAL_REQUESTED',
  'APPROVAL_DECIDED',
  'STEP_SUCCEEDED',
  'STEP_FAILED',
  'RUN_SUCCEEDED',
  'RUN_FAILED',
  'RUN_CANCELED',
  'LOG',
] as const;
