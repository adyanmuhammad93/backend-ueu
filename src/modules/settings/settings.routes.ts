import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings/:key
  app.get('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const row = await db('settings').where({ key }).first();
    const value = row?.value ?? null;
    return reply.send({ key, value: typeof value === 'string' ? tryParseJson(value) : value });
  });

  // PUT /api/settings/:key — admin only
  app.put('/:key', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const { value } = request.body as any;
    await db('settings')
      .insert({ key, value: JSON.stringify(value), updated_at: new Date() })
      .onConflict('key').merge({ value: JSON.stringify(value), updated_at: new Date() });
    return reply.send({ message: 'Setting saved', key, value });
  });

  // GET /api/settings — list all settings (admin)
  app.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const rows = await db('settings').orderBy('key', 'asc');
    const settings = rows.reduce((acc: any, r: any) => {
      acc[r.key] = typeof r.value === 'string' ? tryParseJson(r.value) : r.value;
      return acc;
    }, {});
    return reply.send({ settings });
  });
}

function tryParseJson(val: string): any {
  try { return JSON.parse(val); } catch { return val; }
}
