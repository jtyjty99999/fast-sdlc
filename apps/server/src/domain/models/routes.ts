import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MODEL_PROVIDERS, modelInputSchema, type ModelInputSchema } from '@autosdd/shared';
import { parseBody, parseQuery, sendOk } from '../../http/respond';
import type { ModelService } from './service';

interface IdParams {
  id: string;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  provider: z.enum(MODEL_PROVIDERS).optional(),
});

export async function registerModelRoutes(
  app: FastifyInstance,
  service: ModelService,
): Promise<void> {
  app.get('/api/models', async (request, reply) => {
    const query = parseQuery(listQuerySchema, request.query);
    return sendOk(reply, service.list(query.q, query.provider));
  });

  app.post('/api/models', async (request, reply) => {
    const input = parseBody<ModelInputSchema>(modelInputSchema, request.body);
    return sendOk(reply, service.create(input), 201);
  });

  app.get<{ Params: IdParams }>('/api/models/:id', async (request, reply) =>
    sendOk(reply, service.get(request.params.id)),
  );

  app.put<{ Params: IdParams }>('/api/models/:id', async (request, reply) => {
    const input = parseBody<ModelInputSchema>(modelInputSchema, request.body);
    return sendOk(reply, service.update(request.params.id, input));
  });

  app.delete<{ Params: IdParams }>('/api/models/:id', async (request, reply) => {
    service.remove(request.params.id);
    return sendOk(reply, { deleted: true });
  });

  app.post<{ Params: IdParams }>('/api/models/:id/default', async (request, reply) =>
    sendOk(reply, service.setDefault(request.params.id)),
  );

  app.post<{ Params: IdParams }>('/api/models/:id/test', async (request, reply) =>
    sendOk(reply, await service.test(request.params.id)),
  );
}
