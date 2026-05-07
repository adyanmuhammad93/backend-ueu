import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { v4 as uuidv4 } from 'uuid';

async function generateVerificationCode(): Promise<string> {
  const bytes = new Uint8Array(4);
  // Node crypto fallback
  const { randomBytes } = await import('crypto');
  const buf = randomBytes(4);
  return buf.toString('hex').toUpperCase();
}

export async function certificateRoutes(app: FastifyInstance) {
  // GET /api/certificates/verify/:code — public
  app.get('/verify/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    const cert = await db('certificates as c')
      .join('courses', 'c.course_id', 'courses.id')
      .join('users', 'c.user_id', 'users.id')
      .where('c.verification_code', code.toUpperCase())
      .select(
        'c.*',
        'courses.title as course_title', 'courses.thumbnail_url as course_thumbnail',
        'courses.instructor_name', 'courses.certificate_config',
        'users.full_name as student_name',
      )
      .first();

    if (!cert) return reply.send({ certificate: null });
    const certConfig = cert.certificate_config || {};
    return reply.send({ certificate: { ...cert, custom_title: certConfig.customTitle } });
  });

  // GET /api/certificates/my — list all user's certificates
  app.get('/my', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const certs = await db('certificates as c')
      .join('courses', 'c.course_id', 'courses.id')
      .where('c.user_id', user.id)
      .orderBy('c.issued_at', 'desc')
      .select('c.*', 'courses.title as course_title', 'courses.thumbnail_url as course_thumbnail', 'courses.instructor_name', 'courses.certificate_config');
    return reply.send({ certificates: certs.map((c: any) => ({ ...c, custom_title: c.certificate_config?.customTitle })) });
  });

  // GET /api/certificates/my/:courseId — get certificate for specific course
  app.get('/my/:courseId', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { courseId } = request.params as { courseId: string };
    const cert = await db('certificates').where({ user_id: user.id, course_id: courseId }).first();
    return reply.send({ certificate: cert || null });
  });

  // POST /api/certificates/issue — issue a certificate for the current user
  app.post('/issue', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { courseId } = request.body as any;

    // Check if already issued
    const existing = await db('certificates').where({ user_id: user.id, course_id: courseId }).first();
    if (existing) return reply.send({ certificate: existing });

    // Get course certificate config for validity period
    const course = await db('courses').where({ id: courseId }).select('certificate_config').first();
    const certConfig = course?.certificate_config || {};
    let expiresAt = null;
    if (certConfig.validityDays) {
      const d = new Date();
      d.setDate(d.getDate() + certConfig.validityDays);
      expiresAt = d.toISOString();
    }

    const verificationCode = await generateVerificationCode();
    const [cert] = await db('certificates').insert({
      user_id: user.id, course_id: courseId, verification_code: verificationCode, expires_at: expiresAt,
    }).returning('*');

    return reply.status(201).send({ certificate: cert });
  });

  // POST /api/certificates/:id/revoke — admin
  app.post('/:id/revoke', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = request.body as any;
    await db('certificates').where({ id }).update({ revoked: true, revoked_reason: reason });
    return reply.send({ message: 'Certificate revoked' });
  });
}
