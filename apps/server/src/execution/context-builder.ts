import {
  CONTEXT_BUDGETS,
  KNOWLEDGE_TYPE_LABELS,
  type BuiltContext,
  type BuiltContextSection,
} from '@autosdd/shared';
import type { ContextBuildInput } from './types';

const TRUNCATION_MARKER = '\n\n> （内容过长，已截断）';
const OUTPUT_CONTRACT = `# 输出契约
- 只输出 Markdown 正文，不要输出与任务无关的寒暄。
- 结论先行，再给依据；引用知识时说明来源标题。
- 不要编造未在任务、知识或依赖产物中出现的事实；不确定时明确标注“待确认”。
- 产物应当可以直接被下一位同事使用。`;

interface ClampedText {
  text: string;
  truncated: boolean;
}

export function clampText(input: string, maxChars: number): ClampedText {
  if (input.length <= maxChars) return { text: input, truncated: false };
  const keep = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  return { text: `${input.slice(0, keep)}${TRUNCATION_MARKER}`, truncated: true };
}

interface BudgetedList<T> {
  text: string;
  truncated: boolean;
  included: number;
}

function renderWithinBudget<T>(
  items: readonly T[],
  maxChars: number,
  render: (item: T, index: number) => string,
): BudgetedList<T> {
  const chunks: string[] = [];
  let used = 0;
  let truncated = false;

  for (const [index, item] of items.entries()) {
    const chunk = render(item, index);
    if (used + chunk.length > maxChars) {
      truncated = true;
      break;
    }
    chunks.push(chunk);
    used += chunk.length;
  }

  return { text: chunks.join('\n\n'), truncated, included: chunks.length };
}

function identitySection(input: ContextBuildInput): string {
  const { agent } = input;
  const lines = [`# 身份`, `你是「${agent.name}」，担任${agent.role}。`];
  if (agent.description.trim()) lines.push('', agent.description.trim());
  if (agent.systemPrompt.trim()) lines.push('', agent.systemPrompt.trim());
  return lines.join('\n');
}

function renderSkill(
  skill: ContextBuildInput['agent']['skills'][number],
  index: number,
): string {
  return `## 技能 ${index + 1}：${skill.name}\n${skill.instructionsMd.trim()}`;
}

function renderKnowledge(
  item: ContextBuildInput['agent']['knowledge'][number],
): string {
  return `## [${KNOWLEDGE_TYPE_LABELS[item.type]}] ${item.title}\n${item.contentMd.trim()}`;
}

function renderDependency(
  dep: ContextBuildInput['dependencyOutputs'][number],
): string {
  return `### ${dep.stepName}（${dep.stepKey}）\n${dep.outputMd?.trim() || '（该步骤没有产出文本）'}`;
}

function section(label: string, text: string, truncated = false): BuiltContextSection {
  return { label, chars: text.length, truncated };
}

export function buildContext(input: ContextBuildInput): BuiltContext {
  const { agent } = input;

  const identity = identitySection(input);
  const skillBlock = renderWithinBudget(agent.skills, CONTEXT_BUDGETS.skills, renderSkill);
  const knowledgeItems = agent.knowledge.slice(0, CONTEXT_BUDGETS.maxKnowledgeItems);
  const knowledgeBlock = renderWithinBudget(
    knowledgeItems,
    CONTEXT_BUDGETS.knowledge,
    renderKnowledge,
  );

  const systemParts = [identity];
  if (skillBlock.text) systemParts.push(`# 已挂载技能\n\n${skillBlock.text}`);
  if (knowledgeBlock.text) {
    const omission =
      knowledgeItems.length < agent.knowledge.length
        ? `\n\n> 知识条目超过 ${CONTEXT_BUDGETS.maxKnowledgeItems} 条，其余未注入。`
        : '';
    systemParts.push(`# 项目知识\n\n${knowledgeBlock.text}${omission}`);
  }
  systemParts.push(OUTPUT_CONTRACT);

  const systemPrompt = systemParts.join('\n\n');
  const systemSections: BuiltContextSection[] = [
    section('身份', identity),
    section('技能', skillBlock.text, skillBlock.truncated),
    section(
      '知识',
      knowledgeBlock.text,
      knowledgeBlock.truncated || knowledgeItems.length < agent.knowledge.length,
    ),
    section('输出契约', OUTPUT_CONTRACT),
  ];

  const taskSection = [
    '## 当前任务',
    `- 标题：${input.task.title}`,
    input.task.scenario ? `- 场景：${input.task.scenario}` : null,
    '',
    input.task.description.trim() || '（任务没有补充描述）',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const stepSection = [
    '## 当前步骤',
    `- 步骤：${input.step.name}（${input.step.stepKey}）`,
    input.step.gateMode === 'HUMAN_APPROVAL' ? '- 该步骤完成后需要人工审批' : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const dependencyBlock = renderWithinBudget(
    input.dependencyOutputs,
    CONTEXT_BUDGETS.dependencies,
    renderDependency,
  );
  const dependencySection = `## 依赖步骤产物\n\n${
    dependencyBlock.text || '（无，当前步骤没有前置依赖）'
  }`;

  const requirementSection = `## 你的产出要求\n\n${
    input.step.instructionMd.trim() || '（未填写额外要求，按角色职责完成本步骤）'
  }`;

  const userPrompt = [taskSection, stepSection, dependencySection, requirementSection].join(
    '\n\n',
  );
  const userSections: BuiltContextSection[] = [
    section('当前任务', taskSection),
    section('当前步骤', stepSection),
    section('依赖产物', dependencySection, dependencyBlock.truncated),
    section('产出要求', requirementSection),
  ];

  const sections = [...systemSections, ...userSections];

  return {
    systemPrompt,
    userPrompt,
    systemChars: systemPrompt.length,
    userChars: userPrompt.length,
    skillCount: skillBlock.included,
    knowledgeCount: knowledgeBlock.included,
    truncated: sections.some((item) => item.truncated),
    sections,
  };
}
