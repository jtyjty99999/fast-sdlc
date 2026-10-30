import { EventEmitter } from 'node:events';
import type { RunEvent } from '@autosdd/shared';
import type { Db } from '../db/database';
import { nowIso } from '../db/clock';

interface EventRow {
  id: number;
  run_id: string;
  step_run_id: string | null;
  type: string;
  message: string;
  payload_json: string;
  created_at: string;
}

export interface AppendEventInput {
  runId: string;
  stepRunId?: string | null;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
}

export const RUN_EVENT_TYPES = {
  RUN_STARTED: 'RUN_STARTED',
  STEP_READY: 'STEP_READY',
  STEP_STARTED: 'STEP_STARTED',
  STEP_DELTA: 'STEP_DELTA',
  STEP_OUTPUT: 'STEP_OUTPUT',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_DECIDED: 'APPROVAL_DECIDED',
  STEP_SUCCEEDED: 'STEP_SUCCEEDED',
  STEP_FAILED: 'STEP_FAILED',
  RUN_SUCCEEDED: 'RUN_SUCCEEDED',
  RUN_FAILED: 'RUN_FAILED',
  RUN_CANCELED: 'RUN_CANCELED',
  LOG: 'LOG',
} as const;

function mapEventRow(row: EventRow): RunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    type: row.type,
    message: row.message,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export class RunEventStore {
  private readonly emitter = new EventEmitter();

  constructor(private readonly db: Db) {
    this.emitter.setMaxListeners(200);
  }

  append(input: AppendEventInput): RunEvent {
    const result = this.db
      .prepare(
        `INSERT INTO run_events (run_id, step_run_id, type, message, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.stepRunId ?? null,
        input.type,
        input.message,
        JSON.stringify(input.payload ?? {}),
        nowIso(),
      );
    const event = this.findById(Number(result.lastInsertRowid))!;
    this.emitter.emit(`run:${input.runId}`, event);
    return event;
  }

  list(runId: string, afterId = 0, limit = 1000): RunEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
      )
      .all(runId, afterId, limit) as EventRow[];
    return rows.map(mapEventRow);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const channel = `run:${runId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  private findById(id: number): RunEvent | undefined {
    const row = this.db.prepare('SELECT * FROM run_events WHERE id = ?').get(id) as
      | EventRow
      | undefined;
    return row ? mapEventRow(row) : undefined;
  }
}
