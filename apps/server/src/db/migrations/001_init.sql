-- AutoSDD initial schema
-- IDs are ULIDs (TEXT); timestamps are ISO-8601 UTC (TEXT); JSON columns end in _json.

CREATE TABLE IF NOT EXISTS agents (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT 'claude-sonnet-5',
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT '通用',
  description    TEXT NOT NULL DEFAULT '',
  instructions_md TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'RULE'
              CHECK (type IN ('RULE', 'BUSINESS', 'API', 'LESSON', 'MEMORY')),
  content_md  TEXT NOT NULL DEFAULT '',
  tags_json   TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS agent_knowledge (
  agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, knowledge_id)
);

CREATE TABLE IF NOT EXISTS workflows (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  scenario           TEXT NOT NULL DEFAULT '',
  tags_json          TEXT NOT NULL DEFAULT '[]',
  match_keywords_json TEXT NOT NULL DEFAULT '[]',
  status             TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ENABLED')),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_key        TEXT NOT NULL,
  name            TEXT NOT NULL,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  instruction_md  TEXT NOT NULL DEFAULT '',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  order_index     INTEGER NOT NULL DEFAULT 0,
  gate_mode       TEXT NOT NULL DEFAULT 'NONE' CHECK (gate_mode IN ('NONE', 'HUMAN_APPROVAL')),
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  UNIQUE (workflow_id, step_key)
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  scenario       TEXT NOT NULL DEFAULT '',
  workflow_id    TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL DEFAULT 'QUEUED'
                 CHECK (status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELED')),
  current_run_id TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id                     TEXT PRIMARY KEY,
  task_id                TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_number             INTEGER NOT NULL,
  workflow_snapshot_json TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'RUNNING'
                         CHECK (status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELED')),
  error                  TEXT,
  created_at             TEXT NOT NULL,
  started_at             TEXT,
  finished_at            TEXT,
  UNIQUE (task_id, run_number)
);

CREATE TABLE IF NOT EXISTS step_runs (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_key            TEXT NOT NULL,
  step_name           TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  agent_name_snapshot TEXT NOT NULL,
  instruction_snapshot TEXT NOT NULL DEFAULT '',
  depends_on_json     TEXT NOT NULL DEFAULT '[]',
  order_index         INTEGER NOT NULL DEFAULT 0,
  gate_mode           TEXT NOT NULL DEFAULT 'NONE' CHECK (gate_mode IN ('NONE', 'HUMAN_APPROVAL')),
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELED', 'SKIPPED')),
  attempt             INTEGER NOT NULL DEFAULT 0,
  context_json        TEXT,
  output_md           TEXT,
  error               TEXT,
  model               TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  started_at          TEXT,
  finished_at         TEXT,
  UNIQUE (run_id, step_key)
);

CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_run_id  TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  comment      TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  decided_at   TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_run_id  TEXT,
  type         TEXT NOT NULL,
  message      TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

-- One active run per task.
CREATE UNIQUE INDEX IF NOT EXISTS ux_runs_active
  ON task_runs (task_id)
  WHERE status IN ('QUEUED', 'RUNNING', 'WAITING_APPROVAL');

-- One pending approval per step run.
CREATE UNIQUE INDEX IF NOT EXISTS ux_approvals_pending
  ON approvals (step_run_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
CREATE INDEX IF NOT EXISTS idx_agent_skills_skill ON agent_skills (skill_id);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_item ON agent_knowledge (knowledge_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_order ON workflow_steps (workflow_id, order_index);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks (workflow_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs (task_id, run_number);
CREATE INDEX IF NOT EXISTS idx_step_runs_run ON step_runs (run_id, order_index);
CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals (run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id, id);
