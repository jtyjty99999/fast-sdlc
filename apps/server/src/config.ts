import { DEFAULT_MOCK_DELAY_MS, DEFAULT_STEP_TIMEOUT_SECONDS } from '@autosdd/shared';

export type LlmProvider = 'mock' | 'anthropic';

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  llmProvider: LlmProvider | 'auto';
  anthropicApiKey: string | undefined;
  anthropicModel: string;
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
  const provider = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
  const llmProvider: AppConfig['llmProvider'] =
    provider === 'mock' || provider === 'anthropic' ? provider : 'auto';

  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: numberFromEnv(env.PORT, 4000),
    databasePath: env.DATABASE_PATH?.trim() || './data/autosdd.db',
    llmProvider,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5',
    mockDelayMs: numberFromEnv(env.MOCK_DELAY_MS, DEFAULT_MOCK_DELAY_MS),
    mockFailStep: env.MOCK_FAIL_STEP?.trim() || undefined,
    stepTimeoutSeconds: numberFromEnv(env.STEP_TIMEOUT_SECONDS, DEFAULT_STEP_TIMEOUT_SECONDS),
  };
}
