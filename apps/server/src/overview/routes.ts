import type { FastifyInstance } from 'fastify';
import type { OverviewData } from '@autosdd/shared';
import type { AgentRepository } from '../domain/agents/repository';
import type { SkillRepository } from '../domain/skills/repository';
import type { KnowledgeRepository } from '../domain/knowledge/repository';
import type { ModelRepository } from '../domain/models/repository';
import type { WorkflowRepository } from '../domain/workflows/repository';
import type { TaskRepository } from '../domain/tasks/repository';
import { executorInfoForModel } from '../execution/executors/factory';
import { sendOk } from '../http/respond';

interface OverviewDeps {
  agents: AgentRepository;
  skills: SkillRepository;
  knowledge: KnowledgeRepository;
  models: ModelRepository;
  workflows: WorkflowRepository;
  tasks: TaskRepository;
}

export async function registerOverviewRoutes(
  app: FastifyInstance,
  deps: OverviewDeps,
): Promise<void> {
  app.get('/api/overview', async (_request, reply) => {
    const counts = deps.tasks.countByStatus();
    const terminalTasks = counts.SUCCEEDED + counts.FAILED + counts.CANCELED;
    const successRate =
      terminalTasks === 0 ? 0 : Math.round((counts.SUCCEEDED / terminalTasks) * 1000) / 10;

    const data: OverviewData = {
      counts: {
        agents: deps.agents.count(),
        skills: deps.skills.count(),
        knowledge: deps.knowledge.count(),
        workflows: deps.workflows.count(),
        enabledWorkflows: deps.workflows.countEnabled(),
        tasks: deps.tasks.count(),
        runningTasks: counts.QUEUED + counts.RUNNING + counts.WAITING_APPROVAL,
        succeededTasks: counts.SUCCEEDED,
        terminalTasks,
        successRate,
      },
      executor: executorInfoForModel(deps.models.findDefault()),
      recentTasks: deps.tasks.list().slice(0, 6),
    };
    return sendOk(reply, data);
  });
}
