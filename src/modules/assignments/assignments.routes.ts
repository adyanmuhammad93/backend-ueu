import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { config } from '../../config/env.js';

export async function assignmentRoutes(app: FastifyInstance) {
  // GET /api/assignments/:lessonId/my-submission
  app.get('/:lessonId/my-submission', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { lessonId } = request.params as { lessonId: string };
    const sub = await db('submissions').where({ user_id: user.id, lesson_id: lessonId }).first();
    return reply.send({ submission: sub || null });
  });

  // Legacy: GET /api/assignments/my-submission?lessonId=
  app.get('/my-submission', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { lessonId } = request.query as any;
    const sub = await db('submissions').where({ user_id: user.id, lesson_id: lessonId }).first();
    return reply.send({ submission: sub || null });
  });

  // POST /api/assignments/submit — file upload (multipart)
  app.post('/submit', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;

    const data = await request.file().catch(() => null);
    let fileUrl: string | null = null;
    let lessonId: string = '';
    let content: string | null = null;

    if (data) {
      // Multipart form
      lessonId = (data.fields.lessonId as any)?.value || '';
      content = (data.fields.content as any)?.value || null;

      const ext = path.extname(data.filename).toLowerCase();
      const fileName = `${uuidv4()}${ext}`;
      const uploadDir = path.resolve(config.storage.uploadDir);
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filePath = path.join(uploadDir, fileName);
      await fs.promises.writeFile(filePath, await data.toBuffer());
      fileUrl = `/uploads/${fileName}`;
    } else {
      // JSON body fallback
      const body = request.body as any;
      lessonId = body.lessonId;
      content = body.content || null;
      fileUrl = body.fileUrl || null;
    }

    if (!lessonId) return reply.status(400).send({ error: 'lessonId is required' });

    const [submission] = await db('submissions')
      .insert({ user_id: user.id, lesson_id: lessonId, file_url: fileUrl, content })
      .onConflict(['lesson_id', 'user_id'])
      .merge({ file_url: fileUrl, content, updated_at: new Date() })
      .returning('*');

    return reply.status(201).send({ submission });
  });

  // POST /api/assignments/quiz
  app.post('/quiz', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { lessonId, grade, content } = request.body as any;

    const [submission] = await db('submissions')
      .insert({ user_id: user.id, lesson_id: lessonId, grade, content })
      .onConflict(['lesson_id', 'user_id'])
      .merge({ grade, content, updated_at: new Date() })
      .returning('*');

    return reply.status(201).send({ submission });
  });

  // GET /api/assignments/instructor — all submissions for instructor's courses
  app.get('/instructor', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const user = (request as any).user;
    let q = db('submissions as s')
      .join('lessons', 's.lesson_id', 'lessons.id')
      .join('modules', 'lessons.module_id', 'modules.id')
      .join('courses', 'modules.course_id', 'courses.id')
      .join('users', 's.user_id', 'users.id')
      .select(
        's.*',
        'users.full_name as student_name', 'users.email as student_email', 'users.avatar_url as student_avatar',
        'lessons.title as lesson_title', 'lessons.type as lesson_type',
        'courses.title as course_title',
      )
      .orderBy('s.submitted_at', 'desc');

    if (user.role !== 'admin') q = q.where('courses.instructor_id', user.id);

    const submissions = await q;
    return reply.send({ submissions });
  });

  // GET /api/assignments/my — student's own submissions
  app.get('/my', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const submissions = await db('submissions as s')
      .join('lessons', 's.lesson_id', 'lessons.id')
      .join('modules', 'lessons.module_id', 'modules.id')
      .join('courses', 'modules.course_id', 'courses.id')
      .where('s.user_id', user.id)
      .select(
        's.*',
        'lessons.title as lesson_title', 'lessons.type as lesson_type',
        'courses.id as course_id', 'courses.title as course_title', 'courses.thumbnail_url as course_thumbnail',
      )
      .orderBy('s.submitted_at', 'desc');

    return reply.send({ submissions });
  });

  // PATCH /api/assignments/grade/:id — instructor/admin grade a submission
  app.patch('/grade/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { grade, feedback } = request.body as any;
    if (grade < 0 || grade > 100) return reply.status(400).send({ error: 'Grade must be 0-100' });
    await db('submissions').where({ id }).update({ grade, feedback, updated_at: new Date() });
    return reply.send({ message: 'Graded' });
  });

  // GET /api/assignments/performance/:courseId — student's performance for a course
  app.get('/performance/:courseId', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { courseId } = request.params as { courseId: string };

    const submissions = await db('submissions as s')
      .join('lessons', 's.lesson_id', 'lessons.id')
      .join('modules', 'lessons.module_id', 'modules.id')
      .where('modules.course_id', courseId)
      .where('s.user_id', user.id)
      .select('s.*', 'lessons.type as lesson_type');

    const quizSubs = submissions.filter((s: any) => s.lesson_type === 'quiz' && s.grade !== null);
    const assignmentSubs = submissions.filter((s: any) => s.lesson_type === 'assignment');
    const gradedAssignments = assignmentSubs.filter((s: any) => s.grade !== null);
    const avgScore = quizSubs.length > 0 ? quizSubs.reduce((sum: number, s: any) => sum + Number(s.grade), 0) / quizSubs.length : 0;

    return reply.send({
      averageScore: Math.round(avgScore * 100) / 100,
      completedQuizzes: quizSubs.length,
      quizGrades: quizSubs.map((s: any) => Number(s.grade)),
      totalAssignmentsSubmitted: assignmentSubs.length,
      gradedAssignmentsCount: gradedAssignments.length,
    });
  });

  // GET /api/assignments/submissions?lessonId= — instructor: all submissions for lesson
  app.get('/submissions', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { lessonId } = request.query as any;
    const subs = await db('submissions as s')
      .join('users', 's.user_id', 'users.id')
      .where('s.lesson_id', lessonId)
      .select('s.*', 'users.full_name', 'users.email')
      .orderBy('s.submitted_at', 'desc');
    return reply.send({ submissions: subs });
  });

  // POST /api/assignments/resources/link — link existing asset as lesson resource
  app.post('/resources/link', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { lessonId, title, fileUrl, fileType, fileSize } = request.body as any;
    const [resource] = await db('resources').insert({
      lesson_id: lessonId, title, file_url: fileUrl, file_type: fileType, file_size: fileSize,
    }).returning('*');
    return reply.status(201).send({ resource });
  });

  // GET /api/assignments/lessons/:lessonId/resources
  app.get('/lessons/:lessonId/resources', { preHandler: [authenticate] }, async (request, reply) => {
    const { lessonId } = request.params as { lessonId: string };
    const resources = await db('resources').where({ lesson_id: lessonId }).orderBy('created_at', 'asc');
    return reply.send({ resources });
  });

  // POST /api/assignments/resources — upload a resource file
  app.post('/resources', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const data = await request.file().catch(() => null);
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const lessonId = (data.fields.lessonId as any)?.value;
    const title = (data.fields.title as any)?.value || data.filename;

    const ext = path.extname(data.filename).toLowerCase();
    const fileName = `${uuidv4()}${ext}`;
    const uploadDir = path.resolve(config.storage.uploadDir);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, fileName);
    await fs.promises.writeFile(filePath, await data.toBuffer());
    const fileUrl = `/uploads/${fileName}`;
    const stats = await fs.promises.stat(filePath);

    const [resource] = await db('resources').insert({
      lesson_id: lessonId, title, file_url: fileUrl, file_type: ext.slice(1), file_size: stats.size,
    }).returning('*');

    return reply.status(201).send({ resource });
  });

  // DELETE /api/assignments/resources/:id
  app.delete('/resources/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db('resources').where({ id }).delete();
    return reply.status(204).send();
  });
}
