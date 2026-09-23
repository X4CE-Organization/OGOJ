import type { FastifyInstance } from 'fastify';
import { all, count, get, run } from '../db/index.js';
import { hasRole, requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound, tooMany } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, num, json as settingJson } from '../settings/index.js';
import { parseId, parsePage, rateLimit, sqlLike } from '../lib/util.js';
import { submissionSummary } from './helpers.js';
import { judgeStats, rejudge } from '../judge/index.js';
import { languageAvailable } from '../judge/languages.js';
import { contestStatus } from './public.js';

function findSubmission(idOrId: string): any {
  const id = Number(idOrId);
  if (!Number.isInteger(id)) throw badRequest('无效的提交编号');
  const row = get<any>(
    `SELECT s.*, p.pid, p.title AS problem_title, p.is_public AS problem_public,
            u.username, u.display_name, u.avatar
       FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [id],
  );
  if (!row) throw notFound('提交记录不存在');
  return row;
}

function contestOf(contestId: number | null): any {
  if (!contestId) return null;
  return get<any>('SELECT * FROM contests WHERE id = ?', [contestId]);
}

export async function registerSubmissionRoutes(app: FastifyInstance): Promise<void> {
  /* ----------------------------------------------------------------- submit */
  app.post('/api/submissions', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (request) => {
      const user = requireUser(request);
      if (!bool('allow_submit', true)) throw forbidden('本站暂时关闭了提交');
      const body = (request.body ?? {}) as any;
      const language = String(body.language ?? '').trim();
      const code = String(body.code ?? '');
      if (!language) throw badRequest('请选择语言');
      if (!code.trim()) throw badRequest('代码不能为空');

      const enabled = settingJson<string[]>('enabled_languages', ['cpp']);
      if (!enabled.includes(language)) throw badRequest('该语言未启用');
      if (!languageAvailable(language)) throw badRequest('评测机不支持该语言，请联系管理员');

      const maxCodeKb = num('max_code_size_kb', 64);
      if (Buffer.byteLength(code, 'utf8') > maxCodeKb * 1024) {
        throw badRequest(`代码长度超过限制（${maxCodeKb} KB）`);
      }

      const problemRef = body.problemId ?? body.pid;
      const problem = Number.isInteger(Number(problemRef))
        ? get<any>('SELECT * FROM problems WHERE id = ?', [Number(problemRef)])
        : get<any>('SELECT * FROM problems WHERE pid = ?', [String(problemRef ?? '')]);
      if (!problem || problem.deleted_at) throw notFound('题目不存在');

      const allowedLanguages = JSON.parse(problem.allow_languages || '[]') as string[];
      if (allowedLanguages.length && !allowedLanguages.includes(language)) {
        throw badRequest('该题目不允许使用此语言');
      }

      const interval = num('submit_interval_seconds', 3);
      if (!rateLimit(`submit:${user.id}`, interval)) {
        throw tooMany(`提交过于频繁，请 ${interval} 秒后再试`);
      }
      const dailyLimit = num('max_submissions_per_day', 0);
      if (dailyLimit > 0) {
        const todayCount = count(
          `SELECT COUNT(*) AS c FROM submissions WHERE user_id = ? AND created_at >= date('now')`,
          [user.id],
        );
        if (todayCount >= dailyLimit) throw tooMany(`今日提交次数已达上限（${dailyLimit}）`);
      }

      let contestId: number | null = null;
      if (body.contestId) {
        const contest = get<any>('SELECT * FROM contests WHERE id = ?', [Number(body.contestId)]);
        if (!contest) throw notFound('比赛不存在');
        const status = contestStatus(contest.start_time, contest.end_time);
        if (status === 'upcoming') throw forbidden('比赛尚未开始');
        if (status === 'ended') throw forbidden('比赛已经结束');
        const linked = get('SELECT 1 AS x FROM contest_problems WHERE contest_id = ? AND problem_id = ?', [
          contest.id,
          problem.id,
        ]);
        if (!linked) throw badRequest('该题目不在本场比赛中');
        const registered = get('SELECT 1 AS x FROM contest_registrations WHERE contest_id = ? AND user_id = ?', [
          contest.id,
          user.id,
        ]);
        if (!registered && contest.need_register) {
          throw forbidden('请先报名参加本场比赛');
        }
        const isAdmin = hasRole(user, 'admin');
        if (!registered && !isAdmin && !bool('contest_allow_star', true)) {
          throw forbidden('本场比赛不允许非正式参赛');
        }
        contestId = contest.id;
      } else if (!problem.is_public || problem.review_status !== 'approved') {
        const isOwner = user.id === problem.owner_id || user.id === problem.author_id;
        if (!isOwner && !hasRole(user, 'admin')) throw notFound('题目不存在');
      }

      if (problem.is_contest_only && !contestId && !hasRole(user, 'admin')) {
        const isOwner = user.id === problem.owner_id || user.id === problem.author_id;
        if (!isOwner) throw forbidden('该题目仅在比赛中开放');
      }

      const info = run(
        `INSERT INTO submissions (problem_id, user_id, contest_id, language, code, code_length, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          problem.id,
          user.id,
          contestId,
          language,
          code,
          Buffer.byteLength(code, 'utf8'),
          contestId && bool('judge_priority_boost', true) ? 10 : 0,
        ],
      );
      const submissionId = Number(info.lastInsertRowid);
      run('UPDATE problems SET submit_count = submit_count + 1 WHERE id = ?', [problem.id]);
      run(
        `INSERT INTO user_problem_stats (user_id, problem_id, attempts, accepted, last_submit_at)
         VALUES (?, ?, 1, 0, datetime('now'))
         ON CONFLICT(user_id, problem_id) DO UPDATE SET attempts = attempts + 1,
           last_submit_at = datetime('now')`,
        [user.id, problem.id],
      );
      audit(request, 'submission.create', {
        targetType: 'submission',
        targetId: submissionId,
        detail: { problemId: problem.id, language },
      });
      return { ok: true, id: submissionId, status: 'Waiting' };
    },
  });

  /* ------------------------------------------------------------------- list */
  app.get('/api/submissions', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, num('submission_page_size', 50));
    const conditions = ['1 = 1'];
    const params: unknown[] = [];

    if (query.problem) {
      const problem = get<{ id: number }>(
        Number.isInteger(Number(query.problem))
          ? 'SELECT id FROM problems WHERE id = ?'
          : 'SELECT id FROM problems WHERE pid = ?',
        [Number.isInteger(Number(query.problem)) ? Number(query.problem) : String(query.problem)],
      );
      conditions.push('s.problem_id = ?');
      params.push(problem?.id ?? -1);
    }
    if (query.user) {
      conditions.push('u.username = ?');
      params.push(String(query.user));
    }
    if (query.mine === 'true') {
      const user = requireUser(request);
      conditions.push('s.user_id = ?');
      params.push(user.id);
    }
    if (query.status) {
      conditions.push('s.status = ?');
      params.push(String(query.status));
    }
    if (query.language) {
      conditions.push('s.language = ?');
      params.push(String(query.language));
    }
    if (query.contest) {
      conditions.push('s.contest_id = ?');
      params.push(Number(query.contest));
    }
    if (query.q) {
      conditions.push('(p.title LIKE ? ESCAPE \'\\\' OR p.pid LIKE ? ESCAPE \'\\\')');
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }

    const viewer = request.user;
    if (!hasRole(viewer, 'admin')) {
      // Submissions from running contests stay hidden until the contest ends.
      conditions.push(
        `(s.is_public = 1 AND (s.contest_id IS NULL
           OR s.user_id = ?
           OR EXISTS (SELECT 1 FROM contests c WHERE c.id = s.contest_id AND c.end_time < datetime('now'))))`,
      );
      params.push(viewer?.id ?? -1);
    }

    const rows = all<any>(
      `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.score, s.time_ms, s.memory_kb,
              s.code_length, s.contest_id, s.created_at, p.pid, p.title AS problem_title,
              u.username, u.display_name, u.avatar
         FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return { items: rows.map(submissionSummary), total, page: page.page, size: page.size };
  });

  /* ----------------------------------------------------------------- detail */
  app.get('/api/submissions/:id', async (request) => {
    const row = findSubmission(String((request.params as any).id));
    const viewer = request.user;
    const contest = contestOf(row.contest_id);
    const isOwner = viewer?.id === row.user_id;
    const isAdmin = hasRole(viewer, 'admin');
    if (!row.is_public && !isOwner && !isAdmin) throw notFound('提交记录不存在');

    let codeHidden = false;
    if (!isOwner && !isAdmin) {
      if (!bool('show_others_code', true)) codeHidden = true;
      if (contest && contestStatus(contest.start_time, contest.end_time) === 'running') codeHidden = true;
      if (bool('show_others_code_need_ac', false)) {
        const solved = get(
          'SELECT 1 AS x FROM user_problem_stats WHERE user_id = ? AND problem_id = ? AND accepted > 0',
          [viewer?.id ?? -1, row.problem_id],
        );
        if (!solved) codeHidden = true;
      }
    }

    let detail = JSON.parse(row.detail || '[]');
    if (!bool('show_judge_detail', true) && !isOwner && !isAdmin) detail = [];
    if (!bool('show_testcase_data', false)) {
      detail = detail.map(({ input, output, answer, ...rest }: any) => rest);
    }

    return {
      submission: {
        id: row.id,
        problemId: row.problem_id,
        problemPid: row.pid,
        problemTitle: row.problem_title,
        user: {
          id: row.user_id,
          username: row.username,
          display_name: row.display_name,
          avatar: row.avatar,
        },
        language: row.language,
        status: row.status,
        score: row.score,
        timeMs: row.time_ms,
        memoryKb: row.memory_kb,
        code: codeHidden ? null : row.code,
        codeHidden,
        codeLength: row.code_length,
        compileOutput: isOwner || isAdmin ? row.compile_output : row.status === 'CE' ? row.compile_output : '',
        detail,
        contestId: row.contest_id,
        isPublic: Boolean(row.is_public),
        hacked: Boolean(row.hacked),
        hackId: row.hack_id ?? null,
        createdAt: row.created_at,
        judgedAt: row.judged_at,
      },
    };
  });

  app.put('/api/submissions/:id/public', async (request) => {
    const user = requireUser(request);
    const row = findSubmission(String((request.params as any).id));
    if (row.user_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    const isPublic = (request.body as any)?.isPublic !== false;
    run('UPDATE submissions SET is_public = ? WHERE id = ?', [isPublic ? 1 : 0, row.id]);
    return { ok: true, isPublic };
  });

  app.delete('/api/submissions/:id', async (request) => {
    const user = requireAdmin(request);
    const row = findSubmission(String((request.params as any).id));
    run('DELETE FROM submissions WHERE id = ?', [row.id]);
    audit(request, 'submission.delete', { targetType: 'submission', targetId: row.id });
    void user;
    return { ok: true };
  });

  /* ---------------------------------------------------------------- rejudge */
  app.post('/api/submissions/:id/rejudge', async (request) => {
    requireAdmin(request);
    const row = findSubmission(String((request.params as any).id));
    rejudge({ submissionIds: [row.id] });
    audit(request, 'submission.rejudge', { targetType: 'submission', targetId: row.id });
    return { ok: true };
  });

  app.post('/api/submissions/rejudge', async (request) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const affected = rejudge({
      problemId: body.problemId ? Number(body.problemId) : undefined,
      contestId: body.contestId ? Number(body.contestId) : undefined,
      submissionIds: Array.isArray(body.submissionIds) ? body.submissionIds.map(Number) : undefined,
    });
    if (!affected) throw badRequest('请指定要重测的范围');
    audit(request, 'submission.rejudge_batch', { detail: { ...body, affected } });
    return { ok: true, affected };
  });

  app.get('/api/judge/status', async (request) => {
    const user = request.user;
    const stats = judgeStats();
    if (!hasRole(user, 'admin')) {
      return { waiting: stats.waiting, judging: stats.judging };
    }
    const recent = all<any>(
      `SELECT s.id, s.status, s.time_ms, s.memory_kb, s.created_at, p.pid, u.username
         FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE s.status IN ('Waiting', 'Judging') ORDER BY s.priority DESC, s.id ASC LIMIT 20`,
    );
    return { ...stats, recent };
  });
}
