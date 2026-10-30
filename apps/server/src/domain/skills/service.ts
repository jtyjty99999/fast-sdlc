import type { Skill, SkillInput } from '@autosdd/shared';
import type { SkillRepository } from './repository';
import { conflict, notFound } from '../../http/errors';

export class SkillService {
  constructor(private readonly skills: SkillRepository) {}

  list(q?: string, category?: string): Skill[] {
    return this.skills.list(q?.trim() || undefined, category?.trim() || undefined);
  }

  get(id: string): Skill {
    const skill = this.skills.findById(id);
    if (!skill) throw notFound('Skill 不存在');
    return skill;
  }

  create(input: SkillInput): Skill {
    return this.skills.create(input);
  }

  update(id: string, input: SkillInput): Skill {
    const updated = this.skills.update(id, input);
    if (!updated) throw notFound('Skill 不存在');
    return updated;
  }

  remove(id: string): void {
    if (!this.skills.findById(id)) throw notFound('Skill 不存在');
    const usage = this.skills.countAgentUsage(id);
    if (usage > 0) {
      throw conflict('SKILL_IN_USE', `该 Skill 仍被 ${usage} 个 Agent 挂载，请先解除挂载`, {
        agentCount: usage,
      });
    }
    this.skills.remove(id);
  }
}
