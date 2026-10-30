import { describe, expect, test } from 'vitest';
import { loadConfig } from '../../src/config';

describe('loadConfig', () => {
  test('provides safe local-first defaults', () => {
    const config = loadConfig({});

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4000);
    expect(config.databasePath).toBe('./data/autosdd.db');
    expect(config.llmProvider).toBe('auto');
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.anthropicModel).toBe('claude-sonnet-5');
    expect(config.mockFailStep).toBeUndefined();
    expect(config.stepTimeoutSeconds).toBeGreaterThan(0);
  });

  test('reads explicit environment values and trims them', () => {
    const config = loadConfig({
      HOST: ' 0.0.0.0 ',
      PORT: '5000',
      DATABASE_PATH: ' ./tmp/test.db ',
      LLM_PROVIDER: ' ANTHROPIC ',
      ANTHROPIC_API_KEY: ' test-key ',
      ANTHROPIC_MODEL: ' claude-opus-5 ',
      MOCK_DELAY_MS: '10',
      MOCK_FAIL_STEP: ' 编码实现 ',
      STEP_TIMEOUT_SECONDS: '60',
    });

    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 5000,
      databasePath: './tmp/test.db',
      llmProvider: 'anthropic',
      anthropicApiKey: 'test-key',
      anthropicModel: 'claude-opus-5',
      mockDelayMs: 10,
      mockFailStep: '编码实现',
      stepTimeoutSeconds: 60,
    });
  });

  test('falls back for unknown provider and invalid numbers', () => {
    const config = loadConfig({
      LLM_PROVIDER: 'gpt',
      PORT: 'not-a-number',
      MOCK_DELAY_MS: '-5',
      STEP_TIMEOUT_SECONDS: 'NaN',
    });

    expect(config.llmProvider).toBe('auto');
    expect(config.port).toBe(4000);
    expect(config.mockDelayMs).toBeGreaterThanOrEqual(0);
    expect(config.stepTimeoutSeconds).toBeGreaterThan(0);
  });

  test('accepts zero as a valid numeric value', () => {
    expect(loadConfig({ MOCK_DELAY_MS: '0' }).mockDelayMs).toBe(0);
  });
});
