import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../../middleware/authenticate.js';

export async function reviewRoutes(app: FastifyInstance) {
  // GET /api/reviews?courseId=
  app.get('/', async (request, reply) => {
    const { courseId } = request.query as any;
    if (!courseId) return reply.send({ reviews: [] });
    const reviews = await db('reviews as r')
      .join('users', 'r.user_id', 'users.id')
      .where('r.course_id', courseId)
      .orderBy('r.created_at', 'desc')
      .select('r.*', 'users.full_name as user_name');
    return reply.send({ reviews });
  });

  // GET /api/reviews/course/:courseId — course reviews
  app.get('/course/:courseId', async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const reviews = await db('reviews as r')
      .join('users', 'r.user_id', 'users.id')
      .where('r.course_id', courseId)
      .orderBy('r.created_at', 'desc')
      .select('r.*', 'users.full_name as user_name');
    return reply.send({ reviews });
  });

  // POST /api/reviews
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { courseId, rating, comment } = request.body as any;
    if (!courseId || !rating || rating < 1 || rating > 5) {
      return reply.status(400).send({ error: 'Invalid rating (must be 1-5)' });
    }

    await db('reviews')
      .insert({ user_id: user.id, course_id: courseId, rating, comment })
      .onConflict(['user_id', 'course_id']).merge({ rating, comment });

    // Update course rating aggregate
    const [{ avg, count }] = await db('reviews')
      .where({ course_id: courseId })
      .select(db.raw('ROUND(AVG(rating)::numeric, 2) as avg'), db.raw('COUNT(*) as count'));

    await db('courses').where({ id: courseId }).update({ rating: avg, rating_count: count });

    return reply.status(201).send({ message: 'Review submitted' });
  });
}
