import type {
  ApprovalInput,
  RunDetail,
  RunEvent,
  StepRun,
  Task,
  TaskDetail,
  TaskInput,
  TaskRun,
} from '@autosdd/shared';
import type { TaskRepository } from './repository';
import type { RunRepository } from './run-repository';
import type { WorkflowRepository } from '../workflows/repository';
import { badRequest, conflict, notFound } from '../../http/errors';
import { matchWorkflows } from '../workflows/matcher';
import type { Orchestrator } from '../../execution/orchestrator';
import type { RunEventStore } from '../../execution/run-events';

export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly runs: RunRepository,
    private readonly workflows: WorkflowRepository,
    private readonly events: RunEventStore,
    private readonly orchestrator: Orchestrator,
  ) {}

  list(filter: { status?: string; q?: string }): Task[] {
    return this.tasks.list({
      status: filter.status?.trim() || undefined,
      q: filter.q?.trim() || undefined,
    });
  }

  create(input: TaskInput): Task {
    const workflowId = input.workflowId ?? this.matchWorkflowId(input);
    const workflow = this.workflows.findById(workflowId);
    if (!workflow) throw notFound('工作流不存在');
    if (workflow.status !== 'ENABLED') {
      throw conflict('WORKFLOW_DISABLED', '工作流未启用，无法用于创建任务');
    }

    return this.tasks.create({
      title: input.title,
      description: input.description ?? '',
      scenario: input.scenario?.trim() || workflow.scenario,
      workflowId: workflow.id,
    });
  }

  detail(id: string): TaskDetail {
    const task = this.tasks.findById(id);
    if (!task) throw notFound('任务不存在');
    const workflow = this.workflows.findById(task.workflowId) ?? null;
    const run = task.currentRunId ? this.runs.findRunDetail(task.currentRunId) ?? null : null;
    return { task, workflow, run, runs: this.runs.listRuns(id) };
  }

  async run(id: string): Promise<TaskDetail> {
    this.requireTask(id);
    await this.orchestrator.start(id);
    return this.detail(id);
  }

  cancel(id: string): TaskDetail {
    this.requireTask(id);
    this.orchestrator.cancel(id);
    return this.detail(id);
  }

  listRuns(id: string): TaskRun[] {
    this.requireTask(id);
    return this.runs.listRuns(id);
  }

  getRun(runId: string): RunDetail {
    const run = this.runs.findRunDetail(runId);
    if (!run) throw notFound('执行记录不存在');
    return run;
  }

  listEvents(runId: string, after = 0): RunEvent[] {
    if (!this.runs.findRun(runId)) throw notFound('执行记录不存在');
    return this.events.list(runId, after);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    return this.events.subscribe(runId, listener);
  }

  approve(runId: string, stepRunId: string, input: ApprovalInput): StepRun {
    const step = this.runs.findStepRun(stepRunId);
    if (!step || step.runId !== runId) throw notFound('步骤执行记录不存在');
    return this.orchestrator.approve(stepRunId, input);
  }

  private requireTask(id: string): Task {
    const task = this.tasks.findById(id);
    if (!task) throw notFound('任务不存在');
    return task;
  }

  private matchWorkflowId(input: TaskInput): string {
    const candidates = matchWorkflows(this.workflows.list(), {
      text: `${input.title}\n${input.description ?? ''}`,
      scenario: input.scenario?.trim() || undefined,
    });
    const best = candidates[0];
    if (!best) {
      throw badRequest('NO_WORKFLOW_MATCH', '没有匹配到已启用的工作流，请手动选择');
    }
    return best.workflow.id;
  }
}
