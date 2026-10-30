import type {
  Approval,
  ApprovalDecision,
  ApprovalStatus,
  BuiltContext,
  GateMode,
  RunDetail,
  SnapshotStep,
  StepRun,
  StepStatus,
  TaskRun,
  TaskStatus,
  WorkflowSnapshot,
} from '@autosdd/shared';
import type { Db } from '../../db/database';
import { nowIso } from '../../db/clock';
import { newId } from '../../db/ids';

interface RunRow {
  id: string;
  task_id: string;
  run_number: number;
  workflow_snapshot_json: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface StepRunRow {
  id: string;
  run_id: string;
  step_key: string;
  step_name: string;
  agent_id: string;
  agent_name_snapshot: string;
  instruction_snapshot: string;
  depends_on_json: string;
  order_index: number;
  gate_mode: string;
  status: string;
  attempt: number;
  context_json: string | null;
  output_md: string | null;
  error: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  started_at: string | null;
  finished_at: string | null;
}

interface ApprovalRow {
  id: string;
  run_id: string;
  step_run_id: string;
  status: string;
  comment: string;
  requested_at: string;
  decided_at: string | null;
}

export function mapRunRow(row: RunRow): TaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    runNumber: row.run_number,
    status: row.status as TaskStatus,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapApprovalRow(row: ApprovalRow): Approval {
  return {
    id: row.id,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    status: row.status as ApprovalStatus,
    comment: row.comment,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
  };
}

function mapStepRunRow(row: StepRunRow, approval: Approval | null): StepRun {
  return {
    id: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    stepName: row.step_name,
    agentId: row.agent_id,
    agentName: row.agent_name_snapshot,
    instructionMd: row.instruction_snapshot,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    orderIndex: row.order_index,
    gateMode: row.gate_mode as GateMode,
    status: row.status as StepStatus,
    attempt: row.attempt,
    context: row.context_json ? (JSON.parse(row.context_json) as BuiltContext) : null,
    outputMd: row.output_md,
    error: row.error,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    approval,
  };
}

export interface CreateRunParams {
  taskId: string;
  runNumber: number;
  snapshot: WorkflowSnapshot;
  steps: readonly SnapshotStep[];
}

const NON_TERMINAL_STEP_STATUSES: StepStatus[] = [
  'PENDING',
  'READY',
  'RUNNING',
  'WAITING_APPROVAL',
];

export class RunRepository {
  constructor(private readonly db: Db) {}

  listRuns(taskId: string): TaskRun[] {
    const rows = this.db
      .prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY run_number DESC')
      .all(taskId) as RunRow[];
    return rows.map(mapRunRow);
  }

  findRun(runId: string): TaskRun | undefined {
    const row = this.db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as
      | RunRow
      | undefined;
    return row ? mapRunRow(row) : undefined;
  }

  findRunSnapshot(runId: string): WorkflowSnapshot | undefined {
    const row = this.db
      .prepare('SELECT workflow_snapshot_json FROM task_runs WHERE id = ?')
      .get(runId) as { workflow_snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.workflow_snapshot_json) as WorkflowSnapshot) : undefined;
  }

  findActiveRun(taskId: string): TaskRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM task_runs
         WHERE task_id = ? AND status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL')
         ORDER BY run_number DESC LIMIT 1`,
      )
      .get(taskId) as RunRow | undefined;
    return row ? mapRunRow(row) : undefined;
  }

  nextRunNumber(taskId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(run_number), 0) + 1 AS n FROM task_runs WHERE task_id = ?')
      .get(taskId) as { n: number };
    return row.n;
  }

  createRun(params: CreateRunParams): TaskRun {
    const runId = newId();
    const now = nowIso();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO task_runs
             (id, task_id, run_number, workflow_snapshot_json, status, error, created_at, started_at, finished_at)
           VALUES (?, ?, ?, ?, 'QUEUED', NULL, ?, NULL, NULL)`,
        )
        .run(runId, params.taskId, params.runNumber, JSON.stringify(params.snapshot), now);

      const statement = this.db.prepare(
        `INSERT INTO step_runs
           (id, run_id, step_key, step_name, agent_id, agent_name_snapshot, instruction_snapshot,
            depends_on_json, order_index, gate_mode, status, attempt, context_json, output_md, error,
            model, input_tokens, output_tokens, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      );
      for (const step of params.steps) {
        const agentName = params.snapshot.agents[step.agentId]?.name ?? step.agentId;
        statement.run(
          newId(),
          runId,
          step.stepKey,
          step.name,
          step.agentId,
          agentName,
          step.instructionMd,
          JSON.stringify(step.dependsOn),
          step.orderIndex,
          step.gateMode,
        );
      }
    });
    run();
    return this.findRun(runId)!;
  }

  listStepRuns(runId: string): StepRun[] {
    const rows = this.db
      .prepare('SELECT * FROM step_runs WHERE run_id = ? ORDER BY order_index ASC, step_key ASC')
      .all(runId) as StepRunRow[];
    const approvals = this.listApprovals(runId);
    const latest = new Map<string, Approval>();
    for (const approval of approvals) latest.set(approval.stepRunId, approval);
    return rows.map((row) => mapStepRunRow(row, latest.get(row.id) ?? null));
  }

  findStepRun(stepRunId: string): StepRun | undefined {
    const row = this.db.prepare('SELECT * FROM step_runs WHERE id = ?').get(stepRunId) as
      | StepRunRow
      | undefined;
    if (!row) return undefined;
    const approval = this.findLatestApproval(stepRunId);
    return mapStepRunRow(row, approval ?? null);
  }

  findRunDetail(runId: string): RunDetail | undefined {
    const run = this.findRun(runId);
    if (!run) return undefined;
    return { ...run, steps: this.listStepRuns(runId), approvals: this.listApprovals(runId) };
  }

  updateRunStatus(
    runId: string,
    status: TaskStatus,
    options: { error?: string | null; startedAt?: string | null; finishedAt?: string | null } = {},
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE task_runs
         SET status = ?,
             error = CASE WHEN ? THEN ? ELSE error END,
             started_at = CASE WHEN ? THEN ? ELSE started_at END,
             finished_at = CASE WHEN ? THEN ? ELSE finished_at END
         WHERE id = ?`,
      )
      .run(
        status,
        options.error !== undefined ? 1 : 0,
        options.error ?? null,
        options.startedAt !== undefined ? 1 : 0,
        options.startedAt ?? null,
        options.finishedAt !== undefined ? 1 : 0,
        options.finishedAt ?? null,
        runId,
      );
    return result.changes > 0;
  }

  transitionRun(
    runId: string,
    expected: readonly TaskStatus[],
    status: TaskStatus,
    options: { error?: string | null; startedAt?: string | null; finishedAt?: string | null } = {},
  ): boolean {
    const placeholders = expected.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE task_runs
         SET status = ?,
             error = CASE WHEN ? THEN ? ELSE error END,
             started_at = CASE WHEN ? THEN ? ELSE started_at END,
             finished_at = CASE WHEN ? THEN ? ELSE finished_at END
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(
        status,
        options.error !== undefined ? 1 : 0,
        options.error ?? null,
        options.startedAt !== undefined ? 1 : 0,
        options.startedAt ?? null,
        options.finishedAt !== undefined ? 1 : 0,
        options.finishedAt ?? null,
        runId,
        ...expected,
      );
    return result.changes > 0;
  }

  markStepReady(stepRunId: string): boolean {
    return this.transitionStep(stepRunId, ['PENDING'], 'READY');
  }

  markStepRunning(stepRunId: string, context: BuiltContext, model: string): boolean {
    return this.transitionStep(stepRunId, ['READY'], 'RUNNING', {
      context_json: JSON.stringify(context),
      model,
      started_at: nowIso(),
      attempt: this.nextAttempt(stepRunId),
    });
  }

  markStepWaitingApproval(
    stepRunId: string,
    outputMd: string,
    usage: { inputTokens: number | null; outputTokens: number | null; model: string },
  ): boolean {
    return this.transitionStep(stepRunId, ['RUNNING'], 'WAITING_APPROVAL', {
      output_md: outputMd,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      finished_at: nowIso(),
    });
  }

  markStepSucceeded(
    stepRunId: string,
    result?: {
      outputMd?: string;
      model?: string;
      inputTokens?: number | null;
      outputTokens?: number | null;
    },
  ): boolean {
    const patch: Record<string, string | number | null> = { finished_at: nowIso() };
    if (result?.outputMd !== undefined) patch.output_md = result.outputMd;
    if (result?.model !== undefined) patch.model = result.model;
    if (result?.inputTokens !== undefined) patch.input_tokens = result.inputTokens;
    if (result?.outputTokens !== undefined) patch.output_tokens = result.outputTokens;
    return this.transitionStep(stepRunId, ['RUNNING', 'WAITING_APPROVAL'], 'SUCCEEDED', patch);
  }

  markStepFailed(stepRunId: string, error: string): boolean {
    return this.transitionStep(stepRunId, NON_TERMINAL_STEP_STATUSES, 'FAILED', {
      error,
      finished_at: nowIso(),
    });
  }

  markStepCanceled(stepRunId: string): boolean {
    return this.transitionStep(stepRunId, NON_TERMINAL_STEP_STATUSES, 'CANCELED', {
      finished_at: nowIso(),
    });
  }

  cancelPendingSteps(runId: string): number {
    const placeholders = NON_TERMINAL_STEP_STATUSES.map(() => '?').join(', ');
    return this.db
      .prepare(
        `UPDATE step_runs SET status = 'CANCELED', finished_at = ?
         WHERE run_id = ? AND status IN (${placeholders})`,
      )
      .run(nowIso(), runId, ...NON_TERMINAL_STEP_STATUSES).changes;
  }

  failUnfinishedSteps(runId: string, error: string): number {
    const placeholders = NON_TERMINAL_STEP_STATUSES.map(() => '?').join(', ');
    return this.db
      .prepare(
        `UPDATE step_runs SET status = 'FAILED', error = ?, finished_at = ?
         WHERE run_id = ? AND status IN (${placeholders})`,
      )
      .run(error, nowIso(), runId, ...NON_TERMINAL_STEP_STATUSES).changes;
  }

  cancelPendingApprovals(runId: string, comment = '任务已取消'): number {
    return this.db
      .prepare(
        `UPDATE approvals SET status = 'REJECTED', comment = ?, decided_at = ?
         WHERE run_id = ? AND status = 'PENDING'`,
      )
      .run(comment, nowIso(), runId).changes;
  }

  createApproval(runId: string, stepRunId: string): Approval {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO approvals (id, run_id, step_run_id, status, comment, requested_at, decided_at)
         VALUES (?, ?, ?, 'PENDING', '', ?, NULL)`,
      )
      .run(id, runId, stepRunId, nowIso());
    return this.findApproval(id)!;
  }

  findApproval(id: string): Approval | undefined {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as
      | ApprovalRow
      | undefined;
    return row ? mapApprovalRow(row) : undefined;
  }

  findPendingApproval(stepRunId: string): Approval | undefined {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE step_run_id = ? AND status = 'PENDING'")
      .get(stepRunId) as ApprovalRow | undefined;
    return row ? mapApprovalRow(row) : undefined;
  }

  findLatestApproval(stepRunId: string): Approval | undefined {
    const row = this.db
      .prepare('SELECT * FROM approvals WHERE step_run_id = ? ORDER BY requested_at DESC LIMIT 1')
      .get(stepRunId) as ApprovalRow | undefined;
    return row ? mapApprovalRow(row) : undefined;
  }

  listApprovals(runId: string): Approval[] {
    const rows = this.db
      .prepare('SELECT * FROM approvals WHERE run_id = ? ORDER BY requested_at ASC')
      .all(runId) as ApprovalRow[];
    return rows.map(mapApprovalRow);
  }

  decideApproval(id: string, decision: ApprovalDecision, comment: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE approvals SET status = ?, comment = ?, decided_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(decision, comment, nowIso(), id);
    return result.changes > 0;
  }

  listRunsByStatus(status: TaskStatus): TaskRun[] {
    const rows = this.db
      .prepare('SELECT * FROM task_runs WHERE status = ? ORDER BY created_at ASC')
      .all(status) as RunRow[];
    return rows.map(mapRunRow);
  }

  taskIdOfRun(runId: string): string | undefined {
    const row = this.db.prepare('SELECT task_id FROM task_runs WHERE id = ?').get(runId) as
      | { task_id: string }
      | undefined;
    return row?.task_id;
  }

  private nextAttempt(stepRunId: string): number {
    const row = this.db.prepare('SELECT attempt FROM step_runs WHERE id = ?').get(stepRunId) as
      | { attempt: number }
      | undefined;
    return (row?.attempt ?? 0) + 1;
  }

  private transitionStep(
    stepRunId: string,
    expected: readonly StepStatus[],
    status: StepStatus,
    patch: Record<string, string | number | null> = {},
  ): boolean {
    const entries = Object.entries(patch);
    const assignments = ['status = ?', ...entries.map(([column]) => `${column} = ?`)];
    const placeholders = expected.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE step_runs SET ${assignments.join(', ')}
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(status, ...entries.map(([, value]) => value), stepRunId, ...expected);
    return result.changes > 0;
  }
}
