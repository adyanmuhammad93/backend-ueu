import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { usersService } from './users.service.js';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';

const adminUpdateSchema = z.object({
  role: z.enum(['student', 'instructor', 'admin']).optional(),
  fullName: z.string().min(2).max(100).trim().optional(),
});

const adminCreateSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(8).max(128).optional(),
  fullName: z.string().min(2).max(100).trim(),
  role: z.enum(['student', 'instructor', 'admin']).default('student'),
});

export async function userRoutes(app: FastifyInstance) {
  // POST /api/users (Admin only)
  app.post(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adminCreateSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
      const newUser = await usersService.adminCreateUser(parsed.data);
      return reply.status(201).send({ user: newUser });
    },
  );
  // GET /api/users  (Admin only)
  app.get(
    '/',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as any;
      const result = await usersService.getPaginatedUsers(
        Number(q.page) || 1,
        Number(q.limit) || 10,
        q.search || '',
        {
          role: q.role,
          sortBy: q.sortBy,
          sortDir: q.sortDir,
          hasEnrollments: q.hasEnrollments === 'true',
        },
      );
      return reply.send(result);
    },
  );

  // GET /api/users/:id  (Admin only)
  app.get(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const user = await usersService.getUserById(id);
      return reply.send({ user });
    },
  );

  // PATCH /api/users/:id  (Admin only)
  app.patch(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = adminUpdateSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
      await usersService.adminUpdateUser(id, parsed.data);
      return reply.send({ message: 'User updated' });
    },
  );

  // DELETE /api/users/:id  (Admin only)
  app.delete(
    '/:id',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const requester = (request as any).user;
      await usersService.deleteUser(id, requester.id);
      return reply.status(204).send();
    },
  );

  const adminPasswordSchema = z.object({
    password: z.string().min(6).max(128),
  });

  // POST /api/users/:id/password (Admin only)
  app.post(
    '/:id/password',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = adminPasswordSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
      
      const { password } = parsed.data;
      const argon2 = await import('argon2');
      // ARGON2_OPTIONS are defined in service, but we just want to hash it here or use the service to hash
      // The usersService.adminChangeUserPassword takes the HASH, so we hash it in the route or the service.
      const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4 };
      const passwordHash = await argon2.hash(password as string, ARGON2_OPTIONS);
      
      await usersService.adminChangeUserPassword(id, passwordHash);
      return reply.send({ message: 'Password updated successfully' });
    }
  );
}
