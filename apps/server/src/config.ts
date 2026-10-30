import { DEFAULT_MOCK_DELAY_MS, DEFAULT_STEP_TIMEOUT_SECONDS } from '@autosdd/shared';

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;
  mockDelayMs: number;
  mockFailStep: string | undefined;
  stepTimeoutSeconds: number;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: numberFromEnv(env.PORT, 4000),
    databasePath: env.DATABASE_PATH?.trim() || './data/autosdd.db',
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    openaiApiKey: env.OPENAI_API_KEY?.trim() || undefined,
    mockDelayMs: numberFromEnv(env.MOCK_DELAY_MS, DEFAULT_MOCK_DELAY_MS),
    mockFailStep: env.MOCK_FAIL_STEP?.trim() || undefined,
    stepTimeoutSeconds: numberFromEnv(env.STEP_TIMEOUT_SECONDS, DEFAULT_STEP_TIMEOUT_SECONDS),
  };
}
