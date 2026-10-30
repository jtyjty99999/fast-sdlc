import type { FastifyInstance } from 'fastify';
import {
  agentInputSchema,
  agentMountInputSchema,
  type AgentInput,
  type AgentMountInput,
} from '@autosdd/shared';
import { parseBody, sendOk } from '../../http/respond';
import { validationError } from '../../http/errors';
import type { AgentService } from './service';

interface IdParams {
  id: string;
}

export async function registerAgentRoutes(
  app: FastifyInstance,
  service: AgentService,
): Promise<void> {
  app.get('/api/agents', async (request, reply) => {
    const { q } = request.query as { q?: string };
    if (q !== undefined && typeof q !== 'string') throw validationError('q 必须是字符串');
    return sendOk(reply, service.list(q));
  });

  app.post('/api/agents', async (request, reply) => {
    const input = parseBody<AgentInput>(agentInputSchema, request.body);
    return sendOk(reply, service.create(input), 201);
  });

  app.get<{ Params: IdParams }>('/api/agents/:id', async (request, reply) =>
    sendOk(reply, service.get(request.params.id)),
  );

  app.put<{ Params: IdParams }>('/api/agents/:id', async (request, reply) => {
    const input = parseBody<AgentInput>(agentInputSchema, request.body);
    return sendOk(reply, service.update(request.params.id, input));
  });

  app.delete<{ Params: IdParams }>('/api/agents/:id', async (request, reply) => {
    service.remove(request.params.id);
    return sendOk(reply, { deleted: true });
  });

  app.put<{ Params: IdParams }>('/api/agents/:id/mounts', async (request, reply) => {
    const input = parseBody<AgentMountInput>(agentMountInputSchema, request.body);
    return sendOk(reply, service.setMounts(request.params.id, input));
  });

  app.get<{ Params: IdParams }>('/api/agents/:id/context-preview', async (request, reply) =>
    sendOk(reply, service.contextPreview(request.params.id)),
  );
}
