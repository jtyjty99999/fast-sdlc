import type {
  AGENT_STATUSES,
  APPROVAL_STATUSES,
  GATE_MODES,
  KNOWLEDGE_TYPES,
  MODEL_PROVIDERS,
  MODEL_STATUSES,
  STEP_STATUSES,
  TASK_STATUSES,
  WORKFLOW_STATUSES,
} from './constants';

export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export type GateMode = (typeof GATE_MODES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export type ModelStatus = (typeof MODEL_STATUSES)[number];
export type ModelKeySource = 'stored' | 'env' | 'none';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  modelId: string | null;
  modelName: string | null;
  modelProvider: ModelProvider | null;
  status: AgentStatus;
  skillCount: number;
  knowledgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Model {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  maxTokens: number;
  keySource: ModelKeySource;
  isDefault: boolean;
  status: ModelStatus;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelInput {
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
  status?: ModelStatus;
}

export interface ModelTestResult {
  ok: true;
  latencyMs: number;
  provider: ModelProvider;
  model: string;
  sample: string;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  instructionsMd: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  type: KnowledgeType;
  contentMd: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentDetail extends Agent {
  skills: Skill[];
  knowledgeItems: KnowledgeItem[];
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  stepKey: string;
  name: string;
  agentId: string;
  agentName: string;
  instructionMd: string;
  dependsOn: string[];
  orderIndex: number;
  gateMode: GateMode;
  timeoutSeconds: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  scenario: string;
  tags: string[];
  matchKeywords: string[];
  status: WorkflowStatus;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  scenario: string;
  tags: string[];
  matchKeywords: string[];
  status: WorkflowStatus;
  stepCount: number;
  agentNames: string[];
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  scenario: string;
  workflowId: string;
  workflowName: string;
  status: TaskStatus;
  currentRunId: string | null;
  currentStepName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  runNumber: number;
  status: TaskStatus;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BuiltContextSection {
  label: string;
  chars: number;
  truncated: boolean;
}

export interface BuiltContext {
  systemPrompt: string;
  userPrompt: string;
  systemChars: number;
  userChars: number;
  skillCount: number;
  knowledgeCount: number;
  truncated: boolean;
  sections: BuiltContextSection[];
}

export interface Approval {
  id: string;
  runId: string;
  stepRunId: string;
  status: ApprovalStatus;
  comment: string;
  requestedAt: string;
  decidedAt: string | null;
}

export interface StepRun {
  id: string;
  runId: string;
  stepKey: string;
  stepName: string;
  agentId: string;
  agentName: string;
  instructionMd: string;
  dependsOn: string[];
  orderIndex: number;
  gateMode: GateMode;
  status: StepStatus;
  attempt: number;
  context: BuiltContext | null;
  outputMd: string | null;
  error: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  approval: Approval | null;
}

export interface RunDetail extends TaskRun {
  steps: StepRun[];
  approvals: Approval[];
}

export interface TaskDetail {
  task: Task;
  workflow: Workflow | null;
  run: RunDetail | null;
  runs: TaskRun[];
}

export interface RunEvent {
  id: number;
  runId: string;
  stepRunId: string | null;
  type: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MatchCandidate {
  workflow: WorkflowSummary;
  score: number;
  reasons: string[];
}

export type ValidationLevel = 'ERROR' | 'WARNING';

export interface WorkflowValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  stepKey?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

export interface OverviewData {
  counts: {
    agents: number;
    skills: number;
    knowledge: number;
    workflows: number;
    enabledWorkflows: number;
    tasks: number;
    runningTasks: number;
    succeededTasks: number;
    terminalTasks: number;
    successRate: number;
  };
  executor: {
    kind: ModelProvider;
    model: string;
    label: string;
  };
  recentTasks: Task[];
}

export interface SnapshotSkill {
  id: string;
  name: string;
  instructionsMd: string;
  sortOrder: number;
}

export interface SnapshotKnowledge {
  id: string;
  title: string;
  type: KnowledgeType;
  contentMd: string;
  sortOrder: number;
}

export interface SnapshotAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  modelName: string;
  skills: SnapshotSkill[];
  knowledge: SnapshotKnowledge[];
}

export interface SnapshotStep {
  stepKey: string;
  name: string;
  agentId: string;
  instructionMd: string;
  dependsOn: string[];
  orderIndex: number;
  gateMode: GateMode;
  timeoutSeconds: number;
}

export interface WorkflowSnapshot {
  workflow: {
    id: string;
    name: string;
    description: string;
    scenario: string;
  };
  steps: SnapshotStep[];
  agents: Record<string, SnapshotAgent>;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface ContextPreview {
  systemPrompt: string;
  userPrompt: string;
  stats: {
    systemChars: number;
    userChars: number;
    skillCount: number;
    knowledgeCount: number;
    truncated: boolean;
    sections: BuiltContextSection[];
  };
}
