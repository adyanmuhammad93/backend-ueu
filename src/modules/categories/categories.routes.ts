import { db } from '../../db/knex.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';

export async function categoryRoutes(app: FastifyInstance) {
  // GET /api/categories — public
  app.get('/', async (request, reply) => {
    // Select parent_id alongside everything else so the frontend can build the tree
    const cats = await db('categories').select('*').orderBy('name', 'asc');
    return reply.send({ categories: cats });
  });

  // POST /api/categories — admin
  app.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { name, parentId, status } = request.body as any;
    if (!name?.trim()) return reply.status(400).send({ error: 'Name required' });
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const [cat] = await db('categories').insert({ 
      name: name.trim(), 
      slug,
      parent_id: parentId || null,
      status: status === 'inactive' ? 'inactive' : 'active'
    }).onConflict('slug').ignore().returning('*');
    return reply.status(201).send({ category: cat });
  });

  // PATCH /api/categories/:id — admin
  app.patch('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, parentId, status } = request.body as any;
    
    if (!name?.trim()) return reply.status(400).send({ error: 'Name required' });
    if (parentId && parentId === id) return reply.status(400).send({ error: 'Category cannot be its own parent' });

    const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const updateData: any = {
      name: name.trim(), 
      slug,
      parent_id: parentId || null
    };
    if (status) updateData.status = status;

    const [cat] = await db('categories').where({ id }).update(updateData).returning('*');
    return reply.send({ category: cat });
  });

  // DELETE /api/categories/:id — admin
  app.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const cat = await db('categories').where({ id }).first();
    if (!cat) return reply.status(404).send({ error: 'Category not found' });

    // Validate relationships before deletion
    const [{ count: coursesCount }] = await db('courses')
      .where({ category: cat.slug })
      .orWhere({ category: cat.id })
      .count('* as count');
    
    if (Number(coursesCount) > 0) {
      return reply.status(400).send({ 
        error: 'Cannot delete category. It is currently being used by one or more courses.',
        usedInCourses: true 
      });
    }

    const [{ count: childrenCount }] = await db('categories')
      .where({ parent_id: id })
      .count('* as count');

    if (Number(childrenCount) > 0) {
      return reply.status(400).send({ 
        error: 'Cannot delete a parent category that has subcategories. Please reassign or delete its subcategories first.',
        hasSubcategories: true 
      });
    }

    await db('categories').where({ id }).delete();
    return reply.status(204).send();
  });
}
