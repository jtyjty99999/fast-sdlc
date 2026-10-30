import type { SnapshotAgent, Workflow, WorkflowSnapshot } from '@autosdd/shared';

export function buildSnapshot(
  workflow: Workflow,
  getProfile: (agentId: string) => SnapshotAgent,
): WorkflowSnapshot {
  const agentIds = [...new Set(workflow.steps.map((step) => step.agentId))];
  const agents: Record<string, SnapshotAgent> = {};
  for (const agentId of agentIds) {
    agents[agentId] = getProfile(agentId);
  }

  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      scenario: workflow.scenario,
    },
    steps: workflow.steps.map((step) => ({
      stepKey: step.stepKey,
      name: step.name,
      agentId: step.agentId,
      instructionMd: step.instructionMd,
      dependsOn: step.dependsOn,
      orderIndex: step.orderIndex,
      gateMode: step.gateMode,
      timeoutSeconds: step.timeoutSeconds,
    })),
    agents,
  };
}
