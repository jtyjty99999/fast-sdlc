import type {
  MatchCandidate,
  MatchInput,
  Workflow,
  WorkflowInput,
  WorkflowSummary,
  WorkflowValidationResult,
} from '@autosdd/shared';
import type { AgentRepository } from '../agents/repository';
import type {
  ResolvedWorkflowStep,
  WorkflowRepository,
  WorkflowSaveInput,
} from './repository';
import { badRequest, conflict, notFound } from '../../http/errors';
import { validateWorkflowSteps } from './validator';
import { matchWorkflows } from './matcher';

export function resolveSteps(input: WorkflowInput): ResolvedWorkflowStep[] {
  return input.steps.map((step, index) => ({
    stepKey: step.stepKey ?? `step_${index + 1}`,
    name: step.name,
    agentId: step.agentId,
    instructionMd: step.instructionMd ?? '',
    dependsOn: step.dependsOn ?? [],
    orderIndex: step.orderIndex ?? index,
    gateMode: step.gateMode ?? 'NONE',
    timeoutSeconds: step.timeoutSeconds ?? 300,
  }));
}

export class WorkflowService {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly agents: AgentRepository,
  ) {}

  list(): WorkflowSummary[] {
    return this.workflows.list();
  }

  get(id: string): Workflow {
    const workflow = this.workflows.findById(id);
    if (!workflow) throw notFound('工作流不存在');
    return workflow;
  }

  create(input: WorkflowInput): Workflow {
    const steps = resolveSteps(input);
    this.assertValid(steps);
    return this.workflows.create(this.toSaveInput(input, steps));
  }

  update(id: string, input: WorkflowInput): Workflow {
    this.get(id);
    const steps = resolveSteps(input);
    this.assertValid(steps);
    const updated = this.workflows.update(id, this.toSaveInput(input, steps));
    if (!updated) throw notFound('工作流不存在');
    return updated;
  }

  remove(id: string): void {
    this.get(id);
    const taskCount = this.workflows.countTasks(id);
    if (taskCount > 0) {
      throw conflict('WORKFLOW_IN_USE', `该工作流已被 ${taskCount} 个任务引用，无法删除`, {
        taskCount,
      });
    }
    this.workflows.remove(id);
  }

  validate(id: string): WorkflowValidationResult {
    const workflow = this.get(id);
    return validateWorkflowSteps(workflow.steps, (agentId) => this.agents.findById(agentId));
  }

  match(input: MatchInput): MatchCandidate[] {
    return matchWorkflows(this.workflows.list(), input);
  }

  private assertValid(steps: readonly ResolvedWorkflowStep[]): void {
    const result = validateWorkflowSteps(steps, (agentId) => this.agents.findById(agentId));
    if (!result.valid) {
      throw badRequest('WORKFLOW_INVALID', '工作流校验未通过', result.issues);
    }
  }

  private toSaveInput(
    input: WorkflowInput,
    steps: ResolvedWorkflowStep[],
  ): WorkflowSaveInput {
    return {
      name: input.name,
      description: input.description ?? '',
      scenario: input.scenario,
      tags: input.tags ?? [],
      matchKeywords: input.matchKeywords ?? [],
      status: input.status ?? 'DRAFT',
      steps,
    };
  }
}
