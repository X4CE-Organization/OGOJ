/**
 * 第三方头像处理。
 *
 * 第三方返回的头像地址不能直接信任：可能是空串、奇怪协议、超长字符串，
 * 而且 GitHub / Gitee 这类地址在国内时快时慢，甚至过一段时间就失效。
 * 所以这里做两件事：
 *   1. 校验并清洗地址（只接受 http(s) 且长度合理）
 *   2. 尽量把头像下载到本站 /uploads/avatar/ 下，前端就不用再跨境请求
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publicUploadPath, uploadDir } from './storage.js';

/** 第三方头像允许的最大体积 */
const MAX_BYTES = 2 * 1024 * 1024;
/** 下载超时，避免拖慢登录 */
const FETCH_TIMEOUT_MS = 4000;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** 本站镜像头像的路径前缀，用来判断「头像是不是我们同步来的」 */
export const MIRROR_PREFIX = '/uploads/avatar/oauth-';

/** 只保留合法的 http(s) 地址，其余（空串、data:、javascript:、超长串）一律丢弃 */
export function normalizeAvatarUrl(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url || url.length > 500) return '';
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return '';
    return url;
  } catch {
    return '';
  }
}

export function isMirroredAvatar(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith(MIRROR_PREFIX));
}

/**
 * 把第三方头像下载到本站，返回本地地址；
 * 任何一步失败都原样返回传入的地址，绝不影响登录流程。
 */
export async function mirrorAvatar(url: string, key: string): Promise<string> {
  const source = normalizeAvatarUrl(url);
  if (!source) return '';
  try {
    const response = await fetch(source, {
      headers: { 'User-Agent': 'OGOJ', Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return source;
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) return source;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return source;

    // 用「来源 + 地址」做文件名：同一张头像重复登录不会产生一堆文件
    const digest = createHash('sha1').update(`${key}:${source}`).digest('hex').slice(0, 12);
    const safeKey = key.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 24) || 'user';
    const name = `oauth-${safeKey}-${digest}${ext}`;
    fs.writeFileSync(path.join(uploadDir('avatar'), name), buffer);
    return publicUploadPath(`avatar/${name}`);
  } catch {
    // 服务器也拿不到（网络不通、超时、不是图片）就继续用原始地址
    return source;
  }
}

/** 删除本站镜像出来的旧头像，避免 /uploads 里堆垃圾 */
export function removeMirroredAvatar(url: string | null | undefined): void {
  if (!isMirroredAvatar(url)) return;
  const relative = url!.replace(/^\/uploads\//, '');
  if (!/^avatar\/oauth-[a-zA-Z0-9_.-]+$/.test(relative)) return;
  try {
    fs.rmSync(path.join(uploadDir(), relative), { force: true });
  } catch {
    /* ignore */
  }
}
