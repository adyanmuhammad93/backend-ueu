import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
import { db } from '../db/knex.js';
import type { JwtPayload } from '../types/index.js';
import { UnauthorizedError } from '../shared/errors.js';

export const jwtService = {
  signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.accessExpiresIn as jwt.SignOptions['expiresIn'],
    });
  },

  verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, config.jwt.secret) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  },

  async createRefreshToken(userId: string): Promise<string> {
    const token = uuidv4();
    const expiresAt = new Date();
    // Parse "7d" style strings into ms
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db('refresh_tokens').insert({
      id: uuidv4(),
      user_id: userId,
      token,
      expires_at: expiresAt.toISOString(),
    });

    return token;
  },

  async rotateRefreshToken(oldToken: string): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
    const existing = await db('refresh_tokens')
      .where({ token: oldToken })
      .where('expires_at', '>', new Date().toISOString())
      .where('revoked', false)
      .first();

    if (!existing) throw new UnauthorizedError('Invalid or expired refresh token');

    // Revoke old token (rotation — prevent replay)
    await db('refresh_tokens').where({ id: existing.id }).update({ revoked: true });

    const user = await db('users')
      .where({ id: existing.user_id })
      .select('id', 'email', 'role')
      .first();

    if (!user) throw new UnauthorizedError('User not found');

    const accessToken = this.signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = await this.createRefreshToken(user.id);

    return { accessToken, refreshToken, userId: user.id };
  },

  async revokeRefreshToken(token: string): Promise<void> {
    await db('refresh_tokens').where({ token }).update({ revoked: true });
  },

  async revokeAllUserTokens(userId: string): Promise<void> {
    await db('refresh_tokens').where({ user_id: userId }).update({ revoked: true });
  },
};
