import { describe, expect, test } from 'vitest';
import type { WorkflowSummary } from '@autosdd/shared';
import { matchWorkflows, scoreWorkflow } from '../../src/domain/workflows/matcher';

function workflow(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    id: 'wf_1',
    name: '新功能开发',
    description: '',
    scenario: '新功能',
    tags: ['feature', 'backend'],
    matchKeywords: ['新增', '功能'],
    status: 'ENABLED',
    stepCount: 3,
    agentNames: ['需求分析师'],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scoreWorkflow', () => {
  test('gives scenario a weight of 10 and records the reason', () => {
    const result = scoreWorkflow(workflow(), { text: '', scenario: '新功能' });

    expect(result.score).toBe(10);
    expect(result.reasons).toContain('场景匹配「新功能」');
  });

  test('scores each keyword 3 and each tag 1', () => {
    const result = scoreWorkflow(workflow(), {
      text: '请新增一个导出功能，属于 backend 范围',
    });

    // 关键词：新增、功能 → 6；标签：backend → 1
    expect(result.score).toBe(7);
    expect(result.reasons).toHaveLength(2);
  });

  test('matches English keywords case-insensitively', () => {
    const result = scoreWorkflow(workflow({ matchKeywords: ['Export'] }), {
      text: 'please add export support',
    });

    expect(result.score).toBe(3);
  });

  test('returns zero when nothing matches', () => {
    const result = scoreWorkflow(workflow(), { text: '完全无关的内容' });

    expect(result).toEqual({ score: 0, reasons: [] });
  });

  test('ignores empty keywords and tags', () => {
    const result = scoreWorkflow(
      workflow({ matchKeywords: ['', '新增'], tags: [''] }),
      { text: '新增' },
    );

    expect(result.score).toBe(3);
  });
});

describe('matchWorkflows', () => {
  test('excludes disabled workflows', () => {
    const candidates = matchWorkflows(
      [workflow({ id: 'a' }), workflow({ id: 'b', status: 'DRAFT' })],
      { text: '新增功能' },
    );

    expect(candidates.map((candidate) => candidate.workflow.id)).toEqual(['a']);
  });

  test('drops zero-score workflows', () => {
    const candidates = matchWorkflows([workflow()], { text: '无关内容' });

    expect(candidates).toEqual([]);
  });

  test('sorts by score descending and keeps at most three', () => {
    const workflows = [
      workflow({
        id: 'low',
        name: 'A',
        scenario: '其他',
        matchKeywords: ['新增'],
      }),
      workflow({
        id: 'high',
        name: 'B',
        scenario: '新功能',
        matchKeywords: ['新增', '功能'],
      }),
      workflow({
        id: 'mid',
        name: 'C',
        scenario: '新功能',
        tags: ['功能'],
        matchKeywords: ['新增'],
      }),
      workflow({
        id: 'fourth',
        name: 'D',
        scenario: '其他',
        matchKeywords: ['新增'],
      }),
    ];

    const candidates = matchWorkflows(workflows, {
      text: '新增功能',
      scenario: '新功能',
    });

    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.workflow.id)).toEqual([
      'high',
      'mid',
      'low',
    ]);
  });
});
