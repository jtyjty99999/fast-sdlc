import type {
  GateMode,
  SnapshotKnowledge,
  SnapshotSkill,
  StepStatus,
  TaskStatus,
} from '@autosdd/shared';

export interface AgentProfile {
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

export interface TaskContext {
  title: string;
  description: string;
  scenario: string;
}

export interface StepContext {
  stepKey: string;
  name: string;
  instructionMd: string;
  gateMode: GateMode;
}

export interface DependencyOutput {
  stepKey: string;
  stepName: string;
  outputMd: string | null;
}

export interface ContextBuildInput {
  agent: AgentProfile;
  task: TaskContext;
  step: StepContext;
  dependencyOutputs: DependencyOutput[];
}

export interface ExecutorInput {
  agentId: string;
  agentName: string;
  role: string;
  model: string;
  stepName: string;
  taskTitle: string;
  systemPrompt: string;
  userPrompt: string;
}

export type ExecutorEvent = { type: 'delta'; text: string };

export type ExecutorEmit = (event: ExecutorEvent) => void;

export interface ExecutorResult {
  outputMd: string;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string;
}

export interface AgentExecutor {
  readonly kind: 'mock' | 'anthropic' | 'openai';
  readonly model: string;
  run(
    input: ExecutorInput,
    emit: ExecutorEmit,
    signal: AbortSignal,
  ): Promise<ExecutorResult>;
}

export interface RunLoopStepState {
  stepKey: string;
  status: StepStatus;
  dependsOn: string[];
  orderIndex: number;
}

export interface RunLoopSnapshot {
  runId: string;
  taskId: string;
  status: TaskStatus;
  steps: RunLoopStepState[];
}
