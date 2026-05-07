import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';

export async function discussionRoutes(app: FastifyInstance) {
  // GET /api/discussions/:lessonId — comments with replies
  app.get('/:lessonId', { preHandler: [authenticate] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };

    const comments = await db('comments as c')
      .join('users', 'c.user_id', 'users.id')
      .where({ 'c.lesson_id': lessonId, 'c.parent_id': null })
      .select('c.*', 'users.full_name as user_name', 'users.role as user_role', 'users.avatar_url')
      .orderBy('c.created_at', 'asc');

    const commentIds = comments.map((c: any) => c.id);
    const replies = commentIds.length > 0
      ? await db('comments as c')
        .join('users', 'c.user_id', 'users.id')
        .whereIn('c.parent_id', commentIds)
        .select('c.*', 'users.full_name as user_name', 'users.role as user_role', 'users.avatar_url')
        .orderBy('c.created_at', 'asc')
      : [];

    const result = comments.map((c: any) => ({
      ...c,
      replies: replies.filter((r: any) => r.parent_id === c.id),
    }));
    return reply.send({ comments: result });
  });

  // POST /api/discussions/:lessonId — add comment or reply
  app.post('/:lessonId', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { lessonId } = request.params as { lessonId: string };
    const { parentId, content } = request.body as any;
    if (!content?.trim()) return reply.status(400).send({ error: 'Content is required' });

    const [comment] = await db('comments').insert({
      user_id: user.id, lesson_id: lessonId, parent_id: parentId || null, content: content.trim(),
    }).returning('*');

    // Enrich with user name
    const enriched = { ...comment, user_name: user.name || user.email, user_role: user.role, replies: [] };
    return reply.status(201).send({ comment: enriched });
  });

  // DELETE /api/discussions/comment/:id
  app.delete('/comment/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const query = user.role === 'admin' ? { id } : { id, user_id: user.id };
    await db('comments').where(query).delete();
    return reply.status(204).send();
  });

  // Legacy: GET /api/discussions?lessonId= (query param)
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { lessonId } = request.query as any;
    if (!lessonId) return reply.send({ comments: [] });

    const comments = await db('comments as c')
      .join('users', 'c.user_id', 'users.id')
      .where({ 'c.lesson_id': lessonId, 'c.parent_id': null })
      .select('c.*', 'users.full_name as user_name', 'users.role as user_role')
      .orderBy('c.created_at', 'asc');

    const commentIds = comments.map((c: any) => c.id);
    const replies = commentIds.length > 0
      ? await db('comments as c').join('users', 'c.user_id', 'users.id')
        .whereIn('c.parent_id', commentIds)
        .select('c.*', 'users.full_name as user_name', 'users.role as user_role')
        .orderBy('c.created_at', 'asc')
      : [];

    return reply.send({ comments: comments.map((c: any) => ({ ...c, replies: replies.filter((r: any) => r.parent_id === c.id) })) });
  });
}
