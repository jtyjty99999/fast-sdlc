import type { Task, TaskStatus } from '@autosdd/shared';
import type { Db } from '../../db/database';
import { nowIso } from '../../db/clock';
import { newId } from '../../db/ids';

interface TaskRow {
  id: string;
  title: string;
  description: string;
  scenario: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  current_run_id: string | null;
  current_step_name: string | null;
  created_at: string;
  updated_at: string;
}

const TASK_SELECT = `
  SELECT t.*, w.name AS workflow_name,
    (SELECT sr.step_name FROM step_runs sr
      WHERE sr.run_id = t.current_run_id
        AND sr.status IN ('READY', 'RUNNING', 'WAITING_APPROVAL')
      ORDER BY sr.order_index ASC
      LIMIT 1) AS current_step_name
  FROM tasks t
  JOIN workflows w ON w.id = t.workflow_id
`;

export interface TaskListFilter {
  status?: string;
  q?: string;
}

export function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    scenario: row.scenario,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    status: row.status as TaskStatus,
    currentRunId: row.current_run_id,
    currentStepName: row.current_step_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TaskRepository {
  constructor(private readonly db: Db) {}

  list(filter: TaskListFilter = {}): Task[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push('t.status = ?');
      params.push(filter.status);
    }
    if (filter.q) {
      clauses.push('(t.title LIKE ? OR t.description LIKE ?)');
      params.push(`%${filter.q}%`, `%${filter.q}%`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`${TASK_SELECT} ${where} ORDER BY t.created_at DESC`)
      .all(...params) as TaskRow[];
    return rows.map(mapTaskRow);
  }

  findById(id: string): Task | undefined {
    const row = this.db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as TaskRow | undefined;
    return row ? mapTaskRow(row) : undefined;
  }

  create(
    input: { title: string; description: string; scenario: string; workflowId: string },
    id = newId(),
  ): Task {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO tasks
           (id, title, description, scenario, workflow_id, status, current_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'QUEUED', NULL, ?, ?)`,
      )
      .run(id, input.title, input.description, input.scenario, input.workflowId, now, now);
    return this.findById(id)!;
  }

  updateStatus(id: string, status: TaskStatus): boolean {
    const result = this.db
      .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIso(), id);
    return result.changes > 0;
  }

  setCurrentRun(id: string, runId: string | null): void {
    this.db
      .prepare('UPDATE tasks SET current_run_id = ?, updated_at = ? WHERE id = ?')
      .run(runId, nowIso(), id);
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c;
  }

  countByStatus(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      QUEUED: 0,
      RUNNING: 0,
      WAITING_APPROVAL: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      CANCELED: 0,
    };
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status')
      .all() as Array<{ status: string; c: number }>;
    for (const row of rows) {
      if (row.status in counts) counts[row.status as TaskStatus] = row.c;
    }
    return counts;
  }
}
