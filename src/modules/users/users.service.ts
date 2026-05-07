import { db } from '../../db/knex.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../shared/errors.js';
import { paginate, buildPaginatedResult } from '../../shared/pagination.js';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export const usersService = {
  async getPaginatedUsers(page: number, limit: number, search = '', filters?: {
    role?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    hasEnrollments?: boolean;
  }) {
    const { offset, limit: safeLimit } = paginate(page, limit);

    let query = db('users')
      .select('id', 'full_name', 'email', 'role', 'created_at', 'avatar_url');

    if (filters?.hasEnrollments) {
      query = query.whereExists(
        db('enrollments').whereRaw('enrollments.user_id = users.id').select(1),
      );
    }

    if (search) {
      query = query.where((builder) => {
        builder
          .whereILike('full_name', `%${search}%`)
          .orWhereILike('email', `%${search}%`);
      });
    }

    if (filters?.role && filters.role !== 'all') {
      const roles = filters.role.split(',').map(r => r.trim());
      if (roles.length > 1) {
        query = query.whereIn('role', roles);
      } else {
        query = query.where({ role: filters.role });
      }
    }

    const sortCol = ['full_name', 'email', 'role', 'created_at'].includes(filters?.sortBy || '')
      ? filters!.sortBy!
      : 'created_at';

    const sortDir = filters?.sortDir === 'asc' ? 'asc' : 'desc';

    const [{ count }] = await db('users').count('id as count').modify((qb) => {
      if (search) {
        qb.where((b) => b.whereILike('full_name', `%${search}%`).orWhereILike('email', `%${search}%`));
      }
      if (filters?.role && filters.role !== 'all') {
        const roles = filters.role.split(',').map(r => r.trim());
        if (roles.length > 1) {
          qb.whereIn('role', roles);
        } else {
          qb.where({ role: filters.role });
        }
      }
      if (filters?.hasEnrollments) {
        qb.whereExists(db('enrollments').whereRaw('enrollments.user_id = users.id').select(1));
      }
    });

    const data = await query.orderBy(sortCol, sortDir).limit(safeLimit).offset(offset);
    return buildPaginatedResult(data, Number(count), page, safeLimit);
  },

  async getUserById(userId: string) {
    const user = await db('users')
      .where({ id: userId })
      .select('id', 'full_name', 'email', 'role', 'created_at', 'avatar_url')
      .first();

    if (!user) throw new NotFoundError('User');
    return user;
  },

  async adminCreateUser(input: { email: string; password?: string; fullName: string; role: string }) {
    const existing = await db('users').where({ email: input.email }).first();
    if (existing) throw new ConflictError('An account with this email already exists');

    // If no password provided, use a random 12-char string.
    const rawPassword = input.password || Math.random().toString(36).slice(-12);
    const passwordHash = await argon2.hash(rawPassword, ARGON2_OPTIONS);

    const [newUser] = await db('users').insert({
      id: uuidv4(),
      email: input.email,
      password_hash: passwordHash,
      full_name: input.fullName,
      role: input.role,
    }).returning(['id', 'email', 'full_name', 'role', 'created_at']);

    return newUser;
  },

  async adminUpdateUser(userId: string, updates: { role?: string; fullName?: string }) {
    const allowedRoles = ['student', 'instructor', 'admin'];
    const payload: Record<string, any> = { updated_at: new Date() };
    if (updates.fullName) payload.full_name = updates.fullName;
    if (updates.role && allowedRoles.includes(updates.role)) payload.role = updates.role;
    await db('users').where({ id: userId }).update(payload);
  },

  async adminChangeUserPassword(userId: string, newPasswordHash: string) {
    await db('users').where({ id: userId }).update({
      password_hash: newPasswordHash,
      updated_at: new Date(),
    });
  },

  async deleteUser(userId: string, requesterId: string) {
    if (userId === requesterId) throw new ForbiddenError('Cannot delete your own account');
    await db('users').where({ id: userId }).delete();
  },
};
