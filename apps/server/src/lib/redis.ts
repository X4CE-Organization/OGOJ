/**
 * Redis 集成（可选）。设置了 REDIS_URL 就会启用，用于：
 *   - API 限流（多实例共享计数）
 *   - 登录失败锁定（带 TTL 的计数器，不再写数据库）
 *   - 在线人数统计（有序集合，5 分钟窗口）
 *   - 首页等热点数据缓存
 *   - 评测队列唤醒（提交后立刻通知 worker，不用等轮询）
 *
 * 没有配置 Redis 或连接失败时，所有功能都会自动退回原来的实现，不影响使用。
 */
import Redis from 'ioredis';
import { config } from '../config.js';

let client: Redis | null = null;
let subscriber: Redis | null = null;
let ready = false;
let lastError = '';
let pendingDefines: Array<{ name: string; definition: unknown }> = [];
let customCommandsDeclared = false;

export const ONLINE_WINDOW_SECONDS = 300;
export const JUDGE_CHANNEL = 'ogoj:judge:wake';

if (config.redisUrl) {
  client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  client.on('ready', () => {
    ready = true;
    lastError = '';
    // 限流插件可能在本客户端就绪前就注册了自定义命令，这里补上
    if (pendingDefines.length) {
      for (const { name, definition } of pendingDefines) {
        (client as any)?.defineCommand(name, definition);
      }
      pendingDefines = [];
    }
  });
  client.on('end', () => {
    ready = false;
  });
  client.on('error', (error) => {
    ready = false;
    lastError = error.message;
  });
  void client
    .connect()
    .then(() => client?.ping())
    .catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[ogoj] Redis 连接失败，将使用内置回退方案：${lastError}`);
    });
}

export function redisClient(): Redis | null {
  return ready ? client : null;
}

/**
 * 给 @fastify/rate-limit 用的惰性客户端。
 * 关键点：Redis 没就绪时立刻报错，而不是把命令塞进 ioredis 的离线队列 ——
 * 否则一个「配了 Redis 但连不上」的部署会让每个请求都卡十几秒。
 * 配合 `skipOnError: true`，未就绪时直接放行，恢复后自动继续用 Redis 计数。
 */
export function rateLimitStore(): Redis | undefined {
  if (!config.redisUrl) return undefined;
  const notReady = (...args: unknown[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === 'function') {
      (callback as (error: Error, result: null) => void)(new Error('Redis 未就绪'), null);
    }
    // 回调风格由限流插件使用；promise 风格也返回一个「放行」结果，避免未处理的 rejection
    return Promise.resolve([0, 0]);
  };
  return new Proxy({} as Redis, {
    get(_target, prop: string) {
      if (prop === 'defineCommand') {
        return (name: string, definition: unknown) => {
          customCommandsDeclared = true;
          if (client) client.defineCommand(name, definition as any);
          else pendingDefines.push({ name, definition });
        };
      }
      const redis = ready ? client : null;
      const value = redis ? (redis as unknown as Record<string, unknown>)[prop] : undefined;
      if (typeof value === 'function') return (value as (...a: unknown[]) => unknown).bind(redis);
      // 自定义命令还没声明过：返回 undefined，让 @fastify/rate-limit 去调用 defineCommand
      if (!customCommandsDeclared) return undefined;
      return notReady;
    },
  }) as Redis;
}

export function redisEnabled(): boolean {
  return Boolean(config.redisUrl);
}

export function redisReady(): boolean {
  return ready;
}

export function redisLastError(): string {
  return lastError;
}

/* ------------------------------------------------------------------ 缓存 */

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = redisClient();
  if (!redis) return null;
  try {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.round(ttlSeconds)));
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/** 删除某个前缀下的所有缓存（用于内容变更后失效） */
export async function cacheInvalidate(prefix: string): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------- 计数器（限流/锁定） */

export async function counterIncr(key: string, ttlSeconds: number): Promise<number | null> {
  const redis = redisClient();
  if (!redis) return null;
  try {
    const value = await redis.incr(key);
    if (value === 1) await redis.expire(key, Math.max(1, Math.round(ttlSeconds)));
    return value;
  } catch {
    return null;
  }
}

export async function counterGet(key: string): Promise<number | null> {
  const redis = redisClient();
  if (!redis) return null;
  try {
    const value = await redis.get(key);
    return value === null ? 0 : Number(value);
  } catch {
    return null;
  }
}

export async function counterReset(key: string): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------ 在线人数 */

export async function touchOnline(userId: number): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  try {
    const now = Date.now();
    await redis.zadd('ogoj:online', now, String(userId));
    await redis.zremrangebyscore('ogoj:online', 0, now - ONLINE_WINDOW_SECONDS * 1000);
  } catch {
    /* ignore */
  }
}

export async function onlineCount(): Promise<number | null> {
  const redis = redisClient();
  if (!redis) return null;
  try {
    const now = Date.now();
    await redis.zremrangebyscore('ogoj:online', 0, now - ONLINE_WINDOW_SECONDS * 1000);
    return await redis.zcard('ogoj:online');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ 评测队列唤醒信号 */

export async function publishJudgeWake(submissionId: number): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  try {
    await redis.publish(JUDGE_CHANNEL, String(submissionId));
  } catch {
    /* ignore */
  }
}

/** 订阅评测唤醒信号；返回取消订阅函数 */
export function subscribeJudgeWake(handler: () => void): () => void {
  if (!config.redisUrl) return () => undefined;
  try {
    subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
    subscriber.on('error', () => undefined);
    void subscriber.subscribe(JUDGE_CHANNEL).catch(() => undefined);
    subscriber.on('message', (channel) => {
      if (channel === JUDGE_CHANNEL) handler();
    });
  } catch {
    /* ignore */
  }
  return () => {
    void subscriber?.quit().catch(() => undefined);
    subscriber = null;
  };
}

/* ------------------------------------------------------------ 状态信息 */

export async function redisInfo(): Promise<{
  enabled: boolean;
  connected: boolean;
  version?: string;
  memory?: string;
  keys?: number;
  online?: number;
  error?: string;
}> {
  const redis = redisClient();
  if (!redis) {
    return {
      enabled: redisEnabled(),
      connected: false,
      error: redisEnabled() ? lastError || '连接中' : '未配置 REDIS_URL',
    };
  }
  try {
    const info = await redis.info('server');
    const memory = await redis.info('memory');
    const version = /redis_version:([^\r\n]+)/.exec(info)?.[1];
    const used = /used_memory_human:([^\r\n]+)/.exec(memory)?.[1];
    return {
      enabled: true,
      connected: true,
      version,
      memory: used,
      keys: await redis.dbsize(),
      online: (await onlineCount()) ?? undefined,
    };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function closeRedis(): Promise<void> {
  await subscriber?.quit().catch(() => undefined);
  await client?.quit().catch(() => undefined);
  subscriber = null;
  client = null;
  ready = false;
}
