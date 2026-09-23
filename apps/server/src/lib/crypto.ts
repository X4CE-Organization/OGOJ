import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface TokenPayload {
  sub: number;
  username: string;
  role: string;
  iat: number;
  exp: number;
  jti?: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/** Minimal, dependency-free HS256 JWT implementation. */
export function signToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'>,
  expiresInSeconds = config.jwtExpiresDays * 86400,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body: TokenPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  return `${encoded}.${sign(encoded, config.jwtSecret)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`, config.jwtSecret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomCode(length = 6, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
