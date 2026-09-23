import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config, ensureDataDirs } from './config.js';
import { migrate } from './db/index.js';
import { HttpError } from './lib/errors.js';
import { resolveUser } from './lib/auth.js';
import { bool, num, str } from './settings/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerProblemRoutes } from './routes/problems.js';
import { registerSubmissionRoutes } from './routes/submissions.js';
import { registerContestRoutes } from './routes/contests.js';
import { registerCommunityRoutes } from './routes/community.js';
import { registerUserRoutes } from './routes/users.js';
import { registerShopRoutes } from './routes/shop.js';
import { registerListRoutes } from './routes/lists.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerHackRoutes } from './routes/hacks.js';
import { registerAchievementRoutes } from './routes/achievements.js';

export async function buildApp(): Promise<FastifyInstance> {
  ensureDataDirs();
  migrate();

  const app = Fastify({
    logger: {
      level: config.env === 'production' ? 'info' : 'warn',
      transport: undefined,
    },
    bodyLimit: num('max_upload_size_mb', 64) * 1024 * 1024,
    trustProxy: true,
    disableRequestLogging: true,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: num('max_upload_size_mb', 64) * 1024 * 1024,
      files: 1,
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: Math.max(60, num('rate_limit_per_minute', 300)),
    timeWindow: '1 minute',
    allowList: () => false,
    errorResponseBuilder: () => ({
      code: 429,
      error: 'Too Many Requests',
      message: '请求过于频繁，请稍后再试',
    }),
  });

  app.addHook('onRequest', async (request, reply) => {
    request.user = resolveUser(request);

    const blocked = new Set(
      (JSON.parse(str('blocked_ips', '[]') || '[]') as string[]).filter(Boolean),
    );
    if (blocked.has(request.ip)) {
      return reply.code(403).send({ code: 403, message: '你的 IP 已被封禁' });
    }

    if (bool('maintenance_mode', false) && request.url.startsWith('/api')) {
      const isAdmin = request.user && ['admin', 'superadmin'].includes(request.user.role);
      const allowed =
        request.url.startsWith('/api/auth/') ||
        request.url.startsWith('/api/settings') ||
        request.url.startsWith('/api/meta') ||
        (bool('maintenance_allow_admin', true) && isAdmin);
      if (!allowed) {
        throw new HttpError(503, str('maintenance_message', '站点维护中'));
      }
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        code: error.statusCode,
        message: error.message,
        error: error.code,
        detail: error.detail,
      });
    }
    const err = error as { statusCode?: number; message?: string; code?: string };
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({
      code: status,
      message: status >= 500 ? '服务器内部错误' : (err.message ?? '请求失败'),
      error: err.code ?? 'ERROR',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      return reply.code(404).send({ code: 404, message: '接口不存在' });
    }
    const indexPath = path.join(config.paths.webDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      reply.type('text/html').send(fs.readFileSync(indexPath, 'utf8'));
      return;
    }
    return reply.code(404).send({ code: 404, message: '前端尚未构建，请先运行 npm run build' });
  });

  fs.mkdirSync(config.paths.uploads, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.paths.uploads,
    prefix: '/uploads/',
    decorateReply: false,
  });
  if (fs.existsSync(config.paths.webDist)) {
    await app.register(fastifyStatic, {
      root: config.paths.webDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });
  }

  app.get('/api/health', async () => ({ ok: true, name: str('site_name', 'OGOJ'), time: new Date().toISOString() }));

  await registerPublicRoutes(app);
  await registerAuthRoutes(app);
  await registerOAuthRoutes(app);
  await registerUserRoutes(app);
  await registerProblemRoutes(app);
  await registerSubmissionRoutes(app);
  await registerHackRoutes(app);
  await registerContestRoutes(app);
  await registerCommunityRoutes(app);
  await registerAchievementRoutes(app);
  await registerShopRoutes(app);
  await registerListRoutes(app);
  await registerAdminRoutes(app);
  await registerUploadRoutes(app);

  return app;
}
