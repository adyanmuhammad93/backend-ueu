import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';

const createTxSchema = z.object({
  totalAmount: z.number().positive(),
  proofUrl: z.string().optional(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    itemType: z.enum(['course', 'bundle']),
    price: z.number().min(0),
    title: z.string().min(1).max(300),
  })).min(1),
});

// Helper: attach items to transactions
async function attachItems(txs: any[]) {
  const ids = txs.map((t: any) => t.id);
  if (ids.length === 0) return txs.map((t: any) => ({ ...t, items: [] }));
  const items = await db('transaction_items').whereIn('transaction_id', ids);
  return txs.map((t: any) => ({ ...t, items: items.filter((i: any) => i.transaction_id === t.id) }));
}

// Service
export const paymentsService = {
  async createTransaction(userId: string, input: z.infer<typeof createTxSchema>) {
    return db.transaction(async (trx) => {
      const [tx] = await trx('transactions').insert({
        id: uuidv4(),
        user_id: userId,
        total_amount: input.totalAmount,
        proof_url: input.proofUrl,
        status: 'pending',
      }).returning('*');

      const itemPayload = input.items.map(i => ({
        id: uuidv4(),
        transaction_id: tx.id,
        item_id: i.itemId,
        item_type: i.itemType,
        price: i.price,
        title: i.title,
      }));
      await trx('transaction_items').insert(itemPayload);
      return tx;
    });
  },

  async verifyTransaction(txId: string) {
    return db.transaction(async (trx) => {
      const [tx] = await trx('transactions').where({ id: txId, status: 'pending' })
        .update({ status: 'verified', updated_at: new Date() }).returning('*');
      if (!tx) return;

      const items = await trx('transaction_items').where({ transaction_id: txId });
      for (const item of items) {
        if (item.item_type === 'course') {
          await trx('enrollments')
            .insert({ user_id: tx.user_id, course_id: item.item_id, status: 'active' })
            .onConflict(['user_id', 'course_id']).merge({ status: 'active' });
        } else if (item.item_type === 'bundle') {
          const bundleCourses = await trx('bundle_courses').where({ bundle_id: item.item_id }).select('course_id');
          for (const bc of bundleCourses) {
            await trx('enrollments')
              .insert({ user_id: tx.user_id, course_id: bc.course_id, status: 'active' })
              .onConflict(['user_id', 'course_id']).merge({ status: 'active' });
          }
        }
      }
      return tx;
    });
  },

  async rejectTransaction(txId: string, notes?: string) {
    await db('transactions').where({ id: txId }).update({ status: 'rejected', notes, updated_at: new Date() });
  },

  async getUserTransactions(userId: string) {
    const txs = await db('transactions').where({ user_id: userId }).orderBy('created_at', 'desc');
    return attachItems(txs);
  },

  async getAllTransactions(status?: string) {
    let q = db('transactions as t')
      .join('users', 't.user_id', 'users.id')
      .select('t.*', 'users.full_name as user_name', 'users.email as user_email')
      .orderBy('t.created_at', 'desc');
    if (status) q = q.where('t.status', status);
    const txs = await q;
    return attachItems(txs);
  },

  async getById(txId: string) {
    const tx = await db('transactions as t')
      .join('users', 't.user_id', 'users.id')
      .select('t.*', 'users.full_name as user_name', 'users.email as user_email')
      .where('t.id', txId)
      .first();
    if (!tx) return null;
    const [enriched] = await attachItems([tx]);
    return enriched;
  },
};

// Routes
export async function paymentRoutes(app: FastifyInstance) {
  // POST /api/payments
  app.post('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createTxSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const user = (request as any).user;
    const tx = await paymentsService.createTransaction(user.id, parsed.data);
    const [enriched] = await attachItems([tx]);
    return reply.status(201).send({ transaction: enriched });
  });

  // GET /api/payments — admin: all (with optional status filter), user: own
  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const q = request.query as any;
    if (user.role === 'admin') {
      const txs = await paymentsService.getAllTransactions(q.status);
      return reply.send({ transactions: txs });
    }
    const txs = await paymentsService.getUserTransactions(user.id);
    return reply.send({ transactions: txs });
  });

  // GET /api/payments/my — explicit own transactions
  app.get('/my', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const txs = await paymentsService.getUserTransactions(user.id);
    return reply.send({ transactions: txs });
  });

  // GET /api/payments/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const tx = await paymentsService.getById(id);
    if (!tx) return reply.status(404).send({ error: 'Not found' });
    if (user.role !== 'admin' && tx.user_id !== user.id) return reply.status(403).send({ error: 'Forbidden' });
    return reply.send({ transaction: tx });
  });

  // PATCH /api/payments/:id/verify — admin
  app.patch('/:id/verify', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as any;
    if (status === 'rejected') {
      await paymentsService.rejectTransaction(id);
    } else {
      await paymentsService.verifyTransaction(id);
    }
    return reply.send({ message: 'Transaction updated' });
  });

  // Legacy POST verify/reject
  app.post('/:id/verify', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await paymentsService.verifyTransaction(id);
    return reply.send({ message: 'Transaction verified and enrollments created' });
  });

  app.post('/:id/reject', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { notes } = request.body as any;
    await paymentsService.rejectTransaction(id, notes);
    return reply.send({ message: 'Transaction rejected' });
  });
}
