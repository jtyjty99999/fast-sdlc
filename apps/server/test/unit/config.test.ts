import { describe, expect, test } from 'vitest';
import { loadConfig } from '../../src/config';

describe('loadConfig', () => {
  test('provides safe local-first defaults', () => {
    const config = loadConfig({});

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4000);
    expect(config.databasePath).toBe('./data/autosdd.db');
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.mockFailStep).toBeUndefined();
    expect(config.stepTimeoutSeconds).toBeGreaterThan(0);
  });

  test('reads explicit environment values and trims them', () => {
    const config = loadConfig({
      HOST: ' 0.0.0.0 ',
      PORT: '5000',
      DATABASE_PATH: ' ./tmp/test.db ',
      ANTHROPIC_API_KEY: ' test-key ',
      OPENAI_API_KEY: ' test-openai-key ',
      MOCK_DELAY_MS: '10',
      MOCK_FAIL_STEP: ' 编码实现 ',
      STEP_TIMEOUT_SECONDS: '60',
    });

    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 5000,
      databasePath: './tmp/test.db',
      anthropicApiKey: 'test-key',
      openaiApiKey: 'test-openai-key',
      mockDelayMs: 10,
      mockFailStep: '编码实现',
      stepTimeoutSeconds: 60,
    });
  });

  test('falls back for invalid numbers', () => {
    const config = loadConfig({
      PORT: 'not-a-number',
      MOCK_DELAY_MS: '-5',
      STEP_TIMEOUT_SECONDS: 'NaN',
    });

    expect(config.port).toBe(4000);
    expect(config.mockDelayMs).toBeGreaterThanOrEqual(0);
    expect(config.stepTimeoutSeconds).toBeGreaterThan(0);
  });

  test('accepts zero as a valid numeric value', () => {
    expect(loadConfig({ MOCK_DELAY_MS: '0' }).mockDelayMs).toBe(0);
  });
});
