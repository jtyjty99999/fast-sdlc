import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';
import type { ApiErr, ApiOk } from '@autosdd/shared';
import { AppError, validationError } from './errors';

export function sendOk<T>(reply: FastifyReply, data: T, statusCode = 200) {
  const body: ApiOk<T> = { ok: true, data };
  return reply.status(statusCode).send(body);
}

export function sendFailure(reply: FastifyReply, error: AppError) {
  const body: ApiErr = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
  return reply.status(error.statusCode).send(body);
}

export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  return parseQuery(schema, value);
}

export function parseQuery<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError('请求参数不合法', result.error.issues);
  }
  return result.data;
}
