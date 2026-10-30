import type { Agent, WorkflowValidationIssue, WorkflowValidationResult } from '@autosdd/shared';

export interface WorkflowStepDraft {
  stepKey: string;
  name: string;
  agentId: string;
  instructionMd: string;
  dependsOn: string[];
}

type AgentLookup = (agentId: string) => Agent | undefined;

export function validateWorkflowSteps(
  steps: readonly WorkflowStepDraft[],
  lookupAgent: AgentLookup,
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    if (seen.has(step.stepKey)) {
      issues.push({
        level: 'ERROR',
        code: 'STEP_KEY_DUPLICATE',
        message: `步骤标识「${step.stepKey}」重复`,
        stepKey: step.stepKey,
      });
    }
    seen.add(step.stepKey);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (dep === step.stepKey) {
        issues.push({
          level: 'ERROR',
          code: 'DEP_SELF',
          message: `步骤「${step.name}」不能依赖自身`,
          stepKey: step.stepKey,
        });
      } else if (!seen.has(dep)) {
        issues.push({
          level: 'ERROR',
          code: 'DEP_MISSING',
          message: `步骤「${step.name}」依赖了不存在的步骤「${dep}」`,
          stepKey: step.stepKey,
        });
      }
    }

    const agent = lookupAgent(step.agentId);
    if (!agent) {
      issues.push({
        level: 'ERROR',
        code: 'AGENT_MISSING',
        message: `步骤「${step.name}」绑定的 Agent 不存在`,
        stepKey: step.stepKey,
      });
    } else if (agent.status !== 'ACTIVE') {
      issues.push({
        level: 'ERROR',
        code: 'AGENT_DISABLED',
        message: `步骤「${step.name}」绑定的 Agent「${agent.name}」已停用`,
        stepKey: step.stepKey,
      });
    }

    if (!step.instructionMd.trim()) {
      issues.push({
        level: 'WARNING',
        code: 'INSTRUCTION_EMPTY',
        message: `步骤「${step.name}」没有填写产出要求`,
        stepKey: step.stepKey,
      });
    }
  }

  const cycle = findCycle(steps);
  if (cycle) {
    issues.push({
      level: 'ERROR',
      code: 'DEP_CYCLE',
      message: `步骤依赖存在环：${cycle.join(' → ')}`,
      stepKey: cycle[0],
    });
  }

  if (steps.length > 1 && steps.every((step) => step.dependsOn.length === 0)) {
    issues.push({
      level: 'WARNING',
      code: 'NO_DEPENDENCIES',
      message: '所有步骤都没有声明依赖，将按顺序逐个执行',
    });
  }

  return { valid: !issues.some((issue) => issue.level === 'ERROR'), issues };
}

function findCycle(steps: readonly WorkflowStepDraft[]): string[] | null {
  const byKey = new Map(steps.map((step) => [step.stepKey, step]));
  const colors = new Map<string, 1 | 2>();
  const stack: string[] = [];

  const visit = (key: string): string[] | null => {
    if (colors.get(key) === 1) {
      const start = stack.indexOf(key);
      return [...stack.slice(start), key];
    }
    if (colors.get(key) === 2) return null;

    colors.set(key, 1);
    stack.push(key);
    const step = byKey.get(key);
    for (const dep of step?.dependsOn ?? []) {
      if (!byKey.has(dep)) continue;
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    colors.set(key, 2);
    return null;
  };

  for (const step of steps) {
    const found = visit(step.stepKey);
    if (found) return found;
  }
  return null;
}
