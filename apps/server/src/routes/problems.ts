import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { FastifyInstance } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { hasRole, requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { num, bool } from '../settings/index.js';
import { parseId, parsePage, sqlLike, toBool } from '../lib/util.js';
import { sendMessage } from '../lib/notify.js';
import {
  problemDetailExtras,
  problemSummary,
  submissionSummary,
  tagRows,
  nextProblemPid,
  isProblemVisibleTo,
} from './helpers.js';
import {
  deleteProblemTestdata,
  deleteTestcaseFiles,
  problemTestdataDir,
  readTestcaseFile,
  saveTestcase,
} from '../lib/storage.js';
import { rejudge } from '../judge/index.js';
import { SPJ_LANGUAGES } from '../judge/languages.js';
import { config } from '../config.js';

function findProblem(idOrPid: string): any {
  const numeric = Number(idOrPid);
  const row = Number.isInteger(numeric) && String(numeric) === idOrPid
    ? get<any>('SELECT * FROM problems WHERE id = ?', [numeric])
    : get<any>('SELECT * FROM problems WHERE pid = ?', [idOrPid]);
  if (!row) throw notFound('题目不存在');
  return row;
}

function assertProblemAccess(problem: any, user: any): void {
  const isOwner = user && (problem.owner_id === user.id || problem.author_id === user.id);
  if (!hasRole(user, 'admin') && !isOwner) throw forbidden('只能修改自己创建的题目');
}

function normalizeSubtask(raw: unknown): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item: any, index: number) => ({
      id: Number(item.id ?? index + 1),
      score: Math.max(0, Number(item.score ?? 0)),
      cases: Array.isArray(item.cases) ? item.cases.map(Number) : undefined,
      method: item.method === 'sum' ? 'sum' : 'min',
      deps: Array.isArray(item.deps) ? item.deps.map(Number) : [],
    }));
}

function normalizeSamples(raw: unknown): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item: any) => ({
      input: String(item.input ?? ''),
      output: String(item.output ?? ''),
      explanation: String(item.explanation ?? ''),
    }));
}

export async function registerProblemRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------------ list */
  app.get('/api/problems', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, num('problem_list_page_size', 50));
    const viewer = request.user;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.all === 'true' && hasRole(viewer, 'admin')) {
      conditions.push('p.deleted_at IS NULL');
      if (query.review) {
        conditions.push('p.review_status = ?');
        params.push(String(query.review));
      }
    } else {
      conditions.push(`p.is_public = 1 AND p.review_status = 'approved' AND p.deleted_at IS NULL`);
    }

    if (query.difficulty) {
      const list = String(query.difficulty).split(',').map(Number).filter((n) => n >= 1 && n <= 6);
      if (list.length) {
        conditions.push(`p.difficulty IN (${list.map(() => '?').join(',')})`);
        params.push(...list);
      }
    }
    if (query.tag) {
      const tagIds = String(query.tag).split(',').map(Number).filter(Boolean);
      if (tagIds.length) {
        conditions.push(
          `EXISTS (SELECT 1 FROM problem_tags pt WHERE pt.problem_id = p.id AND pt.tag_id IN (${tagIds
            .map(() => '?')
            .join(',')}))`,
        );
        params.push(...tagIds);
      }
    }
    if (query.q) {
      conditions.push(`(p.title LIKE ? ESCAPE '\\' OR p.pid LIKE ? ESCAPE '\\' OR p.provider LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like, like);
    }
    if (query.author) {
      conditions.push('u.username = ?');
      params.push(String(query.author));
    }
    if (query.source === 'user') conditions.push(`p.source_type = 'user'`);
    if (query.source === 'official') conditions.push(`p.source_type = 'official'`);

    if (viewer && query.status === 'accepted') {
      conditions.push(
        'EXISTS (SELECT 1 FROM user_problem_stats s WHERE s.problem_id = p.id AND s.user_id = ? AND s.accepted > 0)',
      );
      params.push(viewer.id);
    }
    if (viewer && query.status === 'todo') {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM user_problem_stats s WHERE s.problem_id = p.id AND s.user_id = ? AND s.accepted > 0)',
      );
      params.push(viewer.id);
    }

    const sortMap: Record<string, string> = {
      newest: 'p.id DESC',
      oldest: 'p.id ASC',
      difficulty: 'p.difficulty ASC, p.id ASC',
      difficulty_desc: 'p.difficulty DESC, p.id ASC',
      submissions: 'p.submit_count DESC, p.id DESC',
      acceptance: 'CASE WHEN p.submit_count = 0 THEN 1 ELSE CAST(p.accepted_count AS REAL) / p.submit_count END DESC',
      pid: 'p.pid ASC',
    };
    const orderBy = sortMap[String(query.sort ?? 'newest')] ?? sortMap.newest;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = all<any>(
      `SELECT p.*, u.username AS author_name, u.display_name AS author_display
         FROM problems p LEFT JOIN users u ON u.id = p.author_id
         ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM problems p LEFT JOIN users u ON u.id = p.author_id ${where}`,
      params,
    );
    const tagMap = tagRows(rows.map((r) => r.id));
    return {
      items: rows.map((row) => problemSummary(row, { tags: tagMap.get(row.id) ?? [] })),
      total,
      page: page.page,
      size: page.size,
    };
  });

  /* ---------------------------------------------------------------- detail */
  app.get('/api/problems/:idOrPid', async (request) => {
    const problem = findProblem(String((request.params as any).idOrPid));
    if (!isProblemVisibleTo(problem, request.user)) throw notFound('题目不存在或尚未公开');
    const tags = tagRows([problem.id]).get(problem.id) ?? [];
    const author = problem.author_id
      ? get<any>('SELECT id, username, display_name, avatar FROM users WHERE id = ?', [problem.author_id])
      : null;
    const samples = JSON.parse(problem.samples || '[]');
    const testcaseCount = count('SELECT COUNT(*) AS c FROM testcases WHERE problem_id = ?', [problem.id]);
    const myFavorite = request.user
      ? Boolean(
          get('SELECT 1 AS x FROM problem_favorites WHERE user_id = ? AND problem_id = ?', [
            request.user.id,
            problem.id,
          ]),
        )
      : false;
    const contestLinks = all<any>(
      `SELECT c.id, c.title, c.start_time, c.end_time FROM contest_problems cp
         JOIN contests c ON c.id = cp.contest_id
        WHERE cp.problem_id = ? AND c.is_public = 1 ORDER BY c.start_time DESC LIMIT 10`,
      [problem.id],
    );

    return {
      problem: {
        ...problemSummary(problem, { tags }),
        background: problem.background,
        statement: problem.statement,
        inputFormat: problem.input_format,
        outputFormat: problem.output_format,
        hint: problem.hint,
        judgeMode: problem.judge_mode,
        spjLanguage: problem.spj_language,
        samples,
        subtasks: JSON.parse(problem.subtasks || '[]'),
        allowLanguages: JSON.parse(problem.allow_languages || '[]'),
        compareMode: problem.compare_mode,
        isContestOnly: Boolean(problem.is_contest_only),
        testcaseCount,
        author,
        updatedAt: problem.updated_at,
      },
      myFavorite,
      ...problemDetailExtras(problem.id, request.user),
      contestLinks,
      canEdit:
        hasRole(request.user, 'admin') ||
        Boolean(request.user && (problem.owner_id === request.user.id || problem.author_id === request.user.id)),
      spj: hasRole(request.user, 'admin') ? { language: problem.spj_language, code: problem.spj_code } : undefined,
    };
  });

  /* ---------------------------------------------------------------- create */
  app.post('/api/problems', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as any;
    const isAdmin = hasRole(user, 'admin');

    if (!isAdmin) {
      if (!bool('allow_user_create_problem', true)) throw forbidden('本站未开放用户出题');
      const grant = get<any>(
        `SELECT * FROM grants WHERE user_id = ? AND kind = 'problem' AND used < total
           AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY id ASC LIMIT 1`,
        [user.id],
      );
      if (!grant) {
        throw forbidden('你需要先在商店兑换「出一道题」资格');
      }
      tx(() => run('UPDATE grants SET used = used + 1 WHERE id = ?', [grant.id]));
    }

    const title = String(body.title ?? '').trim();
    if (title.length < 2) throw badRequest('题目标题至少 2 个字符');
    if (title.length > 120) throw badRequest('题目标题过长');

    const timeLimit = Math.min(
      num('max_time_limit', 10000),
      Math.max(100, Number(body.timeLimit ?? num('default_time_limit', 1000)) || 1000),
    );
    const memoryLimit = Math.min(
      num('max_memory_limit', 1024),
      Math.max(16, Number(body.memoryLimit ?? num('default_memory_limit', 256)) || 256),
    );

    const pid = String(body.pid ?? '').trim() || nextProblemPid();
    if (get('SELECT id FROM problems WHERE pid = ?', [pid])) throw conflict('该题目编号已存在');

    const judgeMode = ['standard', 'spj', 'interactive'].includes(body.judgeMode) ? body.judgeMode : 'standard';
    if (judgeMode === 'spj' && !bool('enable_spj', true)) throw forbidden('本站未开启 Special Judge');
    if (judgeMode === 'interactive' && !bool('enable_interactive', true)) throw forbidden('本站未开启交互题');

    const needReview = !isAdmin && bool('user_problem_need_review', true);
    const info = run(
      `INSERT INTO problems
        (pid, title, background, statement, input_format, output_format, hint, difficulty, author_id, owner_id,
         provider, time_limit, memory_limit, judge_mode, compare_mode, spj_language, spj_code, inter_code,
         subtasks, samples, allow_languages, source_type, review_status, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pid,
        title,
        String(body.background ?? ''),
        String(body.statement ?? ''),
        String(body.inputFormat ?? ''),
        String(body.outputFormat ?? ''),
        String(body.hint ?? ''),
        Math.min(6, Math.max(1, Number(body.difficulty ?? 1) || 1)),
        user.id,
        user.id,
        String(body.provider ?? ''),
        timeLimit,
        memoryLimit,
        judgeMode,
        String(body.compareMode ?? ''),
        judgeMode === 'standard' ? '' : String(body.spjLanguage ?? 'cpp'),
        judgeMode === 'standard' ? '' : String(body.spjCode ?? ''),
        judgeMode === 'interactive' ? String(body.interCode ?? '') : '',
        JSON.stringify(normalizeSubtask(body.subtasks)),
        JSON.stringify(normalizeSamples(body.samples)),
        JSON.stringify(Array.isArray(body.allowLanguages) ? body.allowLanguages : []),
        isAdmin ? 'official' : 'user',
        needReview ? 'pending' : 'approved',
        isAdmin ? 1 : needReview ? 0 : 1,
      ],
    );
    const problemId = Number(info.lastInsertRowid);
    applyTags(problemId, body.tags);
    if (needReview) {
      sendMessage({
        to: user.id,
        title: '题目已提交审核',
        content: `你的题目 ${pid}「${title}」已提交，管理员审核通过后即可公开。`,
        type: 'system',
        refType: 'problem',
        refId: problemId,
      });
    }
    audit(request, 'problem.create', { targetType: 'problem', targetId: problemId, detail: { pid, title } });
    return {
      ok: true,
      problem: { id: problemId, pid, reviewStatus: needReview ? 'pending' : 'approved' },
      message: needReview ? '题目已创建，等待管理员审核' : '题目创建成功',
    };
  });

  /* ---------------------------------------------------------------- update */
  app.put('/api/problems/:id', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      values.push(value);
    };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (title.length < 2) throw badRequest('题目标题至少 2 个字符');
      set('title', title.slice(0, 120));
    }
    for (const [key, column] of [
      ['background', 'background'],
      ['statement', 'statement'],
      ['inputFormat', 'input_format'],
      ['outputFormat', 'output_format'],
      ['hint', 'hint'],
      ['provider', 'provider'],
      ['compareMode', 'compare_mode'],
    ] as const) {
      if (body[key] !== undefined) set(column, String(body[key]));
    }
    if (body.difficulty !== undefined) set('difficulty', Math.min(6, Math.max(1, Number(body.difficulty) || 1)));
    if (body.timeLimit !== undefined) {
      set('time_limit', Math.min(num('max_time_limit', 10000), Math.max(100, Number(body.timeLimit) || 1000)));
    }
    if (body.memoryLimit !== undefined) {
      set('memory_limit', Math.min(num('max_memory_limit', 1024), Math.max(16, Number(body.memoryLimit) || 256)));
    }
    if (body.judgeMode !== undefined) {
      const mode = ['standard', 'spj', 'interactive'].includes(body.judgeMode) ? body.judgeMode : 'standard';
      set('judge_mode', mode);
    }
    if (body.spjLanguage !== undefined) set('spj_language', String(body.spjLanguage));
    if (body.spjCode !== undefined) set('spj_code', String(body.spjCode));
    if (body.interCode !== undefined) set('inter_code', String(body.interCode));
    if (body.subtasks !== undefined) set('subtasks', JSON.stringify(normalizeSubtask(body.subtasks)));
    if (body.samples !== undefined) set('samples', JSON.stringify(normalizeSamples(body.samples)));
    if (body.allowLanguages !== undefined) {
      set('allow_languages', JSON.stringify(Array.isArray(body.allowLanguages) ? body.allowLanguages : []));
    }
    if (body.isPublic !== undefined && hasRole(user, 'admin')) set('is_public', body.isPublic ? 1 : 0);
    if (body.isContestOnly !== undefined && hasRole(user, 'admin')) {
      set('is_contest_only', body.isContestOnly ? 1 : 0);
    }
    if (body.reviewStatus !== undefined && hasRole(user, 'admin')) set('review_status', String(body.reviewStatus));
    if (body.pid !== undefined) {
      if (!hasRole(user, 'admin')) throw forbidden('只有管理员可以修改题目编号');
      const pid = String(body.pid).trim();
      if (pid && pid !== problem.pid) {
        if (get('SELECT id FROM problems WHERE pid = ? AND id <> ?', [pid, problem.id])) {
          throw conflict('该题目编号已存在');
        }
        set('pid', pid);
      }
    }

    if (!fields.length && body.tags === undefined) return { ok: true, message: '没有需要更新的内容' };
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE problems SET ${fields.join(', ')} WHERE id = ?`, [...values, problem.id]);
    }
    if (body.tags !== undefined) applyTags(problem.id, body.tags);
    audit(request, 'problem.update', { targetType: 'problem', targetId: problem.id, detail: Object.keys(body) });

    let requeued = 0;
    if (bool('rejudge_on_problem_update', false) && (fields.some((f) => f.startsWith('test') || f.startsWith('judge')))) {
      requeued = rejudge({ problemId: problem.id });
    }
    return { ok: true, requeued };
  });

  app.delete('/api/problems/:id', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    const hard = toBool((request.query as any)?.hard, false) && hasRole(user, 'superadmin');
    if (hard) {
      run('DELETE FROM problems WHERE id = ?', [problem.id]);
      run('DELETE FROM testcases WHERE problem_id = ?', [problem.id]);
      deleteProblemTestdata(problem.id);
    } else {
      run(`UPDATE problems SET deleted_at = datetime('now'), is_public = 0 WHERE id = ?`, [problem.id]);
    }
    audit(request, 'problem.delete', { targetType: 'problem', targetId: problem.id, detail: { hard } });
    return { ok: true };
  });

  /* ------------------------------------------------------------- testcases */
  app.get('/api/problems/:id/testcases', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    const rows = all<any>(
      `SELECT id, idx, subtask_id, score, is_sample, input_file, output_file
         FROM testcases WHERE problem_id = ? ORDER BY idx`,
      [problem.id],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        idx: row.idx,
        subtask: row.subtask_id,
        score: row.score,
        isSample: Boolean(row.is_sample),
        inputSize: fileSize(row.input_file),
        outputSize: fileSize(row.output_file),
      })),
    };
  });

  app.get('/api/problems/:id/testcases/:caseId', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    const row = get<any>('SELECT * FROM testcases WHERE id = ? AND problem_id = ?', [
      parseId((request.params as any).caseId),
      problem.id,
    ]);
    if (!row) throw notFound('测试点不存在');
    return {
      testcase: {
        id: row.id,
        idx: row.idx,
        subtask: row.subtask_id,
        score: row.score,
        isSample: Boolean(row.is_sample),
        input: readTestcaseFile(row.input_file),
        output: readTestcaseFile(row.output_file),
      },
    };
  });

  app.post('/api/problems/:id/testcases', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    const body = (request.body ?? {}) as any;
    const input = String(body.input ?? '');
    const output = String(body.output ?? '');
    if (!input && !output) throw badRequest('测试点内容不能为空');
    const existing = get<{ maxIdx: number | null }>(
      'SELECT MAX(idx) AS maxIdx FROM testcases WHERE problem_id = ?',
      [problem.id],
    );
    const idx = Number(body.idx) > 0 ? Number(body.idx) : (existing?.maxIdx ?? 0) + 1;
    if (get('SELECT id FROM testcases WHERE problem_id = ? AND idx = ?', [problem.id, idx])) {
      throw conflict(`测试点 ${idx} 已存在`);
    }
    const saved = saveTestcase(problem.id, idx, input, output);
    const info = run(
      `INSERT INTO testcases (problem_id, idx, subtask_id, score, input_file, output_file, is_sample)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        problem.id,
        idx,
        Number(body.subtask ?? 0) || 0,
        Math.max(0, Number(body.score ?? 10) || 10),
        saved.inputFile,
        saved.outputFile,
        body.isSample ? 1 : 0,
      ],
    );
    audit(request, 'testcase.create', { targetType: 'problem', targetId: problem.id, detail: { idx } });
    return { ok: true, id: Number(info.lastInsertRowid), idx };
  });

  app.put('/api/problems/:id/testcases/:caseId', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    const caseId = parseId((request.params as any).caseId);
    const row = get<any>('SELECT * FROM testcases WHERE id = ? AND problem_id = ?', [caseId, problem.id]);
    if (!row) throw notFound('测试点不存在');
    const body = (request.body ?? {}) as any;
    if (body.input !== undefined || body.output !== undefined) {
      const input = body.input !== undefined ? String(body.input) : readTestcaseFile(row.input_file);
      const output = body.output !== undefined ? String(body.output) : readTestcaseFile(row.output_file);
      const saved = saveTestcase(problem.id, row.idx, input, output);
      run('UPDATE testcases SET input_file = ?, output_file = ? WHERE id = ?', [
        saved.inputFile,
        saved.outputFile,
        caseId,
      ]);
    }
    if (body.subtask !== undefined) {
      run('UPDATE testcases SET subtask_id = ? WHERE id = ?', [Number(body.subtask) || 0, caseId]);
    }
    if (body.score !== undefined) run('UPDATE testcases SET score = ? WHERE id = ?', [Number(body.score) || 0, caseId]);
    if (body.isSample !== undefined) {
      run('UPDATE testcases SET is_sample = ? WHERE id = ?', [body.isSample ? 1 : 0, caseId]);
    }
    audit(request, 'testcase.update', { targetType: 'problem', targetId: problem.id, detail: { caseId } });
    return { ok: true };
  });

  app.delete('/api/problems/:id/testcases/:caseId', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    const caseId = parseId((request.params as any).caseId);
    const row = get<any>('SELECT * FROM testcases WHERE id = ? AND problem_id = ?', [caseId, problem.id]);
    if (!row) throw notFound('测试点不存在');
    deleteTestcaseFiles(problem.id, row.idx);
    run('DELETE FROM testcases WHERE id = ?', [caseId]);
    audit(request, 'testcase.delete', { targetType: 'problem', targetId: problem.id, detail: { caseId } });
    return { ok: true };
  });

  app.post('/api/problems/:id/testcases/zip', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    assertProblemAccess(problem, user);
    if (!bool('allow_zip_testdata', true)) throw forbidden('本站已关闭 ZIP 导入');
    const file = await (request as any).file({
      limits: { fileSize: num('max_upload_size_mb', 64) * 1024 * 1024 },
    });
    if (!file) throw badRequest('请上传 ZIP 文件');
    const buffer = await file.toBuffer();
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw badRequest('无法解析 ZIP 文件');
    }
    const entries = zip.getEntries().filter((entry: any) => !entry.isDirectory);
    const inputs = new Map<string, Buffer>();
    const outputs = new Map<string, Buffer>();
    for (const entry of entries) {
      const name = path.basename(entry.entryName);
      const match = name.match(/^(.*)\.(in|out|ans)$/i);
      if (!match) continue;
      const key = (match[1] ?? '').trim();
      const ext = (match[2] ?? '').toLowerCase();
      if (ext === 'in') inputs.set(key, entry.getData());
      else outputs.set(key, entry.getData());
    }
    const keys = [...inputs.keys()].filter((key) => outputs.has(key)).sort(naturalCompare);
    if (!keys.length) throw badRequest('ZIP 中没有找到成对的 .in/.out 文件');

    const replace = (request.query as any)?.replace === 'true';
    let idx = 0;
    const imported: number[] = [];
    tx(() => {
      if (replace) {
        const old = all<any>('SELECT * FROM testcases WHERE problem_id = ?', [problem.id]);
        for (const row of old) deleteTestcaseFiles(problem.id, row.idx);
        run('DELETE FROM testcases WHERE problem_id = ?', [problem.id]);
      } else {
        idx = Number(get<{ maxIdx: number | null }>(
          'SELECT MAX(idx) AS maxIdx FROM testcases WHERE problem_id = ?',
          [problem.id],
        )?.maxIdx ?? 0);
      }
      const subtask = Number((request.query as any)?.subtask ?? 0) || 0;
      const score = Math.max(0, Number((request.query as any)?.score ?? 10) || 10);
      for (const key of keys) {
        idx += 1;
        const input = inputs.get(key)!.toString('utf8');
        const output = outputs.get(key)!.toString('utf8');
        const saved = saveTestcase(problem.id, idx, input, output);
        run(
          `INSERT INTO testcases (problem_id, idx, subtask_id, score, input_file, output_file, is_sample)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [problem.id, idx, subtask, score, saved.inputFile, saved.outputFile],
        );
        imported.push(idx);
      }
    });
    audit(request, 'testcase.import_zip', {
      targetType: 'problem',
      targetId: problem.id,
      detail: { count: imported.length, replace },
    });
    return { ok: true, imported: imported.length, indexes: imported };
  });

  app.get('/api/problems/:id/testdata.zip', async (request, reply) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    if (!hasRole(user, 'admin') && !bool('allow_download_testdata', false)) {
      throw forbidden('本站未开放测试数据下载');
    }
    const rows = all<any>('SELECT * FROM testcases WHERE problem_id = ? ORDER BY idx', [problem.id]);
    const zip = new AdmZip();
    for (const row of rows) {
      const dir = problemTestdataDir(problem.id);
      const inFile = path.join(dir, path.basename(row.input_file));
      const outFile = path.join(dir, path.basename(row.output_file));
      if (fs.existsSync(inFile)) zip.addLocalFile(inFile, '', `${row.idx}.in`);
      if (fs.existsSync(outFile)) zip.addLocalFile(outFile, '', `${row.idx}.out`);
    }
    audit(request, 'problem.download_testdata', { targetType: 'problem', targetId: problem.id });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${problem.pid}-testdata.zip"`);
    return reply.send(zip.toBuffer());
  });

  /* ------------------------------------------------------------------ misc */
  /**
   * 当前用户在这道题上最后一次提交的代码（用于进入题目时自动回填编辑器）。
   * 只返回自己的提交，因此不受「比赛期间隐藏代码」「关闭他人代码可见性」影响。
   */
  app.get('/api/problems/:id/last-code', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    const submission = get<any>(
      `SELECT id, language, code, status, score, created_at
         FROM submissions
        WHERE problem_id = ? AND user_id = ?
        ORDER BY id DESC LIMIT 1`,
      [problem.id, user.id],
    );
    if (!submission) return { submission: null };
    return {
      submission: {
        id: submission.id,
        language: submission.language,
        code: submission.code,
        status: submission.status,
        score: submission.score,
        createdAt: submission.created_at,
      },
    };
  });

  app.post('/api/problems/:id/favorite', async (request) => {
    const user = requireUser(request);
    const problem = findProblem(String((request.params as any).id));
    const existing = get('SELECT 1 AS x FROM problem_favorites WHERE user_id = ? AND problem_id = ?', [
      user.id,
      problem.id,
    ]);
    if (existing) {
      run('DELETE FROM problem_favorites WHERE user_id = ? AND problem_id = ?', [user.id, problem.id]);
      run('UPDATE problems SET favorite_count = MAX(0, favorite_count - 1) WHERE id = ?', [problem.id]);
      return { ok: true, favorite: false };
    }
    run('INSERT INTO problem_favorites (user_id, problem_id) VALUES (?, ?)', [user.id, problem.id]);
    run('UPDATE problems SET favorite_count = favorite_count + 1 WHERE id = ?', [problem.id]);
    return { ok: true, favorite: true };
  });

  app.post('/api/problems/:id/vote', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_difficulty_vote', true)) throw forbidden('本站已关闭难度投票');
    const problem = findProblem(String((request.params as any).id));
    const score = Math.min(7, Math.max(1, Number((request.body as any)?.score) || 0));
    if (!score) throw badRequest('请选择难度');
    run(
      `INSERT INTO problem_votes (problem_id, user_id, score) VALUES (?, ?, ?)
       ON CONFLICT(problem_id, user_id) DO UPDATE SET score = excluded.score`,
      [problem.id, user.id, score],
    );
    const result = get<{ avg: number | null; count: number }>(
      'SELECT AVG(score) AS avg, COUNT(*) AS count FROM problem_votes WHERE problem_id = ?',
      [problem.id],
    );
    return { ok: true, average: result?.avg, count: result?.count ?? 0 };
  });

  app.get('/api/problems/:id/statistics', async (request) => {
    const problem = findProblem(String((request.params as any).id));
    const statuses = all<any>(
      'SELECT status, COUNT(*) AS c FROM submissions WHERE problem_id = ? GROUP BY status ORDER BY c DESC',
      [problem.id],
    );
    const languages = all<any>(
      'SELECT language, COUNT(*) AS c FROM submissions WHERE problem_id = ? GROUP BY language ORDER BY c DESC',
      [problem.id],
    );
    const hardest = all<any>(
      `SELECT s.id, s.status, s.time_ms, s.memory_kb, u.username FROM submissions s
         JOIN users u ON u.id = s.user_id
        WHERE s.problem_id = ? AND s.status <> 'AC' ORDER BY s.time_ms DESC LIMIT 5`,
      [problem.id],
    );
    return { statuses, languages, hardest, tags: tagRows([problem.id]).get(problem.id) ?? [] };
  });

  app.get('/api/problems/:id/submissions', async (request) => {
    const problem = findProblem(String((request.params as any).id));
    const query = request.query as any;
    const page = parsePage(query, num('submission_page_size', 50));
    const conditions = ['s.problem_id = ?'];
    const params: unknown[] = [problem.id];
    if (query.mine === 'true' && request.user) {
      conditions.push('s.user_id = ?');
      params.push(request.user.id);
    } else if (query.user) {
      conditions.push('u.username = ?');
      params.push(String(query.user));
    }
    if (query.status) {
      conditions.push('s.status = ?');
      params.push(String(query.status));
    }
    if (query.language) {
      conditions.push('s.language = ?');
      params.push(String(query.language));
    }
    const rows = all<any>(
      `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.score, s.time_ms, s.memory_kb,
              s.code_length, s.contest_id, s.created_at, p.pid, p.title AS problem_title,
              u.username, u.display_name, u.avatar
         FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM submissions s JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return { items: rows.map(submissionSummary), total, page: page.page, size: page.size };
  });

  /* -------------------------------------------------------------- spj info */
  app.get('/api/problems/spj/languages', async () => ({ languages: SPJ_LANGUAGES }));

  /* ------------------------------------------------------------------ tags */
  app.get('/api/tags', async () => {
    return {
      tags: all<any>(
        `SELECT t.*, (SELECT COUNT(*) FROM problem_tags pt
                        JOIN problems p ON p.id = pt.problem_id AND p.is_public = 1 AND p.deleted_at IS NULL
                       WHERE pt.tag_id = t.id) AS problem_count
           FROM tags t ORDER BY t.sort ASC, t.id ASC`,
      ),
    };
  });

  app.post('/api/tags', async (request) => {
    const user = requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const name = String(body.name ?? '').trim();
    if (!name) throw badRequest('标签名称不能为空');
    if (get('SELECT id FROM tags WHERE name = ?', [name])) throw conflict('标签已存在');
    const info = run('INSERT INTO tags (name, color, category, sort) VALUES (?, ?, ?, ?)', [
      name,
      String(body.color ?? '#60a5fa'),
      String(body.category ?? '算法'),
      Number(body.sort ?? 0) || 0,
    ]);
    audit(request, 'tag.create', { targetType: 'tag', targetId: Number(info.lastInsertRowid), detail: { name } });
    void user;
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.put('/api/tags/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(String(body.name).trim());
    }
    if (body.color !== undefined) {
      fields.push('color = ?');
      values.push(String(body.color));
    }
    if (body.category !== undefined) {
      fields.push('category = ?');
      values.push(String(body.category));
    }
    if (body.sort !== undefined) {
      fields.push('sort = ?');
      values.push(Number(body.sort) || 0);
    }
    if (fields.length) run(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    audit(request, 'tag.update', { targetType: 'tag', targetId: id });
    return { ok: true };
  });

  app.delete('/api/tags/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    run('DELETE FROM tags WHERE id = ?', [id]);
    audit(request, 'tag.delete', { targetType: 'tag', targetId: id });
    return { ok: true };
  });

  /* ------------------------------------------------------------ favourites */
  app.get('/api/favorites', async (request) => {
    const user = requireUser(request);
    const rows = all<any>(
      `SELECT p.*, u.username AS author_name, u.display_name AS author_display, f.created_at AS favorited_at
         FROM problem_favorites f JOIN problems p ON p.id = f.problem_id
         LEFT JOIN users u ON u.id = p.author_id
        WHERE f.user_id = ? AND p.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 200`,
      [user.id],
    );
    const tagMap = tagRows(rows.map((r) => r.id));
    return { items: rows.map((row) => ({ ...problemSummary(row, { tags: tagMap.get(row.id) ?? [] }), favoritedAt: row.favorited_at })) };
  });

  /* ----------------------------------------------------------- 题解 by pid */
  app.get('/api/problems/:id/solutions', async (request) => {
    const problem = findProblem(String((request.params as any).id));
    if (!bool('enable_solution', true)) return { items: [] };
    const query = request.query as any;
    const page = parsePage(query, 20);
    const viewer = request.user;
    const solved = viewer
      ? Boolean(
          get('SELECT 1 AS x FROM user_problem_stats WHERE user_id = ? AND problem_id = ? AND accepted > 0', [
            viewer.id,
            problem.id,
          ]),
        )
      : false;
    if (!solved && !bool('enable_problem_solution_visible', true) && !hasRole(viewer, 'admin')) {
      return { items: [], locked: true, message: '通过本题后才能查看题解' };
    }
    const rows = all<any>(
      `SELECT s.id, s.title, s.author_id, s.upvotes, s.downvotes, s.views, s.created_at, s.is_public,
              u.username, u.display_name, u.avatar,
              (SELECT value FROM solution_votes v WHERE v.solution_id = s.id AND v.user_id = ?) AS my_vote
         FROM solutions s JOIN users u ON u.id = s.author_id
        WHERE s.problem_id = ? AND s.is_deleted = 0 AND (s.is_public = 1 OR s.author_id = ?)
        ORDER BY s.upvotes DESC, s.id DESC LIMIT ? OFFSET ?`,
      [viewer?.id ?? 0, problem.id, viewer?.id ?? 0, page.size, page.offset],
    );
    return {
      items: rows.map((row) => ({ ...row, solved, myVote: row.my_vote ?? 0 })),
      page: page.page,
      size: page.size,
    };
  });
}

function applyTags(problemId: number, tags: unknown): void {
  if (!Array.isArray(tags)) return;
  const ids: number[] = [];
  for (const tag of tags) {
    if (typeof tag === 'number') {
      ids.push(tag);
    } else if (typeof tag === 'string' && tag.trim()) {
      const name = tag.trim().slice(0, 32);
      const existing = get<{ id: number }>('SELECT id FROM tags WHERE name = ?', [name]);
      if (existing) ids.push(existing.id);
      else ids.push(Number(run('INSERT INTO tags (name) VALUES (?)', [name]).lastInsertRowid));
    }
  }
  run('DELETE FROM problem_tags WHERE problem_id = ?', [problemId]);
  const stmt = 'INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)';
  for (const id of ids) run(stmt, [problemId, id]);
}

function fileSize(relative: string): number {
  try {
    const full = path.isAbsolute(relative) ? relative : path.join(config.paths.testdata, relative);
    return fs.statSync(full).size;
  } catch {
    return 0;
  }
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
