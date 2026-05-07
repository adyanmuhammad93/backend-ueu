import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authService } from './auth.service.js';
import { jwtService } from '../../shared/jwt.service.js';
import { authenticate } from '../../middleware/authenticate.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from './auth.schema.js';
import { ValidationError } from '../../shared/errors.js';

const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register
  app.post('/register', {
    config: { rateLimit: AUTH_RATE_LIMIT },
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user account',
      security: [],
      body: { $ref: 'RegisterBody#' },
      response: {
        201: { $ref: 'AuthResponse#' },
        409: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const result = await authService.register(parsed.data);
    setRefreshCookie(reply, result.refreshToken);
    return reply.status(201).send({ user: result.user, accessToken: result.accessToken });
  });

  // POST /api/auth/login
  app.post('/login', {
    config: { rateLimit: AUTH_RATE_LIMIT },
    schema: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      description: 'Returns a 15-min access token + sets HttpOnly refresh token cookie (7 days).',
      security: [],
      body: { $ref: 'LoginBody#' },
      response: {
        200: { $ref: 'AuthResponse#' },
        401: {
          type: 'object',
          properties: { error: { type: 'string' }, message: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const result = await authService.login(parsed.data);
    setRefreshCookie(reply, result.refreshToken);
    return reply.send({ user: result.user, accessToken: result.accessToken });
  });

  // POST /api/auth/refresh
  app.post('/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      description: 'Uses HttpOnly refresh cookie, or pass `refreshToken` in body (mobile clients). Rotates token on each call.',
      security: [],
      // removed strict body schema so empty requests (cookie only) don't fail validation
      response: {
        200: {
          type: 'object',
          properties: { accessToken: { type: 'string' } },
        },
        401: {
          type: 'object',
          properties: { error: { type: 'string' }, message: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const cookieToken = (request.cookies as any)?.refresh_token;
    const bodyToken = (request.body as any)?.refreshToken;
    const token = cookieToken || bodyToken;
    if (!token) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'No refresh token provided' });
    const result = await jwtService.rotateRefreshToken(token);
    setRefreshCookie(reply, result.refreshToken);
    return reply.send({ accessToken: result.accessToken });
  });

  // POST /api/auth/logout
  app.post('/logout', {
    // No authenticate middleware — logout must succeed even when the access token
    // has expired. We only need the refresh cookie to revoke the session.
    schema: {
      tags: ['Auth'],
      summary: 'Logout — revoke refresh token and clear cookie',
      response: {
        200: { $ref: 'MessageResponse#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.cookies as any)?.refresh_token || (request.body as any)?.refreshToken;
    if (token) {
      try { await jwtService.revokeRefreshToken(token); } catch { /* ignore — already revoked or missing */ }
    }
    reply.clearCookie('refresh_token', { path: '/' });
    return reply.send({ message: 'Logged out successfully' });
  });

  // GET /api/auth/me
  app.get('/me', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Get the current authenticated user',
      response: {
        200: {
          type: 'object',
          properties: { user: { $ref: 'UserProfile#' } },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const fullUser = await authService.getCurrentUser(user.id);
    return reply.send({ user: fullUser });
  });

  // PATCH /api/auth/profile
  app.patch('/profile', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Update own profile (name, avatar, Gemini API key)',
      body: {
        type: 'object',
        properties: {
          fullName: { type: 'string', minLength: 2, maxLength: 100 },
          avatarUrl: { type: 'string', format: 'uri' },
          geminiApiKey: { type: 'string', nullable: true },
        },
      },
      response: {
        200: { $ref: 'MessageResponse#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const user = (request as any).user;
    await authService.updateProfile(user.id, parsed.data);
    return reply.send({ message: 'Profile updated' });
  });

  // POST /api/auth/change-password
  app.post('/change-password', {
    preHandler: [authenticate],
    config: { rateLimit: AUTH_RATE_LIMIT },
    schema: {
      tags: ['Auth'],
      summary: 'Change password — revokes all sessions',
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 8 },
        },
      },
      response: {
        200: { $ref: 'MessageResponse#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const user = (request as any).user;
    await authService.changePassword(user.id, parsed.data);
    return reply.send({ message: 'Password changed. Please log in again.' });
  });

  // POST /api/auth/impersonate/:userId
  app.post('/impersonate/:userId', {
    preHandler: [authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Impersonate a user (Admin only)',
      params: {
        type: 'object',
        properties: { userId: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: { $ref: 'AuthResponse#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const admin = (request as any).user;
    const { userId } = request.params as { userId: string };
    const result = await authService.getUserForImpersonation(userId, admin.id);
    return reply.send(result);
  });
}

function setRefreshCookie(reply: FastifyReply, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  reply.setCookie('refresh_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax', // 'lax' required for cross-port localhost in dev
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}
