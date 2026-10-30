import type { AgentDetail, SnapshotAgent } from '@autosdd/shared';

export function toAgentProfile(detail: AgentDetail): SnapshotAgent {
  return {
    id: detail.id,
    name: detail.name,
    role: detail.role,
    description: detail.description,
    systemPrompt: detail.systemPrompt,
    model: detail.model,
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
