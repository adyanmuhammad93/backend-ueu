import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { v4 as uuidv4 } from 'uuid';

export async function notificationRoutes(app: FastifyInstance) {
  // GET /api/notifications — current user's notifications
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const notifs = await db('notifications').where({ user_id: user.id }).orderBy('created_at', 'desc').limit(50);
    return reply.send({ notifications: notifs });
  });

  // PATCH /api/notifications/:id/read
  app.patch('/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    await db('notifications').where({ id, user_id: user.id }).update({ is_read: true });
    return reply.send({ message: 'Marked as read' });
  });

  // PATCH /api/notifications/read-all — mark all as read
  app.patch('/read-all', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    await db('notifications').where({ user_id: user.id }).update({ is_read: true });
    return reply.send({ message: 'All notifications marked as read' });
  });

  // POST /api/notifications — admin sends to specific users
  app.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { title, message, type = 'info', userIds } = request.body as any;

    let targetIds: string[];
    if (Array.isArray(userIds) && userIds.length > 0) {
      targetIds = userIds;
    } else {
      const users = await db('users').select('id');
      targetIds = users.map((u: any) => u.id);
    }

    const payload = targetIds.map(uid => ({ id: uuidv4(), user_id: uid, title, message, type }));
    for (let i = 0; i < payload.length; i += 500) {
      await db('notifications').insert(payload.slice(i, i + 500));
    }
    return reply.status(201).send({ message: `Sent to ${payload.length} users` });
  });

  // Legacy POST /api/notifications/mark-all-read
  app.post('/mark-all-read', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    await db('notifications').where({ user_id: user.id }).update({ is_read: true });
    return reply.send({ message: 'All notifications marked as read' });
  });

  // POST /api/notifications/broadcast — admin broadcast
  app.post('/broadcast', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { title, message, type = 'info' } = request.body as any;
    const users = await db('users').select('id');
    const payload = users.map((u: any) => ({ id: uuidv4(), user_id: u.id, title, message, type }));
    for (let i = 0; i < payload.length; i += 500) {
      await db('notifications').insert(payload.slice(i, i + 500));
    }
    return reply.status(201).send({ message: `Broadcast sent to ${payload.length} users` });
  });
}
