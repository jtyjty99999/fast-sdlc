import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { skillInputSchema, type SkillInput } from '@autosdd/shared';
import { parseBody, parseQuery, sendOk } from '../../http/respond';
import type { SkillService } from './service';

interface IdParams {
  id: string;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(40).optional(),
});

export async function registerSkillRoutes(
  app: FastifyInstance,
  service: SkillService,
): Promise<void> {
  app.get('/api/skills', async (request, reply) => {
    const query = parseQuery(listQuerySchema, request.query);
    return sendOk(reply, service.list(query.q, query.category));
  });

  app.post('/api/skills', async (request, reply) => {
    const input = parseBody<SkillInput>(skillInputSchema, request.body);
    return sendOk(reply, service.create(input), 201);
  });

  app.get<{ Params: IdParams }>('/api/skills/:id', async (request, reply) =>
    sendOk(reply, service.get(request.params.id)),
  );

  app.put<{ Params: IdParams }>('/api/skills/:id', async (request, reply) => {
    const input = parseBody<SkillInput>(skillInputSchema, request.body);
    return sendOk(reply, service.update(request.params.id, input));
  });

  app.delete<{ Params: IdParams }>('/api/skills/:id', async (request, reply) => {
    service.remove(request.params.id);
    return sendOk(reply, { deleted: true });
  });
}
