import type { FastifyInstance } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { hasRole, requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, num, str } from '../settings/index.js';
import { parsePage, sqlLike } from '../lib/util.js';
import { addPoints } from '../lib/points.js';
import { sendMessage } from '../lib/notify.js';
import { problemSummary, tagRows } from './helpers.js';
import { contestStatus } from './public.js';

function findContest(idLike: string): any {
  const id = Number(idLike);
  const row = Number.isInteger(id) ? get<any>('SELECT * FROM contests WHERE id = ?', [id]) : undefined;
  if (!row || row.deleted_at) throw notFound('比赛不存在');
  return row;
}

function assertContestAccess(contest: any, user: any): void {
  if (hasRole(user, 'admin')) return;
  if (user && contest.owner_id === user.id) return;
  throw forbidden('只有比赛创建者或管理员可以修改比赛');
}

function minutesBetween(start: string, end: string): number {
  const a = new Date(`${start.replace(' ', 'T')}Z`).getTime();
  const b = new Date(`${end.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

export async function registerContestRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------------- list */
  app.get('/api/contests', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, num('contest_list_page_size', 20));
    const conditions: string[] = [];
    const params: unknown[] = [];
    const viewer = request.user;

    if (query.mine === 'true') {
      const user = requireUser(request);
      conditions.push('(c.owner_id = ? OR EXISTS (SELECT 1 FROM contest_registrations r WHERE r.contest_id = c.id AND r.user_id = ?))');
      params.push(user.id, user.id);
      conditions.push('c.deleted_at IS NULL');
    } else if (hasRole(viewer, 'admin') && query.all === 'true') {
      conditions.push('c.deleted_at IS NULL');
      if (query.review) {
        conditions.push('c.review_status = ?');
        params.push(String(query.review));
      }
    } else {
      conditions.push(`c.is_public = 1 AND c.review_status = 'approved' AND c.deleted_at IS NULL`);
    }

    if (query.status === 'upcoming') conditions.push(`c.start_time > datetime('now')`);
    if (query.status === 'running') {
      conditions.push(`c.start_time <= datetime('now') AND c.end_time >= datetime('now')`);
    }
    if (query.status === 'ended') conditions.push(`c.end_time < datetime('now')`);
    if (query.rules && ['acm', 'oi', 'ioi'].includes(query.rules)) {
      conditions.push('c.rules = ?');
      params.push(String(query.rules));
    }
    if (query.origin) {
      conditions.push('c.origin = ?');
      params.push(String(query.origin));
    }
    if (query.q) {
      conditions.push('(c.title LIKE ? ESCAPE \'\\\' OR c.subtitle LIKE ? ESCAPE \'\\\')');
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order =
      query.sort === 'start_asc' ? 'c.start_time ASC' : query.sort === 'oldest' ? 'c.id ASC' : 'c.start_time DESC';

    const rows = all<any>(
      `SELECT c.*, u.username AS owner_name,
              (SELECT COUNT(*) FROM contest_registrations r WHERE r.contest_id = c.id) AS participant_count,
              (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problem_count
         FROM contests c LEFT JOIN users u ON u.id = c.owner_id
         ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM contests c ${where}`, params);
    return {
      items: rows.map((row) => ({
        ...row,
        status: contestStatus(row.start_time, row.end_time),
        durationMinutes: minutesBetween(row.start_time, row.end_time),
        hasPassword: Boolean(row.password),
        password: undefined,
      })),
      total,
      page: page.page,
      size: page.size,
    };
  });

  /* ----------------------------------------------------------------- detail */
  app.get('/api/contests/:id', async (request) => {
    const contest = findContest(String((request.params as any).id));
    const viewer = request.user;
    const isAdmin = hasRole(viewer, 'admin');
    const isOwner = Boolean(viewer && contest.owner_id === viewer.id);
    if ((!contest.is_public || contest.review_status !== 'approved') && !isAdmin && !isOwner) {
      throw notFound('比赛不存在或尚未公开');
    }
    const status = contestStatus(contest.start_time, contest.end_time);
    const registration = viewer
      ? get<any>('SELECT * FROM contest_registrations WHERE contest_id = ? AND user_id = ?', [
          contest.id,
          viewer.id,
        ])
      : null;

    const problems = all<any>(
      `SELECT p.*, cp.order_no, cp.label, cp.score AS contest_score,
              u.username AS author_name, u.display_name AS author_display
         FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
         LEFT JOIN users u ON u.id = p.author_id
        WHERE cp.contest_id = ? ORDER BY cp.order_no ASC`,
      [contest.id],
    );
    const started = status !== 'upcoming';
    const canSeeProblems = started || isAdmin || isOwner;
    const tagMap = tagRows(problems.map((p) => p.id));
    const solvedMap = new Map<number, { accepted: number; attempts: number }>();
    if (viewer) {
      for (const problem of problems) {
        const stat = get<any>(
          'SELECT accepted, attempts FROM user_problem_stats WHERE user_id = ? AND problem_id = ?',
          [viewer.id, problem.id],
        );
        solvedMap.set(problem.id, { accepted: stat?.accepted ?? 0, attempts: stat?.attempts ?? 0 });
      }
    }

    return {
      contest: {
        id: contest.id,
        title: contest.title,
        subtitle: contest.subtitle,
        description: contest.description,
        rules: contest.rules,
        startTime: contest.start_time,
        endTime: contest.end_time,
        freezeMinutes: contest.freeze_minutes,
        needRegister: Boolean(contest.need_register),
        hasPassword: Boolean(contest.password),
        showRank: Boolean(contest.show_rank),
        rated: Boolean(contest.rated),
        allowLanguages: JSON.parse(contest.allow_languages || '[]'),
        origin: contest.origin,
        reviewStatus: contest.review_status,
        status,
        durationMinutes: minutesBetween(contest.start_time, contest.end_time),
        owner: contest.owner_id,
        participantCount: count('SELECT COUNT(*) AS c FROM contest_registrations WHERE contest_id = ?', [
          contest.id,
        ]),
      },
      registered: Boolean(registration),
      problems: canSeeProblems
        ? problems.map((row) => ({
            ...problemSummary(row, { tags: tagMap.get(row.id) ?? [] }),
            label: row.label,
            order: row.order_no,
            contestScore: row.contest_score,
            myStats: solvedMap.get(row.id) ?? { accepted: 0, attempts: 0 },
          }))
        : [],
      problemsHidden: !canSeeProblems,
      canEdit: isAdmin || isOwner,
    };
  });

  /* ----------------------------------------------------------------- create */
  app.post('/api/contests', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as any;
    const isAdmin = hasRole(user, 'admin');
    if (!isAdmin) {
      if (!bool('allow_user_contest', true)) throw forbidden('本站未开放用户创建比赛');
      const grant = get<any>(
        `SELECT * FROM grants WHERE user_id = ? AND kind = 'contest' AND used < total
           AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY id ASC LIMIT 1`,
        [user.id],
      );
      if (!grant) throw forbidden('你需要先在商店兑换「创建一次比赛」资格');
      tx(() => run('UPDATE grants SET used = used + 1 WHERE id = ?', [grant.id]));
    }

    const title = String(body.title ?? '').trim();
    if (title.length < 2) throw badRequest('比赛名称至少 2 个字符');
    const startTime = normalizeTime(body.startTime);
    const endTime = normalizeTime(body.endTime);
    if (!startTime || !endTime) throw badRequest('请填写正确的开始与结束时间');
    if (new Date(endTime.replace(' ', 'T') + 'Z').getTime() <= new Date(startTime.replace(' ', 'T') + 'Z').getTime()) {
      throw badRequest('结束时间必须晚于开始时间');
    }
    if (!isAdmin) {
      const maxDays = num('user_contest_max_days', 7);
      if (minutesBetween(startTime, endTime) > maxDays * 1440) {
        throw badRequest(`用户自建比赛最长 ${maxDays} 天`);
      }
    }

    const rules = ['acm', 'oi', 'ioi'].includes(body.rules)
      ? body.rules
      : str('default_contest_rules', 'acm');
    const needReview = !isAdmin && bool('user_contest_need_review', true);
    const info = run(
      `INSERT INTO contests
        (title, subtitle, description, rules, start_time, end_time, freeze_minutes, is_public, need_register,
         password, show_rank, rated, allow_languages, origin, owner_id, author_id, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        String(body.subtitle ?? ''),
        String(body.description ?? ''),
        rules,
        startTime,
        endTime,
        Math.max(0, Number(body.freezeMinutes ?? num('contest_freeze_default', 0)) || 0),
        isAdmin ? (body.isPublic === false ? 0 : 1) : needReview ? 0 : 1,
        body.needRegister === undefined ? (bool('contest_need_register_default', true) ? 1 : 0) : body.needRegister ? 1 : 0,
        String(body.password ?? ''),
        body.showRank === undefined ? (bool('contest_show_rank_default', true) ? 1 : 0) : body.showRank ? 1 : 0,
        body.rated === false ? 0 : 1,
        JSON.stringify(Array.isArray(body.allowLanguages) ? body.allowLanguages : []),
        isAdmin ? 'official' : 'user',
        user.id,
        user.id,
        needReview ? 'pending' : 'approved',
      ],
    );
    const contestId = Number(info.lastInsertRowid);
    if (Array.isArray(body.problemIds) && body.problemIds.length) {
      attachProblems(contestId, body.problemIds);
    }
    if (needReview) {
      sendMessage({
        to: user.id,
        title: '比赛已提交审核',
        content: `你的比赛「${title}」已提交，等待管理员审核。`,
        type: 'system',
        refType: 'contest',
        refId: contestId,
      });
    }
    audit(request, 'contest.create', { targetType: 'contest', targetId: contestId, detail: { title } });
    return { ok: true, id: contestId, reviewStatus: needReview ? 'pending' : 'approved' };
  });

  /* ----------------------------------------------------------------- update */
  app.put('/api/contests/:id', async (request) => {
    const user = requireUser(request);
    const contest = findContest(String((request.params as any).id));
    assertContestAccess(contest, user);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      values.push(value);
    };
    if (body.title !== undefined) set('title', String(body.title).trim().slice(0, 120));
    if (body.subtitle !== undefined) set('subtitle', String(body.subtitle));
    if (body.description !== undefined) set('description', String(body.description));
    if (body.rules !== undefined && ['acm', 'oi', 'ioi'].includes(body.rules)) set('rules', body.rules);
    if (body.startTime !== undefined) {
      const value = normalizeTime(body.startTime);
      if (!value) throw badRequest('开始时间格式不正确');
      set('start_time', value);
    }
    if (body.endTime !== undefined) {
      const value = normalizeTime(body.endTime);
      if (!value) throw badRequest('结束时间格式不正确');
      set('end_time', value);
    }
    if (body.freezeMinutes !== undefined) set('freeze_minutes', Math.max(0, Number(body.freezeMinutes) || 0));
    if (body.needRegister !== undefined) set('need_register', body.needRegister ? 1 : 0);
    if (body.password !== undefined) set('password', String(body.password ?? ''));
    if (body.showRank !== undefined) set('show_rank', body.showRank ? 1 : 0);
    if (body.rated !== undefined) set('rated', body.rated ? 1 : 0);
    if (body.allowLanguages !== undefined) {
      set('allow_languages', JSON.stringify(Array.isArray(body.allowLanguages) ? body.allowLanguages : []));
    }
    if (hasRole(user, 'admin')) {
      if (body.isPublic !== undefined) set('is_public', body.isPublic ? 1 : 0);
      if (body.reviewStatus !== undefined) set('review_status', String(body.reviewStatus));
      if (body.reviewNote !== undefined) set('review_note', String(body.reviewNote));
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE contests SET ${fields.join(', ')} WHERE id = ?`, [...values, contest.id]);
    }
    if (Array.isArray(body.problemIds)) attachProblems(contest.id, body.problemIds);
    audit(request, 'contest.update', { targetType: 'contest', targetId: contest.id, detail: Object.keys(body) });
    return { ok: true };
  });

  app.delete('/api/contests/:id', async (request) => {
    const user = requireUser(request);
    const contest = findContest(String((request.params as any).id));
    assertContestAccess(contest, user);
    const hard = (request.query as any)?.hard === 'true' && hasRole(user, 'superadmin');
    if (hard) {
      run('DELETE FROM contests WHERE id = ?', [contest.id]);
      run('DELETE FROM contest_problems WHERE contest_id = ?', [contest.id]);
      run('DELETE FROM contest_registrations WHERE contest_id = ?', [contest.id]);
    } else {
      run(`UPDATE contests SET deleted_at = datetime('now'), is_public = 0 WHERE id = ?`, [contest.id]);
    }
    audit(request, 'contest.delete', { targetType: 'contest', targetId: contest.id, detail: { hard } });
    return { ok: true };
  });

  /* ------------------------------------------------------------- register */
  app.post('/api/contests/:id/register', async (request) => {
    const user = requireUser(request);
    const contest = findContest(String((request.params as any).id));
    const status = contestStatus(contest.start_time, contest.end_time);
    if (status === 'ended') throw forbidden('比赛已经结束');
    if (contest.password) {
      const password = String((request.body as any)?.password ?? '');
      if (password !== contest.password) throw forbidden('比赛密码不正确');
    }
    const existing = get('SELECT 1 AS x FROM contest_registrations WHERE contest_id = ? AND user_id = ?', [
      contest.id,
      user.id,
    ]);
    if (existing) return { ok: true, registered: true, message: '你已经报名了本场比赛' };
    run('INSERT INTO contest_registrations (contest_id, user_id) VALUES (?, ?)', [contest.id, user.id]);
    run('UPDATE users SET contest_count = contest_count + 1 WHERE id = ?', [user.id]);
    audit(request, 'contest.register', { targetType: 'contest', targetId: contest.id });
    return { ok: true, registered: true };
  });

  app.post('/api/contests/:id/unregister', async (request) => {
    const user = requireUser(request);
    const contest = findContest(String((request.params as any).id));
    if (contestStatus(contest.start_time, contest.end_time) !== 'upcoming') {
      throw forbidden('比赛已经开始，无法取消报名');
    }
    run('DELETE FROM contest_registrations WHERE contest_id = ? AND user_id = ?', [contest.id, user.id]);
    return { ok: true, registered: false };
  });

  app.get('/api/contests/:id/registrations', async (request) => {
    const contest = findContest(String((request.params as any).id));
    const rows = all<any>(
      `SELECT r.registered_at, r.is_rated, u.id, u.username, u.display_name, u.avatar, u.solved_count
         FROM contest_registrations r JOIN users u ON u.id = r.user_id
        WHERE r.contest_id = ? ORDER BY r.registered_at ASC LIMIT 2000`,
      [contest.id],
    );
    return { items: rows };
  });

  /* ---------------------------------------------------------------- ranklist */
  app.get('/api/contests/:id/ranklist', async (request) => {
    const contest = findContest(String((request.params as any).id));
    return computeRanklist(contest, request.user);
  });

  /* -------------------------------------------------------- finalize & points */
  app.post('/api/contests/:id/finalize', async (request) => {
    requireAdmin(request);
    const contest = findContest(String((request.params as any).id));
    if (contestStatus(contest.start_time, contest.end_time) !== 'ended') {
      throw badRequest('比赛尚未结束');
    }
    const data = computeRanklist(contest, request.user, true);
    const ranklist: any[] = data.ranklist;
    const first = num('points_contest_rank1', 20);
    const top10 = num('points_contest_top10', 5);
    let awarded = 0;
    tx(() => {
      ranklist.forEach((row: any, index: number) => {
        let points = 0;
        if (index === 0) points = first;
        else if (index < 10) points = top10;
        if (points > 0) {
          addPoints(row.user.id, points, `比赛「${contest.title}」第 ${index + 1} 名`, {
            refType: 'contest',
            refId: contest.id,
          });
          awarded += 1;
        }
      });
      run('UPDATE contests SET review_note = ? WHERE id = ?', ['finalized', contest.id]);
    });
    audit(request, 'contest.finalize', { targetType: 'contest', targetId: contest.id, detail: { awarded } });
    return { ok: true, awarded };
  });

  app.get('/api/contests/:id/submissions', async (request) => {
    const contest = findContest(String((request.params as any).id));
    const query = request.query as any;
    const page = parsePage(query, num('submission_page_size', 50));
    const status = contestStatus(contest.start_time, contest.end_time);
    const viewer = request.user;
    const isAdmin = hasRole(viewer, 'admin');
    const conditions = ['s.contest_id = ?'];
    const params: unknown[] = [contest.id];
    if (!isAdmin && status === 'running') {
      conditions.push('s.user_id = ?');
      params.push(viewer?.id ?? -1);
    }
    if (query.user) {
      conditions.push('u.username = ?');
      params.push(String(query.user));
    }
    const rows = all<any>(
      `SELECT s.id, s.problem_id, s.status, s.score, s.time_ms, s.memory_kb, s.language, s.created_at,
              p.pid, p.title AS problem_title, u.id AS user_id, u.username, u.display_name, u.avatar
         FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return { items: rows, page: page.page, size: page.size };
  });
}

export interface RanklistCell {
  problemId: number;
  label: string;
  accepted: boolean;
  attempts: number;
  score: number;
  firstBlood: boolean;
  acceptedAt: string | null;
}

/** Compute the ACM / OI / IOI ranklist of a contest (with freeze support). */
export function computeRanklist(
  contest: any,
  viewer: { id: number; role: string } | null,
  forceFull = false,
): {
  contest: any;
  problems: any[];
  ranklist: any[];
  totalRanked: number;
  collapsed: boolean;
  message?: string;
} {
  const status = contestStatus(contest.start_time, contest.end_time);
  const isAdmin = forceFull || (viewer ? hasRole(viewer as any, 'admin') : false);
  const problems = all<any>(
    'SELECT problem_id, order_no, label, score FROM contest_problems WHERE contest_id = ? ORDER BY order_no',
    [contest.id],
  );
  const submissions = all<any>(
    `SELECT id, user_id, problem_id, status, score, time_ms, created_at FROM submissions
      WHERE contest_id = ? ORDER BY id ASC`,
    [contest.id],
  );

  // 封榜：比赛结束前 freeze_minutes 分钟内的提交对普通用户隐藏，比赛结束自动解封
  const freezeMinutes = contest.freeze_minutes ?? 0;
  let freezeAt: number | null = null;
  if (freezeMinutes > 0 && status === 'running') {
    const endAt = new Date(`${contest.end_time.replace(' ', 'T')}Z`).getTime();
    freezeAt = endAt - freezeMinutes * 60000;
  }
  const visibleSubmissions =
    freezeAt && !isAdmin
      ? submissions.filter(
          (s) => new Date(`${s.created_at.replace(' ', 'T')}Z`).getTime() <= freezeAt!,
        )
      : submissions;

  const participants = all<any>(
    `SELECT u.id, u.username, u.display_name, u.avatar, r.registered_at, r.is_rated
       FROM contest_registrations r JOIN users u ON u.id = r.user_id WHERE r.contest_id = ?`,
    [contest.id],
  );
  const participantIds = new Set<number>(participants.map((p) => p.id));
  for (const submission of visibleSubmissions) participantIds.add(submission.user_id);
  const ids = [...participantIds];
  const users = ids.length
    ? all<any>(
        `SELECT id, username, display_name, avatar FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  interface Cell {
    attempts: number;
    accepted: boolean;
    acceptedAt: string | null;
    score: number;
    firstBlood: boolean;
  }
  const rows = new Map<number, { user: any; cells: Map<number, Cell>; solved: number; penalty: number }>();
  for (const userId of participantIds) {
    rows.set(userId, {
      user: userMap.get(userId) ?? { id: userId, username: '未知用户', display_name: null, avatar: null },
      cells: new Map(),
      solved: 0,
      penalty: 0,
    });
  }

  const firstBlood = new Map<number, number>();
  for (const submission of visibleSubmissions) {
    if (submission.status !== 'AC') continue;
    if (!firstBlood.has(submission.problem_id)) firstBlood.set(submission.problem_id, submission.user_id);
  }

  for (const submission of visibleSubmissions) {
    const row = rows.get(submission.user_id);
    if (!row) continue;
    const cell: Cell =
      row.cells.get(submission.problem_id) ??
      ({ attempts: 0, accepted: false, acceptedAt: null, score: 0, firstBlood: false } as Cell);
    if (submission.status === 'AC') {
      if (!cell.accepted) {
        cell.accepted = true;
        cell.acceptedAt = submission.created_at;
        cell.firstBlood = firstBlood.get(submission.problem_id) === submission.user_id;
        row.solved += 1;
        row.penalty += minutesBetween(contest.start_time, submission.created_at) + cell.attempts * 20;
      }
    } else {
      cell.attempts += 1;
    }
    cell.score = Math.max(cell.score, submission.score ?? 0);
    row.cells.set(submission.problem_id, cell);
  }

  const ranklist = [...rows.values()].map((row) => {
    const score =
      contest.rules === 'acm'
        ? row.solved * 100
        : problems.reduce((acc, problem) => acc + (row.cells.get(problem.problem_id)?.score ?? 0), 0);
    return {
      user: row.user,
      solved: row.solved,
      score,
      penalty: row.penalty,
      cells: problems.map((problem) => {
        const cell = row.cells.get(problem.problem_id);
        return {
          problemId: problem.problem_id,
          label: problem.label,
          accepted: cell?.accepted ?? false,
          attempts: cell?.attempts ?? 0,
          score: cell?.score ?? 0,
          firstBlood: cell?.firstBlood ?? false,
          acceptedAt: cell?.acceptedAt ?? null,
        };
      }),
    };
  });

  ranklist.sort((a, b) => {
    if (contest.rules === 'acm') {
      if (b.solved !== a.solved) return b.solved - a.solved;
      return a.penalty - b.penalty;
    }
    if (b.score !== a.score) return b.score - a.score;
    return a.penalty - b.penalty;
  });
  ranklist.forEach((row, index) => Object.assign(row, { rank: index + 1 }));

  const hiddenForOi = contest.rules === 'oi' && status === 'running' && !isAdmin;
  const showOnlySelf =
    !forceFull && bool('contest_rank_show_self_only', false) && status === 'running' && !isAdmin;
  const collapsed = hiddenForOi || !contest.show_rank || showOnlySelf;
  return {
    contest: {
      id: contest.id,
      title: contest.title,
      rules: contest.rules,
      status,
      startTime: contest.start_time,
      endTime: contest.end_time,
      freezeMinutes,
      frozen: Boolean(freezeAt) && !isAdmin,
    },
    problems: problems.map((p) => ({ id: p.problem_id, label: p.label, score: p.score })),
    ranklist:
      collapsed && !forceFull
        ? ranklist.filter((row) => row.user.id === viewer?.id)
        : ranklist,
    totalRanked: ranklist.length,
    collapsed: Boolean(collapsed && !forceFull),
    message: hiddenForOi
      ? 'OI 赛制进行中，仅显示你自己的成绩'
      : !contest.show_rank
        ? '本场比赛不公开排行榜'
        : showOnlySelf
          ? '比赛进行中，仅显示你自己的排名'
          : undefined,
  };
}

function normalizeTime(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return new Date(text).toISOString().replace('T', ' ').slice(0, 19);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return text.length === 16 ? `${text}:00` : text;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace('T', ' ').slice(0, 19);
}

export function attachProblems(contestId: number, problemIds: unknown[]): void {
  const ids = problemIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  tx(() => {
    const existing = all<any>(
      'SELECT problem_id, order_no, label, score FROM contest_problems WHERE contest_id = ?',
      [contestId],
    );
    const meta = new Map(existing.map((row) => [row.problem_id, row]));
    run('DELETE FROM contest_problems WHERE contest_id = ?', [contestId]);
    ids.forEach((problemId, index) => {
      const previous = meta.get(problemId);
      run(
        `INSERT INTO contest_problems (contest_id, problem_id, order_no, label, score) VALUES (?, ?, ?, ?, ?)`,
        [
          contestId,
          problemId,
          index + 1,
          previous?.label || String.fromCharCode(65 + (index % 26)),
          previous?.score ?? 100,
        ],
      );
    });
  });
}
