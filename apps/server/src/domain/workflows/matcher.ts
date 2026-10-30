import type { MatchCandidate, MatchInput, WorkflowSummary } from '@autosdd/shared';

const SCENARIO_SCORE = 10;
const KEYWORD_SCORE = 3;
const TAG_SCORE = 1;
const MAX_CANDIDATES = 3;

function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function scoreWorkflow(
  workflow: WorkflowSummary,
  input: MatchInput,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const scenario = input.scenario?.trim();

  if (scenario && workflow.scenario.trim() === scenario) {
    score += SCENARIO_SCORE;
    reasons.push(`场景匹配「${workflow.scenario}」`);
  }

  const matchedKeywords = workflow.matchKeywords.filter(
    (keyword) => keyword && includesIgnoreCase(input.text, keyword),
  );
  if (matchedKeywords.length > 0) {
    score += matchedKeywords.length * KEYWORD_SCORE;
    reasons.push(`命中关键词：${matchedKeywords.join('、')}`);
  }

  const matchedTags = workflow.tags.filter(
    (tag) => tag && includesIgnoreCase(input.text, tag),
  );
  if (matchedTags.length > 0) {
    score += matchedTags.length * TAG_SCORE;
    reasons.push(`命中标签：${matchedTags.join('、')}`);
  }

  return { score, reasons };
}

export function matchWorkflows(
  workflows: readonly WorkflowSummary[],
  input: MatchInput,
): MatchCandidate[] {
  return workflows
    .filter((workflow) => workflow.status === 'ENABLED')
    .map((workflow) => {
      const { score, reasons } = scoreWorkflow(workflow, input);
      return { workflow, score, reasons };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.workflow.name.localeCompare(b.workflow.name))
    .slice(0, MAX_CANDIDATES);
}
