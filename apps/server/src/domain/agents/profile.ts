import type { AgentDetail, SnapshotAgent } from '@autosdd/shared';

interface FallbackModel {
  id: string;
  name: string;
}

export function toAgentProfile(
  detail: AgentDetail,
  fallbackModel?: FallbackModel,
): SnapshotAgent {
  return {
    id: detail.id,
    name: detail.name,
    role: detail.role,
    description: detail.description,
    systemPrompt: detail.systemPrompt,
    modelId: detail.modelId ?? fallbackModel?.id ?? '',
    modelName: detail.modelName ?? fallbackModel?.name ?? '',
    skills: detail.skills.map((skill, index) => ({
      id: skill.id,
      name: skill.name,
      instructionsMd: skill.instructionsMd,
      sortOrder: index,
    })),
    knowledge: detail.knowledgeItems.map((item, index) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      contentMd: item.contentMd,
      sortOrder: index,
    })),
  };
}
