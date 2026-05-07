/**
 * Lightweight OpenAPI route schema builder.
 * Since we already validate via Zod at the service layer,
 * these schemas are primarily for Swagger UI display + Try-It-Out.
 */

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteSchemaOptions {
  tags: string[];
  summary: string;
  description?: string;
  security?: object[];
  params?: object;
  querystring?: object;
  body?: object;
  responses?: Record<number, { description: string; schema?: object }>;
}

/**
 * Generates a Fastify route schema block from simplified options.
 * Usage: schema: routeSchema({ tags: ['Courses'], summary: 'Get all courses' })
 */
export function routeSchema(opts: RouteSchemaOptions): object {
  const response: Record<string, object> = {};

  const defaultResponses = opts.responses ?? { 200: { description: 'Success' } };
  for (const [code, val] of Object.entries(defaultResponses)) {
    response[code] = {
      description: val.description,
      content: val.schema
        ? { 'application/json': { schema: val.schema } }
        : undefined,
    };
  }

  // Always add standard error responses
  response['400'] ??= { description: 'Validation error' };
  response['401'] ??= { description: 'Unauthorized — Bearer token required' };
  response['500'] ??= { description: 'Internal server error' };

  return {
    tags: opts.tags,
    summary: opts.summary,
    ...(opts.description && { description: opts.description }),
    ...(opts.security !== undefined && { security: opts.security }),
    ...(opts.params && { params: opts.params }),
    ...(opts.querystring && { querystring: opts.querystring }),
    ...(opts.body && { body: opts.body }),
    response,
  };
}

// Common reusable schema fragments
export const UUIDParam = {
  type: 'object' as const,
  properties: { id: { type: 'string', format: 'uuid' } },
};

export const PaginationQuery = {
  type: 'object' as const,
  properties: {
    page: { type: 'integer', default: 1, minimum: 1 },
    limit: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
    search: { type: 'string' },
  },
};

export const MessageBody = {
  type: 'object' as const,
  properties: { message: { type: 'string' } },
};

export const ErrorBody = {
  $ref: '#/components/schemas/ErrorResponse' as const,
};
