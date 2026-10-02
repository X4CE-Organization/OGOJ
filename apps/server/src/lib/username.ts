/**
 * 用户名规则与唯一性检查。
 *
 * 用户名是唯一标识（个人主页地址、@提及、私信收件人都是它），所以：
 *   - 长度 / 字符集 / 保留名按系统设置校验
 *   - 查重一律**忽略大小写**，避免出现 `chengzhao` 和 `ChengZhao` 这种看起来重复的账号
 */
import { get } from '../db/index.js';
import { badRequest } from './errors.js';
import { json as settingJson, num, str } from '../settings/index.js';

export function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim();
}

export function validateUsername(username: string): void {
  const min = num('username_min_length', 3);
  const max = num('username_max_length', 16);
  if (username.length < min) throw badRequest(`用户名至少 ${min} 个字符`);
  if (username.length > max) throw badRequest(`用户名最多 ${max} 个字符`);
  const pattern = str('username_regex', '^[A-Za-z0-9_\\u4e00-\\u9fa5-]{1,32}$');
  try {
    if (!new RegExp(pattern).test(username)) throw badRequest('用户名包含不允许的字符');
  } catch (error) {
    if (error instanceof Error && error.message.includes('不允许')) throw error;
  }
  const banned = settingJson<string[]>('banned_usernames', []).map((item) => item.toLowerCase());
  if (banned.includes(username.toLowerCase())) throw badRequest('该用户名已被保留，请更换');
}

/** 大小写不敏感的用户名查重；`exceptId` 用于改名时排除自己 */
export async function usernameTaken(username: string, exceptId?: number): Promise<boolean> {
  const name = normalizeUsername(username);
  if (!name) return false;
  const row = exceptId
    ? await get('SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?', [name, exceptId])
    : await get('SELECT id FROM users WHERE lower(username) = lower(?)', [name]);
  return Boolean(row);
}
