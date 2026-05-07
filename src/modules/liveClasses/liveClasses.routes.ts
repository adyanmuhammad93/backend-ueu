import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';

export async function liveClassRoutes(app: FastifyInstance) {
  // GET /api/live-classes?courseId= — lessons for a course
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { courseId } = request.query as any;
    const query = db('live_classes as lc')
      .join('courses', 'lc.course_id', 'courses.id')
      .select('lc.*', 'courses.title as course_title');
    if (courseId) query.where({ 'lc.course_id': courseId });
    const liveClasses = await query.orderBy('lc.start_time', 'asc');
    return reply.send({ liveClasses });
  });

  // GET /api/live-classes/schedule — user's schedule based on their enrolled / instructor courses
  app.get('/schedule', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    let liveClasses: any[] = [];

    if (user.role === 'student') {
      liveClasses = await db('live_classes as lc')
        .join('courses', 'lc.course_id', 'courses.id')
        .join('enrollments as e', (qb: any) => {
          qb.on('e.course_id', 'lc.course_id').andOn('e.user_id', db.raw('?', [user.id]));
        })
        .where('e.status', 'active')
        .select('lc.*', 'courses.title as course_title')
        .orderBy('lc.start_time', 'asc');
    } else if (user.role === 'instructor') {
      liveClasses = await db('live_classes as lc')
        .join('courses', 'lc.course_id', 'courses.id')
        .where('courses.instructor_id', user.id)
        .select('lc.*', 'courses.title as course_title')
        .orderBy('lc.start_time', 'asc');
    } else {
      // admin — all
      liveClasses = await db('live_classes as lc')
        .join('courses', 'lc.course_id', 'courses.id')
        .select('lc.*', 'courses.title as course_title')
        .orderBy('lc.start_time', 'asc');
    }

    return reply.send({ liveClasses });
  });

  // GET /api/live-classes/course/:courseId
  app.get('/course/:courseId', { preHandler: [authenticate] }, async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const liveClasses = await db('live_classes').where({ course_id: courseId }).orderBy('start_time', 'asc');
    return reply.send({ liveClasses });
  });

  // POST /api/live-classes
  app.post('/', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { courseId, title, description, startTime, endTime, platform, meetingUrl } = request.body as any;
    const [cls] = await db('live_classes').insert({
      course_id: courseId, title, description,
      start_time: startTime, end_time: endTime, platform, meeting_url: meetingUrl,
    }).returning('*');
    return reply.status(201).send({ liveClass: cls });
  });

  // PATCH /api/live-classes/:id
  app.patch('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    const payload: any = {};
    if (updates.title) payload.title = updates.title;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.startTime) payload.start_time = updates.startTime;
    if (updates.endTime) payload.end_time = updates.endTime;
    if (updates.meetingUrl) payload.meeting_url = updates.meetingUrl;
    if (updates.platform) payload.platform = updates.platform;
    await db('live_classes').where({ id }).update(payload);
    return reply.send({ message: 'Live class updated' });
  });

  // DELETE /api/live-classes/:id
  app.delete('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db('live_classes').where({ id }).delete();
    return reply.status(204).send();
  });
}
