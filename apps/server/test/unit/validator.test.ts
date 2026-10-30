import { describe, expect, test } from 'vitest';
import type { Agent } from '@autosdd/shared';
import {
  validateWorkflowSteps,
  type WorkflowStepDraft,
} from '../../src/domain/workflows/validator';

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    name: '需求分析师',
    role: '需求分析',
    description: '',
    systemPrompt: '',
    model: 'claude-sonnet-5',
    status: 'ACTIVE',
    skillCount: 0,
    knowledgeCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function step(overrides: Partial<WorkflowStepDraft> = {}): WorkflowStepDraft {
  return {
    stepKey: 'step_1',
    name: '需求分析',
    agentId: 'agent_1',
    instructionMd: '输出需求文档',
    dependsOn: [],
    ...overrides,
  };
}

const lookup = (id: string): Agent | undefined =>
  id === 'agent_1'
    ? agent()
    : id === 'agent_disabled'
      ? agent({ id: 'agent_disabled', status: 'DISABLED' })
      : undefined;

describe('validateWorkflowSteps', () => {
  test('accepts a valid linear workflow', () => {
    const result = validateWorkflowSteps(
      [
        step({ stepKey: 'a' }),
        step({ stepKey: 'b', dependsOn: ['a'] }),
      ],
      lookup,
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('reports duplicate step keys', () => {
    const result = validateWorkflowSteps(
      [step({ stepKey: 'a' }), step({ stepKey: 'a' })],
      lookup,
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('STEP_KEY_DUPLICATE');
  });

  test('reports self dependency', () => {
    const result = validateWorkflowSteps(
      [step({ stepKey: 'a', dependsOn: ['a'] })],
      lookup,
    );

    expect(result.issues.some((issue) => issue.code === 'DEP_SELF')).toBe(true);
  });

  test('reports a dependency on a missing step', () => {
    const result = validateWorkflowSteps(
      [step({ stepKey: 'a', dependsOn: ['ghost'] })],
      lookup,
    );

    expect(result.issues.some((issue) => issue.code === 'DEP_MISSING')).toBe(true);
    expect(result.valid).toBe(false);
  });

  test('reports missing and disabled agents', () => {
    const missing = validateWorkflowSteps([step({ agentId: 'nope' })], lookup);
    const disabled = validateWorkflowSteps(
      [step({ agentId: 'agent_disabled' })],
      lookup,
    );

    expect(missing.issues.some((issue) => issue.code === 'AGENT_MISSING')).toBe(true);
    expect(disabled.issues.some((issue) => issue.code === 'AGENT_DISABLED')).toBe(true);
  });

  test('warns about an empty instruction but stays valid', () => {
    const result = validateWorkflowSteps([step({ instructionMd: '   ' })], lookup);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({ level: 'WARNING', code: 'INSTRUCTION_EMPTY' }),
    ]);
  });

  test('detects dependency cycles', () => {
    const result = validateWorkflowSteps(
      [
        step({ stepKey: 'a', dependsOn: ['b'] }),
        step({ stepKey: 'b', dependsOn: ['a'] }),
      ],
      lookup,
    );

    const cycle = result.issues.find((issue) => issue.code === 'DEP_CYCLE');
    expect(cycle).toBeDefined();
    expect(cycle?.level).toBe('ERROR');
    expect(result.valid).toBe(false);
  });

  test('warns when multiple steps declare no dependencies', () => {
    const result = validateWorkflowSteps(
      [step({ stepKey: 'a' }), step({ stepKey: 'b' })],
      lookup,
    );

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'NO_DEPENDENCIES')).toBe(true);
  });
});
