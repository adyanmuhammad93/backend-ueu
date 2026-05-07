import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtService } from '../shared/jwt.service.js';
import { UnauthorizedError } from '../shared/errors.js';
import type { UserRole } from '../types/index.js';

/**
 * Verifies JWT and attaches the user payload to request.user
 * Throws 401 if token is missing or invalid.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwtService.verifyAccessToken(token);
    (request as any).user = { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    reply.status(401).send({ error: 'Invalid or expired access token' });
  }
}

/**
 * Verifies JWT optionally. Attaches the user payload to request.user if valid.
 * If missing or invalid, request.user remains undefined or null.
 */
export async function optionalAuthenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    (request as any).user = null;
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwtService.verifyAccessToken(token);
    (request as any).user = { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    (request as any).user = null;
  }
}

/**
 * Factory that returns a preHandler that checks the authenticated user's role.
 * Must be used AFTER the authenticate middleware.
 *
 * Usage: preHandler: [authenticate, requireRole('admin')]
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = (request as any).user;
    if (!user) {
      reply.status(401).send({ error: 'Not authenticated' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      reply.status(403).send({ error: 'Insufficient permissions' });
      return;
    }
  };
}
