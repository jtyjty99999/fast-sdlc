import type { MatchCandidate, StepRun, WorkflowSummary } from '@autosdd/shared';

export function makeStep(overrides: Partial<StepRun> = {}): StepRun {
  return {
    id: 'step-run-1',
    runId: 'run-1',
    stepKey: 'step-1',
    stepName: '需求分析',
    agentId: 'agent-1',
    agentName: '需求分析师',
    instructionMd: '输出需求规格',
    dependsOn: [],
    orderIndex: 0,
    gateMode: 'NONE',
    status: 'PENDING',
    attempt: 1,
    context: null,
    outputMd: null,
    error: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    startedAt: null,
    finishedAt: null,
    approval: null,
    ...overrides,
  };
}

export function makeWorkflowSummary(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    id: 'workflow-1',
    name: '新功能开发',
    description: '从需求到评审的完整流水线',
    scenario: '功能开发',
    tags: ['开发'],
    matchKeywords: ['新功能'],
    status: 'ENABLED',
    stepCount: 3,
    agentNames: ['需求分析师', '开发工程师'],
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

export function makeCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    workflow: makeWorkflowSummary(),
    score: 13,
    reasons: ['场景匹配：功能开发', '关键词：新功能'],
    ...overrides,
  };
}
