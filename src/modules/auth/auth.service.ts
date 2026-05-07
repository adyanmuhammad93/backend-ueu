import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/knex.js';
import { jwtService } from '../../shared/jwt.service.js';
import { ConflictError, UnauthorizedError, NotFoundError, ForbiddenError } from '../../shared/errors.js';
import type { RegisterInput, LoginInput, UpdateProfileInput, ChangePasswordInput } from './auth.schema.js';

/**
 * Security: argon2id is the recommended password hashing algorithm.
 * Never use bcrypt for new projects (limited to 72 bytes, timing side-channels).
 */
const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB — makes brute-force expensive
  timeCost: 3,
  parallelism: 4,
};

export const authService = {
  async register(input: RegisterInput) {
    // Security: Check for duplicate email before hashing (avoids unnecessary CPU)
    const existing = await db('users').where({ email: input.email }).first();
    if (existing) throw new ConflictError('An account with this email already exists');

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

    // Use a transaction so partial failures don't create orphaned records
    const user = await db.transaction(async (trx) => {
      const [newUser] = await trx('users').insert({
        id: uuidv4(),
        email: input.email,
        password_hash: passwordHash,
        full_name: input.fullName,
        role: input.role,
      }).returning(['id', 'email', 'full_name', 'role', 'avatar_url', 'gemini_api_key', 'created_at']);

      return newUser;
    });

    const accessToken = jwtService.signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = await jwtService.createRefreshToken(user.id);

    return { user: mapUser(user), accessToken, refreshToken };
  },

  async login(input: LoginInput) {
    const user = await db('users').where({ email: input.email }).first();

    // Security: Use constant-time comparison even when user doesn't exist to prevent email enumeration
    if (!user) {
      await argon2.hash('dummy_password_to_prevent_timing_attacks', ARGON2_OPTIONS);
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await argon2.verify(user.password_hash, input.password);
    if (!valid) throw new UnauthorizedError('Invalid email or password');

    const accessToken = jwtService.signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = await jwtService.createRefreshToken(user.id);

    // Fetch enrolled course IDs
    const enrollments = await getActiveEnrollmentCourseIds(user.id);

    return {
      user: { ...mapUser(user), enrolledCourseIds: enrollments.map((e: any) => e.course_id) },
      accessToken,
      refreshToken,
    };
  },

  async getCurrentUser(userId: string) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw new NotFoundError('User');

    const enrollments = await getActiveEnrollmentCourseIds(userId);

    return {
      ...mapUser(user),
      enrolledCourseIds: enrollments.map((e: any) => e.course_id),
    };
  },

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const payload: Record<string, any> = {};
    if (input.fullName !== undefined) payload.full_name = input.fullName;
    if (input.avatarUrl !== undefined) payload.avatar_url = input.avatarUrl;
    if (input.geminiApiKey !== undefined) payload.gemini_api_key = input.geminiApiKey;

    if (Object.keys(payload).length === 0) return;

    payload.updated_at = new Date().toISOString();

    await db('users').where({ id: userId }).update(payload);
  },

  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw new NotFoundError('User');

    const valid = await argon2.verify(user.password_hash, input.currentPassword);
    if (!valid) throw new ForbiddenError('Current password is incorrect');

    const newHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);
    await db('users').where({ id: userId }).update({ password_hash: newHash, updated_at: new Date() });

    // Revoke all refresh tokens on password change (security: active sessions should re-login)
    await jwtService.revokeAllUserTokens(userId);
  },

  async getUserForImpersonation(targetUserId: string, adminId: string) {
    // Verify caller is admin
    const admin = await db('users').where({ id: adminId, role: 'admin' }).first();
    if (!admin) throw new ForbiddenError('Only admins can impersonate users');

    const user = await db('users').where({ id: targetUserId }).first();
    if (!user) throw new NotFoundError('User');

    const enrollments = await getActiveEnrollmentCourseIds(targetUserId);

    // Issue a special short-lived access token for impersonation
    const accessToken = jwtService.signAccessToken({ sub: user.id, email: user.email, role: user.role });

    return {
      user: { ...mapUser(user), enrolledCourseIds: enrollments.map((e: any) => e.course_id) },
      accessToken,
    };
  },
};

function mapUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.full_name || 'User',
    role: user.role,
    avatarUrl: user.avatar_url || null,
    geminiApiKey: user.gemini_api_key || null,
  };
}


async function getActiveEnrollmentCourseIds(userId: string) {
  return db('enrollments')
    .where({ user_id: userId, status: 'active' })
    .select('course_id');
}
