import type { FastifyReply, FastifyRequest } from 'fastify';
import { get } from '../db/index.js';
import { verifyToken } from './crypto.js';
import { forbidden, unauthorized } from './errors.js';
import { rawSetting } from '../settings/index.js';

export type Role = 'user' | 'admin' | 'superadmin';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  display_name: string | null;
  avatar: string | null;
  points: number;
  is_banned: number;
  ban_reason: string | null;
  solved_count: number;
}

export const ROLE_LEVEL: Record<Role, number> = { user: 1, admin: 2, superadmin: 3 };

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export function tokenFromRequest(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (request.cookies as Record<string, string> | undefined)?.ogoj_token;
  return cookie ?? null;
}

export function resolveUser(request: FastifyRequest): AuthUser | null {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = get<AuthUser & { role: Role }>(
    `SELECT id, username, role, display_name, avatar, points, is_banned, ban_reason, solved_count
       FROM users WHERE id = ?`,
    [payload.sub],
  );
  if (!user) return null;
  if (user.is_banned) return null;
  return user;
}

export function requireUser(request: FastifyRequest): AuthUser {
  const user = request.user ?? resolveUser(request);
  if (!user) throw unauthorized();
  return user;
}

export function hasRole(user: AuthUser | null, role: Role): boolean {
  if (!user) return false;
  return ROLE_LEVEL[user.role] >= ROLE_LEVEL[role];
}

export function requireRole(request: FastifyRequest, role: Role): AuthUser {
  const user = requireUser(request);
  if (!hasRole(user, role)) throw forbidden();
  return user;
}

/** 普通管理员：可以管理题目；超级管理员：全部权限。 */
export const requireAdmin = (request: FastifyRequest) => requireRole(request, 'admin');
export const requireSuperAdmin = (request: FastifyRequest) => requireRole(request, 'superadmin');

export function isSuperAdmin(user: AuthUser | null): boolean {
  return hasRole(user, 'superadmin');
}

export function setAuthCookie(reply: FastifyReply, token: string, days: number): void {
  reply.setCookie('ogoj_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: rawSetting('force_https') === 'true',
    maxAge: days * 86400,
  });
}

export function clearAuthCookie(reply: FastifyReply): void {
  reply.clearCookie('ogoj_token', { path: '/' });
}
