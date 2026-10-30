import type { FastifyInstance } from 'fastify';
import {
  matchInputSchema,
  workflowInputSchema,
  type MatchInput,
  type WorkflowInput,
} from '@autosdd/shared';
import { parseBody, sendOk } from '../../http/respond';
import type { WorkflowService } from './service';

interface IdParams {
  id: string;
}

export async function registerWorkflowRoutes(
  app: FastifyInstance,
  service: WorkflowService,
): Promise<void> {
  app.get('/api/workflows', async (_request, reply) => sendOk(reply, service.list()));

  app.post('/api/workflows', async (request, reply) => {
    const input = parseBody<WorkflowInput>(workflowInputSchema, request.body);
    return sendOk(reply, service.create(input), 201);
  });

  app.post('/api/workflows/match', async (request, reply) => {
    const input = parseBody<MatchInput>(matchInputSchema, request.body);
    return sendOk(reply, service.match(input));
  });

  app.get<{ Params: IdParams }>('/api/workflows/:id', async (request, reply) =>
    sendOk(reply, service.get(request.params.id)),
  );

  app.put<{ Params: IdParams }>('/api/workflows/:id', async (request, reply) => {
    const input = parseBody<WorkflowInput>(workflowInputSchema, request.body);
    return sendOk(reply, service.update(request.params.id, input));
  });

  app.delete<{ Params: IdParams }>('/api/workflows/:id', async (request, reply) => {
    service.remove(request.params.id);
    return sendOk(reply, { deleted: true });
  });

  app.post<{ Params: IdParams }>('/api/workflows/:id/validate', async (request, reply) =>
    sendOk(reply, service.validate(request.params.id)),
  );
}
