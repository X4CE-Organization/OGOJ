import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { hasRole, requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, num } from '../settings/index.js';
import { parseId, parsePage, rateLimit, sqlLike } from '../lib/util.js';
import { addPoints } from '../lib/points.js';
import { sendMessage } from '../lib/notify.js';
import { evaluateAchievements } from '../lib/achievements.js';
import { judgeSubmission, rejudge } from '../judge/index.js';
import { getLanguage } from '../judge/languages.js';
import { compileSource, ensureDir, removeDir, runSandboxed } from '../judge/sandbox.js';
import { config } from '../config.js';
import { saveTestcase } from '../lib/storage.js';
import { contestStatus } from './public.js';

/** Compile + run the problem's reference solution to obtain the expected
 *  output for a freshly crafted hack input. */
async function generateAnswer(
  problem: any,
  input: string,
): Promise<{ answer: string; error?: string }> {
  if (!problem.hack_code) {
    if (problem.judge_mode === 'spj' && problem.spj_code) {
      return { answer: '' }; // the checker decides, no reference answer needed
    }
    return { answer: '', error: '该题目尚未配置 Hack 参考程序，无法自动生成答案' };
  }
  const language = getLanguage(problem.hack_language || 'cpp');
  if (!language) return { answer: '', error: `参考程序语言不受支持：${problem.hack_language}` };

  const dir = ensureDir(path.join(config.paths.judge, `hack-ref-${Date.now().toString(36)}`));
  try {
    fs.writeFileSync(path.join(dir, language.sourceFile), problem.hack_code, 'utf8');
    if (language.compile) {
      const { cmd, args } = language.compile({ memMb: problem.memory_limit });
      const compiled = await compileSource(cmd, args, dir, num('compile_timeout_ms', 15000));
      if (!compiled.ok) return { answer: '', error: `参考程序编译失败：\n${compiled.output.slice(0, 500)}` };
    }
    const inputFile = path.join(dir, 'hack.in');
    const outputFile = path.join(dir, 'hack.out');
    fs.writeFileSync(inputFile, input, 'utf8');
    const spec = language.run();
    const result = await runSandboxed(spec.cmd, spec.args, {
      timeLimitMs: Math.max(2000, problem.time_limit * 3),
      memoryLimitMb: problem.memory_limit + 64,
      outputLimitKb: num('output_limit_kb', 64),
      cwd: dir,
      stdinFile: inputFile,
      stdoutFile: outputFile,
      stderrFile: path.join(dir, 'hack.err'),
    });
    if (result.timedOut) return { answer: '', error: '参考程序运行超时，请检查 Hack 数据' };
    if (result.memoryExceeded) return { answer: '', error: '参考程序内存超限' };
    if (result.exitCode !== 0) {
      return { answer: '', error: `参考程序运行出错（退出码 ${result.exitCode}），Hack 数据可能不合法` };
    }
    return { answer: fs.readFileSync(outputFile, 'utf8') };
  } catch (error) {
    return { answer: '', error: error instanceof Error ? error.message : '生成答案失败' };
  } finally {
    removeDir(dir);
  }
}

export async function registerHackRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------ 创建 Hack */
  app.post('/api/hacks', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_hack', true)) throw forbidden('本站未开启 Hack 系统');
    const body = (request.body ?? {}) as any;
    const submissionId = Number(body.submissionId);
    const input = String(body.input ?? '');
    if (!submissionId) throw badRequest('缺少目标提交');
    if (!input.trim()) throw badRequest('请填写 Hack 数据（测试输入）');

    const maxKb = num('hack_max_input_kb', 64);
    if (Buffer.byteLength(input, 'utf8') > maxKb * 1024) {
      throw badRequest(`Hack 数据不能超过 ${maxKb} KB`);
    }

    const target = get<any>(
      `SELECT s.*, p.title AS problem_title, p.pid, p.allow_hack, p.judge_mode, p.spj_code, p.hack_code,
              p.hack_language, p.time_limit, p.memory_limit, u.username AS target_username
         FROM submissions s
         JOIN problems p ON p.id = s.problem_id
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
      [submissionId],
    );
    if (!target) throw notFound('目标提交不存在');
    if (target.status === 'Waiting' || target.status === 'Judging') {
      throw badRequest('目标提交还在评测中，请稍后再试');
    }
    if (target.judge_mode === 'interactive') throw badRequest('交互题暂不支持 Hack');

    const contest = target.contest_id ? get<any>('SELECT * FROM contests WHERE id = ?', [target.contest_id]) : null;
    if (bool('hack_require_contest', false) && !contest) {
      throw forbidden('本站在比赛中才允许 Hack');
    }
    if (contest) {
      if (!contest.allow_hack) throw forbidden('本场比赛未开启 Hack');
      const status = contestStatus(contest.start_time, contest.end_time);
      if (status === 'upcoming') throw forbidden('比赛尚未开始');
      if (status === 'ended' && !bool('hack_open_after_contest', true)) {
        throw forbidden('比赛已结束，本场比赛不再接受 Hack');
      }
    } else if (!target.allow_hack && !hasRole(user, 'admin')) {
      throw forbidden('该题目未开放 Hack');
    }

    if (target.user_id === user.id && !bool('hack_allow_self', false) && !hasRole(user, 'admin')) {
      throw badRequest('不能 Hack 自己的提交');
    }
    if (bool('hack_target_must_be_ac', true) && target.status !== 'AC' && !hasRole(user, 'admin')) {
      throw badRequest('只能 Hack 状态为 Accepted 的提交');
    }
    if (target.hacked) throw conflict('该提交已经被 Hack 过了');

    const interval = num('hack_rate_limit_seconds', 30);
    if (!rateLimit(`hack:${user.id}`, interval)) {
      throw tooMany(`Hack 过于频繁，请 ${interval} 秒后再试`);
    }

    // 1) generate the expected answer with the reference solution
    const generated = await generateAnswer(target, input);
    const hackId = tx(() =>
      Number(
        run(
          `INSERT INTO hacks (contest_id, problem_id, hacker_id, target_submission_id, target_user_id,
             verdict, input_file, answer_file, message, status_before)
           VALUES (?, ?, ?, ?, ?, 'pending', '', '', ?, ?)`,
          [
            target.contest_id,
            target.problem_id,
            user.id,
            target.id,
            target.user_id,
            generated.error ?? '',
            target.status,
          ],
        ).lastInsertRowid,
      ),
    );

    if (generated.error) {
      run(`UPDATE hacks SET verdict = 'error', judged_at = datetime('now') WHERE id = ?`, [hackId]);
      audit(request, 'hack.error', { targetType: 'hack', targetId: hackId, detail: { error: generated.error } });
      return { ok: false, id: hackId, verdict: 'error', message: generated.error };
    }

    // 2) store the hack test and attach it to the problem's test set
    //    Its score is the average of the regular test cases so that failing it
    //    also lowers the total score (instead of only changing the verdict).
    const regular = all<{ score: number }>(
      'SELECT score FROM testcases WHERE problem_id = ? AND is_hack = 0 AND score > 0',
      [target.problem_id],
    );
    const averageScore = regular.length
      ? Math.max(1, Math.round(regular.reduce((sum, row) => sum + row.score, 0) / regular.length))
      : 1;
    const nextIdx =
      (get<{ maxIdx: number | null }>('SELECT MAX(idx) AS maxIdx FROM testcases WHERE problem_id = ?', [
        target.problem_id,
      ])?.maxIdx ?? 0) + 1;
    const saved = saveTestcase(target.problem_id, nextIdx, input, generated.answer);
    const testcaseId = tx(() =>
      Number(
        run(
          `INSERT INTO testcases (problem_id, idx, subtask_id, score, input_file, output_file, is_sample, is_hack, hack_id, created_by)
           VALUES (?, ?, 0, ?, ?, ?, 0, 1, ?, ?)`,
          [target.problem_id, nextIdx, averageScore, saved.inputFile, saved.outputFile, hackId, user.id],
        ).lastInsertRowid,
      ),
    );
    run('UPDATE hacks SET testcase_id = ?, input_file = ?, answer_file = ? WHERE id = ?', [
      testcaseId,
      saved.inputFile,
      saved.outputFile,
      hackId,
    ]);

    // 3) rejudge the target submission with the hack test included
    rejudge({ submissionIds: [target.id] });
    const outcome = await judgeSubmission(target.id);
    const statusAfter = outcome?.status ?? 'SE';
    const scoreAfter = outcome?.score ?? 0;
    const success = statusAfter !== 'AC' || scoreAfter < 100;

    const keepTest = bool('hack_add_to_testdata', true);
    if (!keepTest && !success) {
      // A failed hack must not pollute the test data.
      run('DELETE FROM testcases WHERE id = ?', [testcaseId]);
      run('UPDATE hacks SET testcase_id = NULL WHERE id = ?', [hackId]);
    }

    const successPoints = num('hack_success_points', 10);
    const failPoints = num('hack_fail_points', 0);
    let delta = 0;
    if (success) {
      delta = successPoints;
      if (successPoints > 0 && bool('enable_points', true)) {
        addPoints(user.id, successPoints, `Hack 成功：${target.pid}`, { refType: 'hack', refId: hackId });
      }
      if (keepTest) run('UPDATE submissions SET hacked = 1, hack_id = ? WHERE id = ?', [hackId, target.id]);
    } else if (failPoints > 0) {
      delta = -failPoints;
      if (bool('enable_points', true)) {
        try {
          addPoints(user.id, -failPoints, `Hack 失败：${target.pid}`, { refType: 'hack', refId: hackId });
        } catch {
          /* ignore insufficient balance */
        }
      }
    }

    const message = success
      ? `Hack 成功！目标提交由 ${target.status} 变为 ${statusAfter}`
      : `Hack 失败，目标程序在数据上仍然正确（${statusAfter}）`;
    run(
      `UPDATE hacks SET verdict = ?, message = ?, detail = ?, status_after = ?, score_delta = ?,
         judged_at = datetime('now') WHERE id = ?`,
      [success ? 'success' : 'fail', message, JSON.stringify(outcome?.detail ?? []), statusAfter, delta, hackId],
    );

    if (bool('hack_notify', true)) {
      sendMessage({
        to: user.id,
        title: success ? `🎯 Hack 成功：${target.pid}` : `💥 Hack 失败：${target.pid}`,
        content: `${message}\n\n题目：${target.pid} ${target.problem_title}\n目标提交：#${target.id}`,
        type: 'system',
        refType: 'hack',
        refId: hackId,
      });
      sendMessage({
        to: target.user_id,
        title: `你的提交 #${target.id} 被 Hack`,
        content: success
          ? `你的提交 #${target.id}（${target.pid} ${target.problem_title}）被 ${user.username} 成功 Hack，评测结果变为 ${statusAfter}。`
          : `你的提交 #${target.id} 被 ${user.username} 尝试 Hack，但你的程序成功防住了这组数据。`,
        type: 'system',
        refType: 'hack',
        refId: hackId,
      });
    }
    audit(request, 'hack.create', {
      targetType: 'hack',
      targetId: hackId,
      detail: { submissionId: target.id, verdict: success ? 'success' : 'fail' },
    });
    if (success) evaluateAchievements(user.id);

    return {
      ok: true,
      id: hackId,
      verdict: success ? 'success' : 'fail',
      message,
      statusBefore: target.status,
      statusAfter,
      scoreAfter,
      pointsDelta: delta,
      testcaseIndex: nextIdx,
      kept: keepTest,
      detail: outcome?.detail ?? [],
    };
  });

  /* -------------------------------------------------------------- Hack 列表 */
  app.get('/api/hacks', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, 50);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.problemId) {
      conditions.push('h.problem_id = ?');
      params.push(Number(query.problemId));
    }
    if (query.contestId) {
      conditions.push('h.contest_id = ?');
      params.push(Number(query.contestId));
    }
    if (query.user) {
      conditions.push('hu.username = ?');
      params.push(String(query.user));
    }
    if (query.verdict) {
      conditions.push('h.verdict = ?');
      params.push(String(query.verdict));
    }
    if (query.mine === 'true') {
      const user = requireUser(request);
      conditions.push('(h.hacker_id = ? OR h.target_user_id = ?)');
      params.push(user.id, user.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const items = all<any>(
      `SELECT h.id, h.verdict, h.message, h.status_before, h.status_after, h.score_delta, h.created_at, h.judged_at,
              h.contest_id, h.problem_id, h.target_submission_id,
              p.pid, p.title AS problem_title,
              hu.id AS hacker_id, hu.username AS hacker_username, hu.display_name AS hacker_display, hu.avatar AS hacker_avatar,
              tu.id AS target_user_id, tu.username AS target_username, tu.display_name AS target_display, tu.avatar AS target_avatar
         FROM hacks h
         JOIN problems p ON p.id = h.problem_id
         JOIN users hu ON hu.id = h.hacker_id
         JOIN users tu ON tu.id = h.target_user_id
         ${where} ORDER BY h.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM hacks h JOIN users hu ON hu.id = h.hacker_id ${where}`,
      params,
    );
    return { items, total, page: page.page, size: page.size };
  });

  app.get('/api/hacks/:id', async (request) => {
    const id = parseId((request.params as any).id);
    const hack = get<any>(
      `SELECT h.*, p.pid, p.title AS problem_title, p.judge_mode,
              hu.username AS hacker_username, hu.display_name AS hacker_display, hu.avatar AS hacker_avatar,
              tu.username AS target_username, tu.display_name AS target_display, tu.avatar AS target_avatar
         FROM hacks h JOIN problems p ON p.id = h.problem_id
         JOIN users hu ON hu.id = h.hacker_id JOIN users tu ON tu.id = h.target_user_id
        WHERE h.id = ?`,
      [id],
    );
    if (!hack) throw notFound('Hack 记录不存在');
    const viewer = request.user;
    const canSeeInput =
      bool('hack_show_input', true) ||
      hasRole(viewer, 'admin') ||
      viewer?.id === hack.hacker_id ||
      viewer?.id === hack.target_user_id;
    return {
      hack: {
        ...hack,
        input: canSeeInput ? readHackFile(hack.input_file) : null,
        answer: canSeeInput ? readHackFile(hack.answer_file) : null,
        detail: JSON.parse(hack.detail || '[]'),
      },
    };
  });

  app.get('/api/hacks/:id/target-submission', async (request) => {
    const id = parseId((request.params as any).id);
    const hack = get<any>('SELECT target_submission_id FROM hacks WHERE id = ?', [id]);
    if (!hack) throw notFound('Hack 记录不存在');
    return { submissionId: hack.target_submission_id };
  });

  /* ------------------------------------------------------ 可被 Hack 的提交 */
  app.get('/api/hacks/targets', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, 50);
    const conditions = ['s.status = ?'];
    const params: unknown[] = ['AC'];
    if (query.problemId) {
      conditions.push('s.problem_id = ?');
      params.push(Number(query.problemId));
    }
    if (query.contestId) {
      conditions.push('s.contest_id = ?');
      params.push(Number(query.contestId));
    }
    if (query.q) {
      conditions.push(`(u.username LIKE ? ESCAPE '\\' OR p.pid LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like, like);
    }
    const viewer = request.user;
    if (viewer && !hasRole(viewer, 'admin') && !bool('hack_allow_self', false)) {
      conditions.push('s.user_id <> ?');
      params.push(viewer.id);
    }
    conditions.push('s.hacked = 0');
    if (bool('hack_target_must_be_ac', true)) conditions.push(`s.status = 'AC'`);
    const items = all<any>(
      `SELECT s.id, s.status, s.score, s.time_ms, s.memory_kb, s.language, s.created_at, s.problem_id, s.contest_id,
              p.pid, p.title AS problem_title,
              u.id AS user_id, u.username, u.display_name, u.avatar
         FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return { items, total, page: page.page, size: page.size };
  });

  /* ------------------------------------------------------- 管理员：管理 */
  app.get('/api/admin/hacks', async (request) => {
    requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 50);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.verdict) {
      conditions.push('h.verdict = ?');
      params.push(String(query.verdict));
    }
    if (query.problemId) {
      conditions.push('h.problem_id = ?');
      params.push(Number(query.problemId));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const items = all<any>(
      `SELECT h.*, p.pid, p.title AS problem_title, hu.username AS hacker_username, tu.username AS target_username
         FROM hacks h JOIN problems p ON p.id = h.problem_id
         JOIN users hu ON hu.id = h.hacker_id JOIN users tu ON tu.id = h.target_user_id
         ${where} ORDER BY h.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const stats = all<{ verdict: string; c: number }>(
      'SELECT verdict, COUNT(*) AS c FROM hacks GROUP BY verdict',
    );
    return {
      items,
      total: count(`SELECT COUNT(*) AS c FROM hacks h ${where}`, params),
      stats: Object.fromEntries(stats.map((row) => [row.verdict, row.c])),
      page: page.page,
      size: page.size,
    };
  });

  app.delete('/api/admin/hacks/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const hack = get<any>('SELECT * FROM hacks WHERE id = ?', [id]);
    if (!hack) throw notFound('Hack 记录不存在');
    tx(() => {
      if (hack.testcase_id) {
        run('DELETE FROM testcases WHERE id = ?', [hack.testcase_id]);
      }
      run('UPDATE submissions SET hacked = 0, hack_id = NULL WHERE hack_id = ?', [id]);
      run('DELETE FROM hacks WHERE id = ?', [id]);
    });
    rejudge({ submissionIds: [hack.target_submission_id] });
    audit(request, 'admin.hack_delete', { targetType: 'hack', targetId: id });
    return { ok: true };
  });

  app.post('/api/admin/hacks/:id/rejudge', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const hack = get<any>('SELECT * FROM hacks WHERE id = ?', [id]);
    if (!hack) throw notFound('Hack 记录不存在');
    rejudge({ submissionIds: [hack.target_submission_id] });
    audit(request, 'admin.hack_rejudge', { targetType: 'hack', targetId: id });
    return { ok: true };
  });
}

function readHackFile(relative: string): string {
  if (!relative) return '';
  try {
    const full = path.isAbsolute(relative) ? relative : path.join(config.paths.testdata, relative);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
  } catch {
    return '';
  }
}
