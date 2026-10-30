import {
  SUCCESS_STEP_STATUSES,
  type ApprovalInput,
  type SnapshotAgent,
  type StepRun,
  type TaskRun,
  type TaskStatus,
} from '@autosdd/shared';
import type { AppConfig } from '../config';
import type { AgentRepository } from '../domain/agents/repository';
import { toAgentProfile } from '../domain/agents/profile';
import type { TaskRepository } from '../domain/tasks/repository';
import type { RunRepository } from '../domain/tasks/run-repository';
import type { WorkflowRepository } from '../domain/workflows/repository';
import { validateWorkflowSteps } from '../domain/workflows/validator';
import { badRequest, conflict, notFound } from '../http/errors';
import { nowIso } from '../db/clock';
import { buildContext } from './context-builder';
import { RUN_EVENT_TYPES, type RunEventStore } from './run-events';
import { buildSnapshot } from './snapshot';
import type { AgentExecutor, ExecutorInput } from './types';

export interface OrchestratorLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
}

interface OrchestratorDeps {
  tasks: TaskRepository;
  runs: RunRepository;
  workflows: WorkflowRepository;
  agents: AgentRepository;
  events: RunEventStore;
  executor: AgentExecutor;
  config: AppConfig;
  logger: OrchestratorLogger;
}

const ACTIVE_STATUSES: TaskStatus[] = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'];
const TERMINAL_RUN_STATUSES: TaskStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELED'];
const SUCCESSFUL_STEP_STATUSES = new Set<string>(SUCCESS_STEP_STATUSES);
const MAX_LOOP_ITERATIONS = 200;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'APIUserAbortError')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

type StepOutcome = 'continue' | 'stop';

export class Orchestrator {
  private readonly scheduled = new Set<string>();
  private readonly running = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: OrchestratorDeps) {}

  async start(taskId: string): Promise<TaskRun> {
    const { tasks, runs, workflows, agents } = this.deps;
    const task = tasks.findById(taskId);
    if (!task) throw notFound('任务不存在');

    const active = runs.findActiveRun(taskId);
    if (active) {
      throw conflict('RUN_IN_PROGRESS', '该任务已有进行中的执行', { runId: active.id });
    }

    const workflow = workflows.findById(task.workflowId);
    if (!workflow) throw notFound('任务关联的工作流不存在');
    if (workflow.status !== 'ENABLED') {
      throw conflict('WORKFLOW_DISABLED', '工作流未启用，无法执行');
    }

    const validation = validateWorkflowSteps(workflow.steps, (agentId) =>
      agents.findById(agentId),
    );
    if (!validation.valid) {
      throw badRequest('WORKFLOW_INVALID', '工作流校验未通过，无法执行', validation.issues);
    }

    const snapshot = buildSnapshot(workflow, (agentId) => {
      const detail = agents.findDetail(agentId);
      if (!detail) throw notFound(`Agent ${agentId} 不存在`);
      return toAgentProfile(detail);
    });

    let run: TaskRun;
    try {
      run = runs.createRun({
        taskId,
        runNumber: runs.nextRunNumber(taskId),
        snapshot,
        steps: snapshot.steps,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('RUN_IN_PROGRESS', '该任务已有进行中的执行');
      }
      throw error;
    }

    tasks.setCurrentRun(taskId, run.id);
    tasks.updateStatus(taskId, 'QUEUED');
    this.deps.events.append({
      runId: run.id,
      type: RUN_EVENT_TYPES.LOG,
      message: `任务已加入队列：${workflow.name}`,
      payload: { runNumber: run.runNumber, stepCount: snapshot.steps.length },
    });
    this.schedule(run.id);
    return run;
  }

  schedule(runId: string): void {
    if (this.running.has(runId) || this.scheduled.has(runId)) return;
    this.scheduled.add(runId);
    setImmediate(() => {
      this.scheduled.delete(runId);
      void this.execute(runId);
    });
  }

  async execute(runId: string): Promise<void> {
    if (this.running.has(runId)) return;
    this.running.add(runId);
    try {
      await this.loop(runId);
    } catch (error) {
      this.deps.logger.error({ runId, error: errorMessage(error) }, 'run loop crashed');
      this.finish(runId, 'FAILED', `执行引擎异常：${errorMessage(error)}`);
    } finally {
      this.running.delete(runId);
    }
  }

  approve(stepRunId: string, input: ApprovalInput): StepRun {
    const { runs, tasks, events } = this.deps;
    const step = runs.findStepRun(stepRunId);
    if (!step) throw notFound('步骤执行记录不存在');
    const run = runs.findRun(step.runId);
    if (!run) throw notFound('执行记录不存在');
    if (run.status !== 'WAITING_APPROVAL') {
      throw conflict('RUN_NOT_WAITING_APPROVAL', '当前执行不在待审批状态');
    }
    const approval = runs.findPendingApproval(stepRunId);
    if (!approval) throw conflict('APPROVAL_NOT_PENDING', '该步骤没有待处理的审批');

    const decided = runs.decideApproval(approval.id, input.decision, input.comment ?? '');
    if (!decided) throw conflict('APPROVAL_NOT_PENDING', '审批已被处理');

    events.append({
      runId: run.id,
      stepRunId,
      type: RUN_EVENT_TYPES.APPROVAL_DECIDED,
      message:
        input.decision === 'APPROVED'
          ? `审批通过${input.comment ? `：${input.comment}` : ''}`
          : `审批驳回${input.comment ? `：${input.comment}` : ''}`,
      payload: { decision: input.decision, comment: input.comment ?? '' },
    });

    if (input.decision === 'APPROVED') {
      if (runs.markStepSucceeded(stepRunId)) {
        events.append({
          runId: run.id,
          stepRunId,
          type: RUN_EVENT_TYPES.STEP_SUCCEEDED,
          message: `步骤「${step.stepName}」审批通过，标记成功`,
        });
      }
      if (runs.transitionRun(run.id, ['WAITING_APPROVAL'], 'RUNNING')) {
        tasks.updateStatus(run.taskId, 'RUNNING');
        this.schedule(run.id);
      }
    } else {
      const reason = input.comment?.trim() ? `审批驳回：${input.comment.trim()}` : '审批驳回';
      if (runs.markStepFailed(stepRunId, reason)) {
        events.append({
          runId: run.id,
          stepRunId,
          type: RUN_EVENT_TYPES.STEP_FAILED,
          message: `步骤「${step.stepName}」被驳回`,
          payload: { error: reason },
        });
      }
      this.finish(run.id, 'FAILED', reason);
    }

    return runs.findStepRun(stepRunId)!;
  }

  cancel(taskId: string): TaskRun {
    const { tasks, runs, events } = this.deps;
    const task = tasks.findById(taskId);
    if (!task) throw notFound('任务不存在');
    const run = runs.findActiveRun(taskId);
    if (!run) throw conflict('NO_ACTIVE_RUN', '任务没有进行中的执行');

    const canceled = runs.transitionRun(run.id, ACTIVE_STATUSES, 'CANCELED', {
      finishedAt: nowIso(),
    });
    if (!canceled) throw conflict('RUN_NOT_ACTIVE', '执行已结束，无法取消');

    this.controllers.get(run.id)?.abort();
    runs.cancelPendingSteps(run.id);
    runs.cancelPendingApprovals(run.id);
    tasks.updateStatus(taskId, 'CANCELED');
    events.append({
      runId: run.id,
      type: RUN_EVENT_TYPES.RUN_CANCELED,
      message: '任务已取消',
    });
    return runs.findRun(run.id)!;
  }

  recoverInterruptedRuns(): number {
    const { runs, tasks, events } = this.deps;
    const interrupted = [...runs.listRunsByStatus('RUNNING'), ...runs.listRunsByStatus('QUEUED')];
    let recovered = 0;
    for (const run of interrupted) {
      const changed = runs.transitionRun(run.id, ['QUEUED', 'RUNNING'], 'FAILED', {
        error: 'SERVER_RESTARTED',
        finishedAt: nowIso(),
      });
      if (!changed) continue;
      runs.failUnfinishedSteps(run.id, '服务重启，执行已中断');
      runs.cancelPendingApprovals(run.id, '服务重启，审批已失效');
      tasks.updateStatus(run.taskId, 'FAILED');
      events.append({
        runId: run.id,
        type: RUN_EVENT_TYPES.RUN_FAILED,
        message: '服务重启，执行已中断，请重跑',
        payload: { error: 'SERVER_RESTARTED' },
      });
      recovered += 1;
    }
    return recovered;
  }

  private async loop(runId: string): Promise<void> {
    const { runs, tasks, events } = this.deps;
    let run = runs.findRun(runId);
    if (!run || TERMINAL_RUN_STATUSES.includes(run.status)) return;

    if (run.status === 'QUEUED') {
      const started = runs.transitionRun(runId, ['QUEUED'], 'RUNNING', {
        startedAt: nowIso(),
      });
      if (!started) return;
      events.append({
        runId,
        type: RUN_EVENT_TYPES.RUN_STARTED,
        message: `开始执行（第 ${run.runNumber} 次）`,
      });
      run = runs.findRun(runId)!;
    }

    if (run.status === 'WAITING_APPROVAL') return;

    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration += 1) {
      const current = runs.findRun(runId);
      if (!current || TERMINAL_RUN_STATUSES.includes(current.status)) return;

      const steps = runs.listStepRuns(runId);
      const failed = steps.find((step) => step.status === 'FAILED');
      if (failed) {
        this.finish(runId, 'FAILED', failed.error ?? `步骤「${failed.stepName}」失败`);
        return;
      }

      if (steps.every((step) => SUCCESSFUL_STEP_STATUSES.has(step.status))) {
        this.finish(runId, 'SUCCEEDED');
        return;
      }

      if (steps.some((step) => step.status === 'WAITING_APPROVAL')) {
        if (runs.transitionRun(runId, ['RUNNING'], 'WAITING_APPROVAL')) {
          tasks.updateStatus(current.taskId, 'WAITING_APPROVAL');
        }
        return;
      }

      const successKeys = new Set(
        steps
          .filter((step) => SUCCESSFUL_STEP_STATUSES.has(step.status))
          .map((step) => step.stepKey),
      );
      const ready = steps
        .filter(
          (step) =>
            step.status === 'PENDING' &&
            step.dependsOn.every((dependency) => successKeys.has(dependency)),
        )
        .sort((a, b) => a.orderIndex - b.orderIndex);

      if (ready.length === 0) {
        this.finish(runId, 'FAILED', '没有可执行的步骤，依赖无法满足');
        return;
      }

      const outcome = await this.executeStep(runId, current.taskId, ready[0]!, steps);
      if (outcome === 'stop') return;
    }

    this.finish(runId, 'FAILED', '执行步数超过安全上限');
  }

  private async executeStep(
    runId: string,
    taskId: string,
    step: StepRun,
    allSteps: readonly StepRun[],
  ): Promise<StepOutcome> {
    const { runs, events, executor } = this.deps;
    const snapshot = runs.findRunSnapshot(runId);
    const task = this.deps.tasks.findById(taskId);
    if (!snapshot || !task) {
      this.finish(runId, 'FAILED', '执行快照或任务数据缺失');
      return 'stop';
    }

    const agent: SnapshotAgent | undefined = snapshot.agents[step.agentId];
    if (!agent) {
      const message = `快照中缺少 Agent「${step.agentName}」`;
      runs.markStepFailed(step.id, message);
      events.append({
        runId,
        stepRunId: step.id,
        type: RUN_EVENT_TYPES.STEP_FAILED,
        message,
      });
      this.finish(runId, 'FAILED', message);
      return 'stop';
    }

    const dependencyOutputs = step.dependsOn
      .map((key) => allSteps.find((candidate) => candidate.stepKey === key))
      .filter((candidate): candidate is StepRun => candidate !== undefined)
      .map((candidate) => ({
        stepKey: candidate.stepKey,
        stepName: candidate.stepName,
        outputMd: candidate.outputMd,
      }));

    const context = buildContext({
      agent,
      task: { title: task.title, description: task.description, scenario: task.scenario },
      step: {
        stepKey: step.stepKey,
        name: step.stepName,
        instructionMd: step.instructionMd,
        gateMode: step.gateMode,
      },
      dependencyOutputs,
    });

    if (!runs.markStepReady(step.id)) return 'stop';
    events.append({
      runId,
      stepRunId: step.id,
      type: RUN_EVENT_TYPES.STEP_READY,
      message: `步骤「${step.stepName}」就绪`,
    });

    const model = executor.kind === 'anthropic' ? agent.model : executor.model;
    if (!runs.markStepRunning(step.id, context, model)) return 'stop';
    events.append({
      runId,
      stepRunId: step.id,
      type: RUN_EVENT_TYPES.STEP_STARTED,
      message: `步骤「${step.stepName}」开始，执行者：${agent.name}`,
      payload: { agentName: agent.name, model },
    });

    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const timeoutSeconds =
      snapshot.steps.find((candidate) => candidate.stepKey === step.stepKey)?.timeoutSeconds ??
      this.deps.config.stepTimeoutSeconds;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, timeoutSeconds) * 1000);
    timer.unref?.();

    const input: ExecutorInput = {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      model: agent.model,
      stepName: step.stepName,
      taskTitle: task.title,
      systemPrompt: context.systemPrompt,
      userPrompt: context.userPrompt,
    };

    try {
      const result = await executor.run(
        input,
        (event) => {
          events.append({
            runId,
            stepRunId: step.id,
            type: RUN_EVENT_TYPES.STEP_DELTA,
            message: '',
            payload: { text: event.text },
          });
        },
        controller.signal,
      );
      clearTimeout(timer);
      this.controllers.delete(runId);

      const latest = runs.findRun(runId);
      if (!latest || latest.status === 'CANCELED') {
        runs.markStepCanceled(step.id);
        return 'stop';
      }
      if (!result.outputMd.trim()) {
        throw new Error('执行器返回了空产物');
      }

      events.append({
        runId,
        stepRunId: step.id,
        type: RUN_EVENT_TYPES.STEP_OUTPUT,
        message: `步骤「${step.stepName}」产物已生成`,
        payload: {
          chars: result.outputMd.length,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      });

      if (step.gateMode === 'HUMAN_APPROVAL') {
        const waiting = runs.markStepWaitingApproval(step.id, result.outputMd, {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          model: result.model,
        });
        if (!waiting) return 'stop';
        const approval = runs.createApproval(runId, step.id);
        events.append({
          runId,
          stepRunId: step.id,
          type: RUN_EVENT_TYPES.APPROVAL_REQUESTED,
          message: `步骤「${step.stepName}」等待人工审批`,
          payload: { approvalId: approval.id },
        });
        if (runs.transitionRun(runId, ['RUNNING'], 'WAITING_APPROVAL')) {
          this.deps.tasks.updateStatus(taskId, 'WAITING_APPROVAL');
        }
        return 'stop';
      }

      if (
        !runs.markStepSucceeded(step.id, {
          outputMd: result.outputMd,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        })
      ) {
        return 'stop';
      }
      events.append({
        runId,
        stepRunId: step.id,
        type: RUN_EVENT_TYPES.STEP_SUCCEEDED,
        message: `步骤「${step.stepName}」完成`,
        payload: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          model: result.model,
        },
      });
      return 'continue';
    } catch (error) {
      clearTimeout(timer);
      this.controllers.delete(runId);
      const latest = runs.findRun(runId);
      if (latest?.status === 'CANCELED' || (isAbortError(error) && !timedOut)) {
        runs.markStepCanceled(step.id);
        return 'stop';
      }
      const message = timedOut
        ? `步骤超时（${timeoutSeconds}s）`
        : errorMessage(error);
      if (runs.markStepFailed(step.id, message)) {
        events.append({
          runId,
          stepRunId: step.id,
          type: RUN_EVENT_TYPES.STEP_FAILED,
          message: `步骤「${step.stepName}」失败：${message}`,
          payload: { error: message },
        });
      }
      this.finish(runId, 'FAILED', message);
      return 'stop';
    }
  }

  private finish(
    runId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELED',
    error?: string,
  ): boolean {
    const { runs, tasks, events } = this.deps;
    const run = runs.findRun(runId);
    if (!run) return false;

    const changed = runs.transitionRun(runId, ACTIVE_STATUSES, status, {
      finishedAt: nowIso(),
      ...(status === 'FAILED' ? { error: error ?? '执行失败' } : {}),
    });
    if (!changed) return false;

    runs.cancelPendingSteps(runId);
    tasks.updateStatus(run.taskId, status);

    if (status === 'SUCCEEDED') {
      events.append({
        runId,
        type: RUN_EVENT_TYPES.RUN_SUCCEEDED,
        message: '全部步骤完成，任务成功',
      });
    } else {
      events.append({
        runId,
        type: status === 'FAILED' ? RUN_EVENT_TYPES.RUN_FAILED : RUN_EVENT_TYPES.RUN_CANCELED,
        message: status === 'FAILED' ? `任务失败：${error ?? '执行失败'}` : '任务已取消',
        payload: error ? { error } : {},
      });
    }
    this.deps.logger.info({ runId, status }, 'run finished');
    return true;
  }
}
