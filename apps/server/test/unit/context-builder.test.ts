import { describe, expect, test } from 'vitest';
import { CONTEXT_BUDGETS } from '@autosdd/shared';
import type { AgentProfile, ContextBuildInput } from '../../src/execution/types';
import { buildContext, clampText } from '../../src/execution/context-builder';

function makeInput(overrides: Partial<ContextBuildInput> = {}): ContextBuildInput {
  const agent: AgentProfile = {
    id: 'agent_1',
    name: '需求分析师',
    role: '需求分析',
    description: '负责把模糊诉求变成可验收需求。',
    systemPrompt: '保持克制，结论先行。',
    modelId: 'mdl_mock_default',
    modelName: 'Mock 模拟模型',
    skills: [
      {
        id: 'skill_1',
        name: '需求澄清',
        instructionsMd: '先问五个问题，再给结论。',
        sortOrder: 0,
      },
    ],
    knowledge: [
      {
        id: 'kn_1',
        title: '项目宪法',
        type: 'RULE',
        contentMd: '所有输出必须可审计。',
        sortOrder: 0,
      },
    ],
  };

  return {
    agent,
    task: {
      title: '实现导出功能',
      description: '支持导出为 CSV。',
      scenario: '新功能',
    },
    step: {
      stepKey: 'step_1',
      name: '需求分析',
      instructionMd: '输出 EARS 规格。',
      gateMode: 'NONE',
    },
    dependencyOutputs: [],
    ...overrides,
  };
}

describe('clampText', () => {
  test('leaves short text untouched', () => {
    expect(clampText('hello', 10)).toEqual({ text: 'hello', truncated: false });
  });

  test('truncates and appends a marker', () => {
    const result = clampText('x'.repeat(100), 20);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(20);
    expect(result.text).toContain('已截断');
  });
});

describe('buildContext', () => {
  test('assembles identity, skills, knowledge and the output contract in order', () => {
    const context = buildContext(makeInput());

    const identityIndex = context.systemPrompt.indexOf('# 身份');
    const skillsIndex = context.systemPrompt.indexOf('# 已挂载技能');
    const knowledgeIndex = context.systemPrompt.indexOf('# 项目知识');
    const contractIndex = context.systemPrompt.indexOf('# 输出契约');

    expect(identityIndex).toBe(0);
    expect(skillsIndex).toBeGreaterThan(identityIndex);
    expect(knowledgeIndex).toBeGreaterThan(skillsIndex);
    expect(contractIndex).toBeGreaterThan(knowledgeIndex);
    expect(context.systemPrompt).toContain('需求澄清');
    expect(context.systemPrompt).toContain('项目宪法');
    expect(context.skillCount).toBe(1);
    expect(context.knowledgeCount).toBe(1);
    expect(context.truncated).toBe(false);
  });

  test('includes task, step, dependency outputs and requirements in the user prompt', () => {
    const context = buildContext(
      makeInput({
        dependencyOutputs: [
          { stepKey: 'step_0', stepName: '前置步骤', outputMd: '前置产物内容' },
        ],
      }),
    );

    expect(context.userPrompt).toContain('## 当前任务');
    expect(context.userPrompt).toContain('实现导出功能');
    expect(context.userPrompt).toContain('## 当前步骤');
    expect(context.userPrompt).toContain('前置产物内容');
    expect(context.userPrompt).toContain('输出 EARS 规格');
  });

  test('notes a human approval gate in the step section', () => {
    const context = buildContext(
      makeInput({
        step: {
          stepKey: 'step_1',
          name: '编码实现',
          instructionMd: '完成实现',
          gateMode: 'HUMAN_APPROVAL',
        },
      }),
    );

    expect(context.userPrompt).toContain('该步骤完成后需要人工审批');
  });

  test('marks dependencies as an empty state when there are none', () => {
    const context = buildContext(makeInput());

    expect(context.userPrompt).toContain('（无，当前步骤没有前置依赖）');
  });

  test('truncates the skill block when it exceeds the budget', () => {
    const input = makeInput();
    input.agent.skills = [
      { id: 's1', name: '小技能', instructionsMd: '简短说明', sortOrder: 0 },
      {
        id: 's2',
        name: '超大技能',
        instructionsMd: 'y'.repeat(CONTEXT_BUDGETS.skills + 100),
        sortOrder: 1,
      },
    ];

    const context = buildContext(input);
    const skillSection = context.sections.find((section) => section.label === '技能');

    expect(context.skillCount).toBe(1);
    expect(context.truncated).toBe(true);
    expect(skillSection?.truncated).toBe(true);
    expect(context.systemPrompt).not.toContain('超大技能');
  });

  test('caps knowledge items at the configured maximum', () => {
    const input = makeInput();
    input.agent.knowledge = Array.from(
      { length: CONTEXT_BUDGETS.maxKnowledgeItems + 2 },
      (_, index) => ({
        id: `kn_${index}`,
        title: `知识 ${index}`,
        type: 'RULE' as const,
        contentMd: '内容',
        sortOrder: index,
      }),
    );

    const context = buildContext(input);

    expect(context.knowledgeCount).toBe(CONTEXT_BUDGETS.maxKnowledgeItems);
    expect(context.systemPrompt).toContain('其余未注入');
    expect(context.truncated).toBe(true);
  });
});
