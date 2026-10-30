import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KNOWLEDGE_TYPES, knowledgeInputSchema, type KnowledgeInput } from '@autosdd/shared';
import { parseBody, parseQuery, sendOk } from '../../http/respond';
import type { KnowledgeService } from './service';

interface IdParams {
  id: string;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.enum(KNOWLEDGE_TYPES).optional(),
});

export async function registerKnowledgeRoutes(
  app: FastifyInstance,
  service: KnowledgeService,
): Promise<void> {
  app.get('/api/knowledge', async (request, reply) => {
    const query = parseQuery(listQuerySchema, request.query);
    return sendOk(reply, service.list(query.q, query.type));
  });

  app.post('/api/knowledge', async (request, reply) => {
    const input = parseBody<KnowledgeInput>(knowledgeInputSchema, request.body);
    return sendOk(reply, service.create(input), 201);
  });

  app.get<{ Params: IdParams }>('/api/knowledge/:id', async (request, reply) =>
    sendOk(reply, service.get(request.params.id)),
  );

  app.put<{ Params: IdParams }>('/api/knowledge/:id', async (request, reply) => {
    const input = parseBody<KnowledgeInput>(knowledgeInputSchema, request.body);
    return sendOk(reply, service.update(request.params.id, input));
  });

  app.delete<{ Params: IdParams }>('/api/knowledge/:id', async (request, reply) => {
    service.remove(request.params.id);
    return sendOk(reply, { deleted: true });
  });
}
