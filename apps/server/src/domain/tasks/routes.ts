import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  TASK_STATUSES,
  approvalInputSchema,
  taskInputSchema,
  type ApprovalInput,
  type RunEvent,
  type TaskInput,
} from '@autosdd/shared';
import { parseBody, parseQuery, sendOk } from '../../http/respond';
import type { TaskService } from './service';

interface IdParams {
  id: string;
}

interface RunParams {
  runId: string;
}

interface RunStepParams extends RunParams {
  stepRunId: string;
}

const listQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
});

const eventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
});

const SSE_HEARTBEAT_MS = 15_000;

function writeSse(raw: NodeJS.WritableStream, event: RunEvent): void {
  raw.write(`id: ${event.id}\n`);
  raw.write(`event: ${event.type}\n`);
  raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function registerTaskRoutes(
  app: FastifyInstance,
  service: TaskService,
): Promise<void> {
  app.get('/api/tasks', async (request, reply) => {
    const query = parseQuery(listQuerySchema, request.query);
    return sendOk(reply, service.list(query));
  });

  app.post('/api/tasks', async (request, reply) => {
    const input = parseBody<TaskInput>(taskInputSchema, request.body);
    return sendOk(reply, service.create(input), 201);
  });

  app.get<{ Params: IdParams }>('/api/tasks/:id', async (request, reply) =>
    sendOk(reply, service.detail(request.params.id)),
  );

  app.post<{ Params: IdParams }>('/api/tasks/:id/run', async (request, reply) =>
    sendOk(reply, await service.run(request.params.id)),
  );

  app.post<{ Params: IdParams }>('/api/tasks/:id/cancel', async (request, reply) =>
    sendOk(reply, service.cancel(request.params.id)),
  );

  app.get<{ Params: IdParams }>('/api/tasks/:id/runs', async (request, reply) =>
    sendOk(reply, service.listRuns(request.params.id)),
  );

  app.get<{ Params: RunParams }>('/api/runs/:runId', async (request, reply) =>
    sendOk(reply, service.getRun(request.params.runId)),
  );

  app.get<{ Params: RunParams }>('/api/runs/:runId/events', async (request, reply) => {
    const query = parseQuery(eventsQuerySchema, request.query);
    return sendOk(reply, service.listEvents(request.params.runId, query.after ?? 0));
  });

  app.get<{ Params: RunParams }>('/api/runs/:runId/stream', (request, reply) => {
    const { runId } = request.params;
    service.getRun(runId);

    const query = parseQuery(eventsQuerySchema, request.query);
    const header = request.headers['last-event-id'];
    const headerCursor = typeof header === 'string' ? Number(header) : 0;
    const initialCursor = Math.max(
      query.after ?? 0,
      Number.isFinite(headerCursor) ? headerCursor : 0,
    );

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    let cursor = initialCursor;
    let replaying = true;
    const buffered: RunEvent[] = [];

    const send = (event: RunEvent): void => {
      if (event.id <= cursor) return;
      cursor = event.id;
      writeSse(reply.raw, event);
    };

    const unsubscribe = service.subscribe(runId, (event) => {
      if (replaying) {
        buffered.push(event);
        return;
      }
      send(event);
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref?.();

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);

    for (const event of service.listEvents(runId, initialCursor)) {
      send(event);
    }
    replaying = false;
    for (const event of buffered.sort((a, b) => a.id - b.id)) {
      send(event);
    }
    buffered.length = 0;
  });

  app.post<{ Params: RunStepParams }>(
    '/api/runs/:runId/steps/:stepRunId/approval',
    async (request, reply) => {
      const input = parseBody<ApprovalInput>(approvalInputSchema, request.body);
      return sendOk(
        reply,
        service.approve(request.params.runId, request.params.stepRunId, input),
      );
    },
  );
}
