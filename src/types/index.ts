export type UserRole = 'student' | 'instructor' | 'admin';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
}
