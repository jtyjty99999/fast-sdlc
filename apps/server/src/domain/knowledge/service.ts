import type { KnowledgeItem, KnowledgeInput } from '@autosdd/shared';
import type { KnowledgeType } from '@autosdd/shared';
import type { KnowledgeRepository } from './repository';
import { conflict, notFound } from '../../http/errors';

export class KnowledgeService {
  constructor(private readonly knowledge: KnowledgeRepository) {}

  list(q?: string, type?: KnowledgeType): KnowledgeItem[] {
    return this.knowledge.list(q?.trim() || undefined, type);
  }

  get(id: string): KnowledgeItem {
    const item = this.knowledge.findById(id);
    if (!item) throw notFound('知识条目不存在');
    return item;
  }

  create(input: KnowledgeInput): KnowledgeItem {
    return this.knowledge.create(input);
  }

  update(id: string, input: KnowledgeInput): KnowledgeItem {
    const updated = this.knowledge.update(id, input);
    if (!updated) throw notFound('知识条目不存在');
    return updated;
  }

  remove(id: string): void {
    if (!this.knowledge.findById(id)) throw notFound('知识条目不存在');
    const usage = this.knowledge.countAgentUsage(id);
    if (usage > 0) {
      throw conflict('KNOWLEDGE_IN_USE', `该知识仍被 ${usage} 个 Agent 挂载，请先解除挂载`, {
        agentCount: usage,
      });
    }
    this.knowledge.remove(id);
  }
}
