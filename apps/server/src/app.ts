import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config';
import { loadConfig } from './config';
import { openDatabase, type Db } from './db/database';
import { migrate } from './db/migrate';
import { seedIfEmpty } from './db/seed';
import { AppError } from './http/errors';
import { sendFailure } from './http/respond';
import { AgentRepository } from './domain/agents/repository';
import { AgentService } from './domain/agents/service';
import { registerAgentRoutes } from './domain/agents/routes';
import { SkillRepository } from './domain/skills/repository';
import { SkillService } from './domain/skills/service';
import { registerSkillRoutes } from './domain/skills/routes';
import { KnowledgeRepository } from './domain/knowledge/repository';
import { KnowledgeService } from './domain/knowledge/service';
import { registerKnowledgeRoutes } from './domain/knowledge/routes';
import { ModelRepository } from './domain/models/repository';
import { ModelService } from './domain/models/service';
import { registerModelRoutes } from './domain/models/routes';
import { WorkflowRepository } from './domain/workflows/repository';
import { WorkflowService } from './domain/workflows/service';
import { registerWorkflowRoutes } from './domain/workflows/routes';
import { TaskRepository } from './domain/tasks/repository';
import { RunRepository } from './domain/tasks/run-repository';
import { TaskService } from './domain/tasks/service';
import { registerTaskRoutes } from './domain/tasks/routes';
import { registerOverviewRoutes } from './overview/routes';
import { RunEventStore } from './execution/run-events';
import { Orchestrator, type OrchestratorLogger } from './execution/orchestrator';

const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export interface BuildAppOptions {
  config?: AppConfig;
  db?: Db;
  logger?: FastifyServerOptions['logger'];
  seed?: boolean;
}

function toOrchestratorLogger(logger: FastifyBaseLogger): OrchestratorLogger {
  return {
    info: (payload, message) => logger.info(payload, message),
    warn: (payload, message) => logger.warn(payload, message),
    error: (payload, message) => logger.error(payload, message),
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: options.logger ?? false });
  const db = options.db ?? openDatabase(config.databasePath);
  const ownsDb = options.db === undefined;

  migrate(db);
  if (options.seed) seedIfEmpty(db);

  const agents = new AgentRepository(db);
  const skills = new SkillRepository(db);
  const knowledge = new KnowledgeRepository(db);
  const models = new ModelRepository(db);
  const workflows = new WorkflowRepository(db);
  const tasks = new TaskRepository(db);
  const runs = new RunRepository(db);
  const events = new RunEventStore(db);

  const orchestrator = new Orchestrator({
    tasks,
    runs,
    workflows,
    agents,
    events,
    models,
    config,
    logger: toOrchestratorLogger(app.log),
  });
  const recovered = orchestrator.recoverInterruptedRuns();
  if (recovered > 0) {
    app.log.warn({ recovered }, 'recovered interrupted runs');
  }

  const agentService = new AgentService(agents, skills, knowledge, models);
  const skillService = new SkillService(skills);
  const knowledgeService = new KnowledgeService(knowledge);
  const modelService = new ModelService(models, config);
  const workflowService = new WorkflowService(workflows, agents);
  const taskService = new TaskService(tasks, runs, workflows, events, orchestrator);

  // Fastify copies the active error/not-found handler into a route's context
  // when the plugin queue is flushed (the first awaited `register`). Installing
  // these before any awaited registration keeps every API error on our envelope
  // instead of Fastify's default serialization.
  const hasWebDist = existsSync(WEB_DIST);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return sendFailure(reply, error);
    }
    const candidate = error as { statusCode?: number; message?: string };
    if (
      typeof candidate.statusCode === 'number' &&
      candidate.statusCode >= 400 &&
      candidate.statusCode < 500
    ) {
      return sendFailure(
        reply,
        new AppError(
          candidate.statusCode,
          'VALIDATION_ERROR',
          candidate.message ?? '请求不合法',
        ),
      );
    }
    request.log.error({ error }, 'unhandled request error');
    return sendFailure(reply, new AppError(500, 'INTERNAL', '服务器内部错误'));
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api') && hasWebDist) {
      return reply.sendFile('index.html');
    }
    return sendFailure(reply, new AppError(404, 'NOT_FOUND', '接口不存在'));
  });

  await app.register(cors, { origin: true });

  await registerAgentRoutes(app, agentService);
  await registerSkillRoutes(app, skillService);
  await registerKnowledgeRoutes(app, knowledgeService);
  await registerModelRoutes(app, modelService);
  await registerWorkflowRoutes(app, workflowService);
  await registerTaskRoutes(app, taskService);
  await registerOverviewRoutes(app, {
    agents,
    skills,
    knowledge,
    models,
    workflows,
    tasks,
  });

  if (hasWebDist) {
    await app.register(fastifyStatic, { root: WEB_DIST });
  }

  if (ownsDb) {
    app.addHook('onClose', async () => {
      db.close();
    });
  }

  return app;
}
