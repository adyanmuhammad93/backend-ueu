import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole, optionalAuthenticate } from '../../middleware/authenticate.js';
import { coursesService } from './courses.service.js';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';

const createCourseSchema = z.object({
  title: z.string().min(3).max(200).trim(),
  subtitle: z.string().max(300).trim().optional(),
  description: z.string().min(10).max(5000).trim(),
  price: z.number().min(0).max(99999),
  category: z.string().min(1).max(100).trim(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  language: z.string().max(50).optional(),
  thumbnailUrl: z.string().url().optional(),
  learningObjectives: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
});

const updateCourseSchema = createCourseSchema.partial().extend({
  isPublished: z.boolean().optional(),
  accessType: z.enum(['free', 'paid', 'code', 'prerequisite', 'date', 'capacity', 'approval']).optional(),
  accessConfig: z.record(z.any()).optional(),
  certificateConfig: z.record(z.any()).optional(),
});

export async function courseRoutes(app: FastifyInstance) {
  // GET /api/courses — public
  app.get('/', async (request, reply) => {
    const q = request.query as any;
    if (q.page || q.search) {
      const result = await coursesService.getPaginatedCourses(Number(q.page) || 1, Number(q.limit) || 10, q.search || '');
      return reply.send(result);
    }
    const courses = await coursesService.getAllCourses();
    return reply.send(courses);
  });

  // GET /api/courses/:id — public, but enrolled users see lesson content
  app.get('/:id', { preHandler: [optionalAuthenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as any;
    const user = (request as any).user;
    const course = await coursesService.getCourseById(id, q.publishedOnly === 'true', user);
    return reply.send(course);
  });

  // POST /api/courses — instructor or admin
  app.post('/', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const parsed = createCourseSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const user = (request as any).user;
    const course = await coursesService.createCourse(parsed.data, user.id, user.name || user.email);
    return reply.status(201).send(course);
  });

  // PATCH /api/courses/:id
  app.patch('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCourseSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const user = (request as any).user;
    await coursesService.updateCourse(id, parsed.data, user.id, user.role);
    return reply.send({ message: 'Course updated' });
  });

  // POST /api/courses/:id/approve  — admin
  app.post('/:id/approve', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await coursesService.approveCourse(id);
    return reply.send({ message: 'Course approved' });
  });

  // POST /api/courses/:id/reject — admin
  app.post('/:id/reject', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await coursesService.rejectCourse(id);
    return reply.send({ message: 'Course rejected' });
  });

  // DELETE /api/courses/:id
  app.delete('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    await coursesService.updateCourse(id, {}, user.id, user.role); // auth check
    await coursesService.deleteCourse(id);
    return reply.status(204).send();
  });

  // --- Modules ---
  app.post('/:courseId/modules', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const { title, orderIndex } = request.body as any;
    const mod = await coursesService.createModule(courseId, title, orderIndex || 0);
    return reply.status(201).send(mod);
  });

  app.patch('/modules/:moduleId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    await coursesService.updateModule(moduleId, request.body as any);
    return reply.send({ message: 'Module updated' });
  });

  app.delete('/modules/:moduleId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    await coursesService.deleteModule(moduleId);
    return reply.status(204).send();
  });

  app.post('/modules/reorder', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { updates } = request.body as { updates: { id: string; orderIndex: number }[] };
    await coursesService.reorderModules(updates);
    return reply.send({ message: 'Modules reordered' });
  });

  // --- Lessons ---
  app.post('/modules/:moduleId/lessons', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    const { title, orderIndex, type } = request.body as any;
    const lesson = await coursesService.createLesson(moduleId, title, orderIndex || 0, type);
    return reply.status(201).send(lesson);
  });

  app.patch('/lessons/:lessonId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };
    await coursesService.updateLesson(lessonId, request.body as any);
    return reply.send({ message: 'Lesson updated' });
  });

  app.delete('/lessons/:lessonId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };
    await coursesService.deleteLesson(lessonId);
    return reply.status(204).send();
  });

  app.post('/lessons/reorder', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { updates } = request.body as { updates: { id: string; orderIndex: number; moduleId: string }[] };
    await coursesService.reorderLessons(updates);
    return reply.send({ message: 'Lessons reordered' });
  });

  app.patch('/lessons/batch-status', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { lessonIds, isPublished } = request.body as { lessonIds: string[]; isPublished: boolean };
    await coursesService.updateLessonStatusBatch(lessonIds, isPublished);
    return reply.send({ message: 'Lesson statuses updated' });
  });

  // POST /api/courses/:courseId/progress — mark a lesson complete (body: { lessonId })
  app.post('/:courseId/progress', { preHandler: [authenticate] }, async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const { lessonId } = request.body as any;
    const user = (request as any).user;
    await coursesService.markLessonComplete(user.id, lessonId, courseId);
    return reply.send({ message: 'Lesson marked complete' });
  });

  // GET /api/courses/:courseId/progress — get completed lesson IDs for current user
  app.get('/:courseId/progress', { preHandler: [authenticate] }, async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const user = (request as any).user;
    const completedIds = await coursesService.getStudentProgress(user.id, courseId);
    return reply.send({ completedLessonIds: completedIds });
  });

  // GET /api/courses/:courseId/enrollment-count
  app.get('/:courseId/enrollment-count', async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const { db } = await import('../../db/knex.js');
    const [{ count }] = await db('enrollments').where({ course_id: courseId, status: 'active' }).count('id as count');
    return reply.send({ count: Number(count) });
  });

  // GET /api/courses/:courseId/reviews
  app.get('/:courseId/reviews', async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const { db } = await import('../../db/knex.js');
    const reviews = await db('reviews as r')
      .join('users', 'r.user_id', 'users.id')
      .where('r.course_id', courseId)
      .orderBy('r.created_at', 'desc')
      .select('r.*', 'users.full_name as user_name');
    return reply.send({ reviews });
  });

  // POST /api/courses/:courseId/reviews
  app.post('/:courseId/reviews', { preHandler: [authenticate] }, async (request, reply) => {
    const { courseId } = request.params as { courseId: string };
    const user = (request as any).user;
    const { rating, comment } = request.body as any;
    if (!rating || rating < 1 || rating > 5) {
      return reply.status(400).send({ error: 'Rating must be 1-5' });
    }
    const { db } = await import('../../db/knex.js');
    await db('reviews')
      .insert({ user_id: user.id, course_id: courseId, rating, comment })
      .onConflict(['user_id', 'course_id']).merge({ rating, comment });
    const [{ avg, count }] = await db('reviews').where({ course_id: courseId })
      .select(db.raw('ROUND(AVG(rating)::numeric, 2) as avg'), db.raw('COUNT(*) as count'));
    await db('courses').where({ id: courseId }).update({ rating: avg, rating_count: count });
    return reply.status(201).send({ message: 'Review submitted' });
  });

  // GET /api/courses/instructor/student-progress?courseId=
  app.get('/instructor/student-progress', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    const { courseId } = request.query as any;
    const { db } = await import('../../db/knex.js');
    let q = db('enrollments as e')
      .join('users', 'e.user_id', 'users.id')
      .join('courses', 'e.course_id', 'courses.id')
      .leftJoin(db.raw(`(
        SELECT lp.user_id, m.course_id, COUNT(lp.lesson_id) as completed_lessons
        FROM lesson_progress lp
        JOIN lessons l ON lp.lesson_id = l.id
        JOIN modules m ON l.module_id = m.id
        GROUP BY lp.user_id, m.course_id
      ) as prog`), function(this: any) {
        this.on('prog.user_id', 'e.user_id').andOn('prog.course_id', 'e.course_id');
      })
      .leftJoin(db.raw(`(
        SELECT m.course_id, COUNT(l.id) as total_lessons
        FROM lessons l JOIN modules m ON l.module_id = m.id
        GROUP BY m.course_id
      ) as totals`), 'totals.course_id', 'e.course_id')
      .select(
        'e.id as enrollment_id', 'e.user_id as student_id', 'users.full_name as student_name', 'users.email as student_email',
        'e.course_id', 'courses.title as course_title', 'e.enrolled_at', 'e.status as enrollment_status',
        db.raw('COALESCE(totals.total_lessons, 0) as total_lessons'),
        db.raw('COALESCE(prog.completed_lessons, 0) as completed_lessons'),
        db.raw('CASE WHEN COALESCE(totals.total_lessons, 0) = 0 THEN 0 ELSE ROUND(100.0 * COALESCE(prog.completed_lessons,0) / totals.total_lessons, 1) END as progress_pct'),
      )
      .orderBy('e.enrolled_at', 'desc');
    if (user.role !== 'admin') q = q.where('courses.instructor_id', user.id);
    if (courseId) q = q.where('e.course_id', courseId);
    const progress = await q;
    return reply.send({ progress });
  });

  // GET /api/courses/admin/student-progress — all students (admin)
  app.get('/admin/student-progress', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { courseId, instructorId, statusFilter, search, enrolledFrom, enrolledTo } = request.query as any;
    const { db } = await import('../../db/knex.js');
    let q = db('enrollments as e')
      .join('users', 'e.user_id', 'users.id')
      .join('courses', 'e.course_id', 'courses.id')
      .join('users as instr', 'courses.instructor_id', 'instr.id')
      .leftJoin(db.raw(`(
        SELECT lp.user_id, m.course_id, COUNT(lp.lesson_id) as completed_lessons
        FROM lesson_progress lp
        JOIN lessons l ON lp.lesson_id = l.id
        JOIN modules m ON l.module_id = m.id
        GROUP BY lp.user_id, m.course_id
      ) as prog`), function(this: any) {
        this.on('prog.user_id', 'e.user_id').andOn('prog.course_id', 'e.course_id');
      })
      .leftJoin(db.raw(`(
        SELECT m.course_id, COUNT(l.id) as total_lessons
        FROM lessons l JOIN modules m ON l.module_id = m.id
        GROUP BY m.course_id
      ) as totals`), 'totals.course_id', 'e.course_id')
      .select(
        'e.id as enrollment_id', 'e.user_id as student_id', 'users.full_name as student_name', 'users.email as student_email',
        'e.course_id', 'courses.title as course_title', 'courses.instructor_id', 'instr.full_name as instructor_name',
        'e.enrolled_at', 'e.status as enrollment_status',
        db.raw('COALESCE(totals.total_lessons,0) as total_lessons'),
        db.raw('COALESCE(prog.completed_lessons,0) as completed_lessons'),
        db.raw('CASE WHEN COALESCE(totals.total_lessons,0)=0 THEN 0 ELSE ROUND(100.0*COALESCE(prog.completed_lessons,0)/totals.total_lessons,1) END as progress_pct'),
      )
      .orderBy('e.enrolled_at', 'desc');
    if (courseId) q = q.where('e.course_id', courseId);
    if (instructorId) q = q.where('courses.instructor_id', instructorId);
    if (search) q = q.where(function(this: any) { this.whereILike('users.full_name', `%${search}%`).orWhereILike('users.email', `%${search}%`); });
    if (enrolledFrom) q = q.where('e.enrolled_at', '>=', enrolledFrom);
    if (enrolledTo) q = q.where('e.enrolled_at', '<=', enrolledTo);
    const progress = await q;
    return reply.send({ progress });
  });

  // GET /api/courses/assignments/instructor/:instructorId — get course assignments for instructor (admin)
  // app.get('/assignments/instructor/:instructorId', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
  //   const { instructorId } = request.params as { instructorId: string };
  //   const { db } = await import('../../db/knex.js');
  //   const rows = await db('course_assignments').where({ instructor_id: instructorId }).select('course_id');
  //   return reply.send({ courseIds: rows.map((r: any) => r.course_id) });
  // });
  app.get('/assignments/instructor/:instructorId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
  const user = (request as any).user;
  const { instructorId } = request.params as { instructorId: string };

  if (user.role !== 'admin' && user.id !== instructorId) {
    return reply.status(403).send({ error: 'Insufficient permission' });
  }

  const { db } = await import('../../db/knex.js');
  const rows = await db('course_assignments')
    .where({ instructor_id: instructorId })
    .select('course_id');

  return reply.send({ courseIds: rows.map((r: any) => r.course_id) });
});

  // PUT /api/courses/assignments/instructor/:instructorId — set course assignments (admin)
  app.put('/assignments/instructor/:instructorId', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { instructorId } = request.params as { instructorId: string };
    const { courseIds } = request.body as any;
    const user = (request as any).user;
    const { db } = await import('../../db/knex.js');
    await db.transaction(async (trx) => {
      await trx('course_assignments').where({ instructor_id: instructorId }).delete();
      if (Array.isArray(courseIds) && courseIds.length > 0) {
        await trx('course_assignments').insert(courseIds.map((cid: string) => ({
          instructor_id: instructorId, course_id: cid, assigned_by: user.id,
        })));
      }
    });
    return reply.send({ message: 'Instructor assignments updated' });
  });
}
   