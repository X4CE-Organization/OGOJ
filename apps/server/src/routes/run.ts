/**
 * 代码自测：用自定义输入跑一遍用户代码，只返回运行结果，不产生提交记录。
 */
import type { FastifyInstance } from 'fastify';
import { get } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound, tooMany } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, json as settingJson, num } from '../settings/index.js';
import { languageAvailable } from '../judge/languages.js';
import { customRunBusy, runCustomTest } from '../judge/custom-run.js';

/** 自定义输入的大小上限 */
const MAX_INPUT_BYTES = 64 * 1024;

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/run',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      requireUser(request);
      if (!bool('enable_custom_test', true)) throw forbidden('本站已关闭自测功能');
      if (customRunBusy()) throw tooMany('自测任务有点多，请稍后再试');

      const body = (request.body ?? {}) as any;
      const language = String(body.language ?? '').trim();
      const code = String(body.code ?? '');
      const input = String(body.input ?? '');
      if (!language) throw badRequest('请选择语言');
      if (!code.trim()) throw badRequest('代码不能为空');
      if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
        throw badRequest(`自测输入不能超过 ${MAX_INPUT_BYTES / 1024} KB`);
      }

      const enabled = settingJson<string[]>('enabled_languages', ['cpp']);
      if (!enabled.includes(language)) throw badRequest('该语言未启用');
      if (!languageAvailable(language)) throw badRequest('评测机不支持该语言，请联系管理员');

      const maxCodeKb = num('max_code_size_kb', 64);
      if (Buffer.byteLength(code, 'utf8') > maxCodeKb * 1024) {
        throw badRequest(`代码长度超过限制（${maxCodeKb} KB）`);
      }

      // 从题目页发起时带上题目，沿用题目的限制；否则用站点默认限制
      const problemRef = body.problemId ?? body.pid;
      let timeLimitMs: number | undefined;
      let memoryLimitMb: number | undefined;
      if (problemRef !== undefined && problemRef !== null && String(problemRef) !== '') {
        const problem = Number.isInteger(Number(problemRef))
          ? get<any>('SELECT * FROM problems WHERE id = ?', [Number(problemRef)])
          : get<any>('SELECT * FROM problems WHERE pid = ?', [String(problemRef)]);
        if (!problem || problem.deleted_at) throw notFound('题目不存在');
        const allowed = JSON.parse(problem.allow_languages || '[]') as string[];
        if (allowed.length && !allowed.includes(language)) throw badRequest('该题目不允许使用此语言');
        timeLimitMs = problem.time_limit;
        memoryLimitMb = problem.memory_limit;
      }

      const result = await runCustomTest({ language, code, input, timeLimitMs, memoryLimitMb });
      if (result.status === 'SE') audit(request, 'code.self_test_error', { detail: { language } });
      return { ok: true, result };
    },
  );
}
