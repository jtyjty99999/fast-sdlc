import type {
  GateMode,
  Workflow,
  WorkflowStatus,
  WorkflowStep,
  WorkflowSummary,
} from '@autosdd/shared';
import type { Db } from '../../db/database';
import { nowIso } from '../../db/clock';
import { newId } from '../../db/ids';

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  scenario: string;
  tags_json: string;
  match_keywords_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  step_count?: number;
}

interface StepRow {
  id: string;
  workflow_id: string;
  step_key: string;
  name: string;
  agent_id: string;
  agent_name: string;
  instruction_md: string;
  depends_on_json: string;
  order_index: number;
  gate_mode: string;
  timeout_seconds: number;
}

export interface ResolvedWorkflowStep {
  stepKey: string;
  name: string;
  agentId: string;
  instructionMd: string;
  dependsOn: string[];
  orderIndex: number;
  gateMode: GateMode;
  timeoutSeconds: number;
}

export interface WorkflowSaveInput {
  name: string;
  description: string;
  scenario: string;
  tags: string[];
  matchKeywords: string[];
  status: WorkflowStatus;
  steps: ResolvedWorkflowStep[];
}

function mapStepRow(row: StepRow): WorkflowStep {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepKey: row.step_key,
    name: row.name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    instructionMd: row.instruction_md,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    orderIndex: row.order_index,
    gateMode: row.gate_mode as GateMode,
    timeoutSeconds: row.timeout_seconds,
  };
}

function parseList(json: string): string[] {
  return JSON.parse(json) as string[];
}

export class WorkflowRepository {
  constructor(private readonly db: Db) {}

  list(): WorkflowSummary[] {
    const rows = this.db
      .prepare(
        `SELECT w.*,
           (SELECT COUNT(*) FROM workflow_steps s WHERE s.workflow_id = w.id) AS step_count
         FROM workflows w
         ORDER BY w.updated_at DESC`,
      )
      .all() as WorkflowRow[];

    const stepRows = this.db
      .prepare(
        `SELECT ws.workflow_id, a.name AS agent_name
         FROM workflow_steps ws
         JOIN agents a ON a.id = ws.agent_id
         ORDER BY ws.order_index ASC`,
      )
      .all() as Array<{ workflow_id: string; agent_name: string }>;

    const namesByWorkflow = new Map<string, string[]>();
    for (const row of stepRows) {
      const names = namesByWorkflow.get(row.workflow_id) ?? [];
      if (!names.includes(row.agent_name)) names.push(row.agent_name);
      namesByWorkflow.set(row.workflow_id, names);
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      scenario: row.scenario,
      tags: parseList(row.tags_json),
      matchKeywords: parseList(row.match_keywords_json),
      status: row.status as WorkflowStatus,
      stepCount: row.step_count ?? 0,
      agentNames: namesByWorkflow.get(row.id) ?? [],
      updatedAt: row.updated_at,
    }));
  }

  findById(id: string): Workflow | undefined {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as
      | WorkflowRow
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      scenario: row.scenario,
      tags: parseList(row.tags_json),
      matchKeywords: parseList(row.match_keywords_json),
      status: row.status as WorkflowStatus,
      steps: this.listSteps(id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listSteps(workflowId: string): WorkflowStep[] {
    const rows = this.db
      .prepare(
        `SELECT ws.*, a.name AS agent_name
         FROM workflow_steps ws
         JOIN agents a ON a.id = ws.agent_id
         WHERE ws.workflow_id = ?
         ORDER BY ws.order_index ASC, ws.step_key ASC`,
      )
      .all(workflowId) as StepRow[];
    return rows.map(mapStepRow);
  }

  create(input: WorkflowSaveInput, id = newId()): Workflow {
    const now = nowIso();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workflows
             (id, name, description, scenario, tags_json, match_keywords_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.description,
          input.scenario,
          JSON.stringify(input.tags),
          JSON.stringify(input.matchKeywords),
          input.status,
          now,
          now,
        );
      this.insertSteps(id, input.steps);
    });
    run();
    return this.findById(id)!;
  }

  update(id: string, input: WorkflowSaveInput): Workflow | undefined {
    const exists = this.db.prepare('SELECT id FROM workflows WHERE id = ?').get(id);
    if (!exists) return undefined;
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE workflows
           SET name = ?, description = ?, scenario = ?, tags_json = ?, match_keywords_json = ?,
               status = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          input.description,
          input.scenario,
          JSON.stringify(input.tags),
          JSON.stringify(input.matchKeywords),
          input.status,
          nowIso(),
          id,
        );
      this.db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(id);
      this.insertSteps(id, input.steps);
    });
    run();
    return this.findById(id);
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id).changes > 0;
  }

  countTasks(workflowId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM tasks WHERE workflow_id = ?')
      .get(workflowId) as { c: number };
    return row.c;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM workflows').get() as { c: number }).c;
  }

  countEnabled(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS c FROM workflows WHERE status = 'ENABLED'").get() as {
        c: number;
      }
    ).c;
  }

  private insertSteps(workflowId: string, steps: readonly ResolvedWorkflowStep[]): void {
    const statement = this.db.prepare(
      `INSERT INTO workflow_steps
         (id, workflow_id, step_key, name, agent_id, instruction_md, depends_on_json,
          order_index, gate_mode, timeout_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const step of steps) {
      statement.run(
        newId(),
        workflowId,
        step.stepKey,
        step.name,
        step.agentId,
        step.instructionMd,
        JSON.stringify(step.dependsOn),
        step.orderIndex,
        step.gateMode,
        step.timeoutSeconds,
      );
    }
  }
}
