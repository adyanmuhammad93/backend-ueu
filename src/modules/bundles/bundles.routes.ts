import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { v4 as uuidv4 } from 'uuid';

export async function bundleRoutes(app: FastifyInstance) {
  // GET /api/bundles?published=true or all
  app.get('/', async (request, reply) => {
    const { published } = request.query as any;
    let q = db('bundles as b')
      .leftJoin('bundle_courses as bc', 'b.id', 'bc.bundle_id')
      .select('b.*', db.raw('COUNT(bc.id) as course_count'))
      .groupBy('b.id').orderBy('b.created_at', 'desc');
    if (published === 'true') q = q.where('b.is_published', true);
    const bundles = await q;
    return reply.send({ bundles });
  });

  // GET /api/bundles/my — instructor's own bundles
  app.get('/my', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const q = user.role === 'admin'
      ? db('bundles').orderBy('created_at', 'desc')
      : db('bundles').where({ instructor_id: user.id }).orderBy('created_at', 'desc');
    const bundles = await q;
    return reply.send({ bundles });
  });

  // GET /api/bundles/:id — public
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const bundle = await db('bundles').where({ id }).first();
    if (!bundle) return reply.status(404).send({ error: 'Bundle not found' });
    const courses = await db('bundle_courses as bc')
      .join('courses', 'bc.course_id', 'courses.id')
      .where('bc.bundle_id', id)
      .select('courses.*');
    return reply.send({ bundle: { ...bundle, courses } });
  });

  // POST /api/bundles — instructor/admin
  app.post('/', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { title, description, price, thumbnailUrl, courseIds } = request.body as any;
    const bundle = await db.transaction(async (trx) => {
      const [b] = await trx('bundles').insert({
        title, description, price: price || 0, thumbnail_url: thumbnailUrl, instructor_id: user.id,
      }).returning('*');
      if (Array.isArray(courseIds) && courseIds.length > 0) {
        await trx('bundle_courses').insert(courseIds.map((cid: string) => ({ id: uuidv4(), bundle_id: b.id, course_id: cid })));
      }
      return b;
    });
    return reply.status(201).send({ bundle });
  });

  // PATCH /api/bundles/:id
  app.patch('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { title, description, price, thumbnailUrl, isPublished } = request.body as any;
    const payload: any = { updated_at: new Date() };
    if (title !== undefined) payload.title = title;
    if (description !== undefined) payload.description = description;
    if (price !== undefined) payload.price = price;
    if (thumbnailUrl !== undefined) payload.thumbnail_url = thumbnailUrl;
    if (isPublished !== undefined) payload.is_published = isPublished;
    await db('bundles').where({ id }).update(payload);
    return reply.send({ message: 'Bundle updated' });
  });

  // POST /api/bundles/:id/courses — add course to bundle
  app.post('/:id/courses', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { courseId } = request.body as any;
    await db('bundle_courses')
      .insert({ id: uuidv4(), bundle_id: id, course_id: courseId })
      .onConflict(['bundle_id', 'course_id']).ignore();
    return reply.status(201).send({ message: 'Course added to bundle' });
  });

  // DELETE /api/bundles/:id/courses/:courseId — remove course from bundle
  app.delete('/:id/courses/:courseId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id, courseId } = request.params as { id: string; courseId: string };
    await db('bundle_courses').where({ bundle_id: id, course_id: courseId }).delete();
    return reply.status(204).send();
  });

  // POST /api/bundles/:id/enroll — student enrolls in all bundle courses
  app.post('/:id/enroll', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const courses = await db('bundle_courses').where({ bundle_id: id }).select('course_id');
    for (const c of courses) {
      await db('enrollments')
        .insert({ user_id: user.id, course_id: c.course_id, status: 'active' })
        .onConflict(['user_id', 'course_id']).ignore();
    }
    return reply.status(201).send({ message: 'Enrolled in all bundle courses' });
  });

  // DELETE /api/bundles/:id
  app.delete('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db('bundles').where({ id }).delete();
    return reply.status(204).send();
  });
}
