import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';

export async function questionBankRoutes(app: FastifyInstance) {
  // GET /api/question-bank?search=
  app.get('/', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { courseId, search } = request.query as any;
    let q = user.role === 'admin' ? db('question_bank') : db('question_bank').where({ created_by: user.id });
    if (courseId) q = q.where({ course_id: courseId });
    if (search) q = q.whereILike('question', `%${search}%`);
    const questions = await q.orderBy('created_at', 'desc');
    return reply.send({ questions });
  });

  // POST /api/question-bank
  app.post('/', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { courseId, question, type, options, tags } = request.body as any;
    const [q] = await db('question_bank').insert({
      course_id: courseId || null,
      created_by: user.id,
      question,
      type: type || 'single',
      options: JSON.stringify(options || []),
      tags: JSON.stringify(tags || []),
    }).returning('*');
    return reply.status(201).send({ question: q });
  });

  // PATCH /api/question-bank/:id
  app.patch('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    const payload: any = {};
    if (updates.question) payload.question = updates.question;
    if (updates.type) payload.type = updates.type;
    if (updates.options) payload.options = JSON.stringify(updates.options);
    if (updates.tags) payload.tags = JSON.stringify(updates.tags);
    const query = user.role === 'admin' ? { id } : { id, created_by: user.id };
    await db('question_bank').where(query).update(payload);
    return reply.send({ message: 'Question updated' });
  });

  // DELETE /api/question-bank/:id
  app.delete('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const query = user.role === 'admin' ? { id } : { id, created_by: user.id };
    await db('question_bank').where(query).delete();
    return reply.status(204).send();
  });
}
