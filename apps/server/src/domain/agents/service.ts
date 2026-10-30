import type {
  Agent,
  AgentDetail,
  AgentInput,
  AgentMountInput,
  ContextPreview,
  SnapshotAgent,
} from '@autosdd/shared';
import type { AgentRepository } from './repository';
import type { SkillRepository } from '../skills/repository';
import type { KnowledgeRepository } from '../knowledge/repository';
import { badRequest, conflict, notFound } from '../../http/errors';
import { buildContext } from '../../execution/context-builder';
import { toAgentProfile } from './profile';

const PREVIEW_TASK = {
  title: '示例任务：为打车应用增加“行程分享”能力',
  description:
    '乘客在行程进行中可以把实时位置分享给家人，分享链接 24 小时有效，家人无需安装应用即可查看。',
  scenario: '新功能开发',
};

const PREVIEW_STEP = {
  stepKey: 'preview',
  name: '示例步骤',
  instructionMd: '请按你的角色职责产出 Markdown，供下游同事直接使用。',
  gateMode: 'NONE' as const,
};

export class AgentService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly skills: SkillRepository,
    private readonly knowledge: KnowledgeRepository,
  ) {}

  list(q?: string): Agent[] {
    return this.agents.list(q?.trim() || undefined);
  }

  get(id: string): AgentDetail {
    const detail = this.agents.findDetail(id);
    if (!detail) throw notFound('Agent 不存在');
    return detail;
  }

  create(input: AgentInput): Agent {
    return this.agents.create(input);
  }

  update(id: string, input: AgentInput): Agent {
    const updated = this.agents.update(id, input);
    if (!updated) throw notFound('Agent 不存在');
    return updated;
  }

  remove(id: string): void {
    if (!this.agents.findById(id)) throw notFound('Agent 不存在');
    const usage = this.agents.countWorkflowUsage(id);
    if (usage > 0) {
      throw conflict(
        'AGENT_IN_USE',
        `该 Agent 仍被 ${usage} 个工作流步骤引用，请先调整工作流`,
        { workflowStepCount: usage },
      );
    }
    this.agents.remove(id);
  }

  setMounts(id: string, input: AgentMountInput): AgentDetail {
    if (!this.agents.findById(id)) throw notFound('Agent 不存在');

    const skillIds = [...new Set(input.skillIds)];
    const knowledgeIds = [...new Set(input.knowledgeIds)];
    const missingSkills = skillIds.filter((skillId) => !this.skills.findById(skillId));
    const missingKnowledge = knowledgeIds.filter(
      (knowledgeId) => !this.knowledge.findById(knowledgeId),
    );
    if (missingSkills.length > 0 || missingKnowledge.length > 0) {
      throw badRequest('MOUNT_NOT_FOUND', '挂载对象不存在', {
        missingSkillIds: missingSkills,
        missingKnowledgeIds: missingKnowledge,
      });
    }

    this.agents.setMounts(id, { skillIds, knowledgeIds });
    return this.get(id);
  }

  getProfile(id: string): SnapshotAgent {
    return toAgentProfile(this.get(id));
  }

  contextPreview(id: string): ContextPreview {
    const context = buildContext({
      agent: this.getProfile(id),
      task: PREVIEW_TASK,
      step: PREVIEW_STEP,
      dependencyOutputs: [],
    });
    return {
      systemPrompt: context.systemPrompt,
      userPrompt: context.userPrompt,
      stats: {
        systemChars: context.systemChars,
        userChars: context.userChars,
        skillCount: context.skillCount,
        knowledgeCount: context.knowledgeCount,
        truncated: context.truncated,
        sections: context.sections,
      },
    };
  }
}
