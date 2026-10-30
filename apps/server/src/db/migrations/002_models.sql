-- Model registry: models become first-class assets referenced by agents.
-- Built-in rows use fixed IDs so every database (fresh or upgraded) has a
-- usable default model even before seeding.

CREATE TABLE IF NOT EXISTS models (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  provider   TEXT NOT NULL CHECK (provider IN ('mock', 'anthropic', 'openai')),
  model_id   TEXT NOT NULL,
  base_url   TEXT NOT NULL DEFAULT '',
  api_key    TEXT,
  max_tokens INTEGER NOT NULL DEFAULT 4096 CHECK (max_tokens > 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- At most one default model. The service additionally refuses to delete or
-- disable it, which keeps at least one default present after migration.
CREATE UNIQUE INDEX IF NOT EXISTS ux_models_default ON models (is_default) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_models_status ON models (status);

INSERT INTO models (id, name, provider, model_id, base_url, api_key, max_tokens, is_default, status, created_at, updated_at)
VALUES ('mdl_mock_default', 'Mock 模拟模型', 'mock', 'mock', '', NULL, 4096, 1, 'ACTIVE',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO models (id, name, provider, model_id, base_url, api_key, max_tokens, is_default, status, created_at, updated_at)
VALUES ('mdl_claude_sonnet', 'Claude Sonnet 5', 'anthropic', 'claude-sonnet-5', '', NULL, 4096, 0, 'ACTIVE',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- SQLite requires an added REFERENCES column to default to NULL. The service
-- enforces non-null, and legacy agents are backfilled to the mock default.
ALTER TABLE agents ADD COLUMN model_id TEXT REFERENCES models(id);
UPDATE agents SET model_id = 'mdl_mock_default' WHERE model_id IS NULL;
ALTER TABLE agents DROP COLUMN model;
CREATE INDEX IF NOT EXISTS idx_agents_model ON agents (model_id);
