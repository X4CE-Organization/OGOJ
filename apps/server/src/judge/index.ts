import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { all, get, run, tx } from '../db/index.js';
import { addPoints } from '../lib/points.js';
import { sendMessage } from '../lib/notify.js';
import { evaluateAchievements } from '../lib/achievements.js';
import { bool, json as settingJson, num, str } from '../settings/index.js';
import { compareOutput, type CompareMode } from './compare.js';
import { compileSource, ensureDir, removeDir, runSandboxed } from './sandbox.js';
import { getLanguage, javaRunArgs } from './languages.js';

export type Verdict =
  | 'AC'
  | 'WA'
  | 'TLE'
  | 'MLE'
  | 'RE'
  | 'CE'
  | 'OLE'
  | 'PE'
  | 'SE'
  | 'UKOE'
  | 'Waiting'
  | 'Judging';

export interface CaseResult {
  idx: number;
  subtask: number;
  status: Verdict;
  timeMs: number;
  memoryKb: number;
  score: number;
  message?: string;
  input?: string;
  output?: string;
  answer?: string;
}

export interface SubtaskDef {
  id: number;
  score: number;
  cases?: number[];
  method?: 'min' | 'sum';
  deps?: number[];
}

interface ProblemRow {
  id: number;
  pid: string;
  title: string;
  time_limit: number;
  memory_limit: number;
  judge_mode: string;
  spj_language: string | null;
  spj_code: string | null;
  inter_code: string | null;
  subtasks: string;
  samples: string;
  compare_mode?: string;
}

export interface JudgeOutcome {
  status: Verdict;
  score: number;
  timeMs: number;
  memoryKb: number;
  detail: CaseResult[];
  compileOutput: string;
}

const PREVIEW_LIMIT = 500;

function preview(text: string | undefined): string {
  if (!text) return '';
  const clean = text.replace(/\r\n?/g, '\n');
  return clean.length > PREVIEW_LIMIT ? `${clean.slice(0, PREVIEW_LIMIT)}\n...[截断]` : clean;
}

function testcasePath(file: string): string {
  return path.isAbsolute(file) ? file : path.join(config.paths.testdata, file);
}

interface TestcaseRow {
  id: number;
  idx: number;
  subtask_id: number;
  score: number;
  input_file: string;
  output_file: string;
  is_sample: number;
}

function loadTestcases(problemId: number): TestcaseRow[] {
  return all<TestcaseRow>(
    'SELECT * FROM testcases WHERE problem_id = ? ORDER BY idx ASC',
    [problemId],
  ).filter(
    (row) => fs.existsSync(testcasePath(row.input_file)) && fs.existsSync(testcasePath(row.output_file)),
  );
}

function parseSubtasks(raw: string): SubtaskDef[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item: any) => ({
        id: Number(item.id ?? 0),
        score: Number(item.score ?? 0),
        cases: Array.isArray(item.cases) ? item.cases.map(Number) : undefined,
        method: item.method === 'sum' ? 'sum' : 'min',
        deps: Array.isArray(item.deps) ? item.deps.map(Number) : [],
      }));
  } catch {
    return [];
  }
}

function resolveCompareMode(problem: ProblemRow): CompareMode {
  const override = (problem.compare_mode ?? '').trim();
  if (override) return override as CompareMode;
  return (str('compare_mode', 'trim') || 'trim') as CompareMode;
}

interface RunSpec {
  cmd: string;
  args: string[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

function buildRunSpec(languageId: string, timeLimitMs: number, memoryLimitMb: number): RunSpec {
  const lang = getLanguage(languageId)!;
  const multiplier = Number(num('time_multiplier', 1)) || 1;
  const limit = Math.floor(timeLimitMs * lang.timeMultiplier * multiplier) + lang.startupGraceMs;
  const memory = memoryLimitMb + Math.ceil(lang.memoryOverheadKb / 1024);
  if (lang.id === 'java') {
    return { cmd: 'java', args: javaRunArgs(memory), timeLimitMs: limit, memoryLimitMb: memory };
  }
  const { cmd, args } = lang.run();
  return { cmd, args, timeLimitMs: limit, memoryLimitMb: memory };
}

/* -------------------------------------------------------------------------- */
/* Special judge                                                              */
/* -------------------------------------------------------------------------- */

async function compileChecker(
  sandboxDir: string,
  languageId: string,
  code: string,
): Promise<{ ok: boolean; cmd: string; args: string[]; output: string }> {
  const dir = ensureDir(path.join(sandboxDir, 'checker'));
  const lang = getLanguage(languageId) ?? getLanguage('cpp')!;
  const sourceName = lang.classStyle ? 'Main.java' : lang.sourceFile;
  fs.writeFileSync(path.join(dir, sourceName), code, 'utf8');

  if (lang.compile) {
    const { cmd, args } = lang.compile({ memMb: 512 });
    const result = await compileSource(cmd, args, dir, num('compile_timeout_ms', 15000));
    if (!result.ok) return { ok: false, cmd: '', args: [], output: result.output };
  }
  const runDef = lang.run();
  if (lang.id === 'java') {
    return { ok: true, cmd: 'java', args: ['-Xmx256m', '-cp', '.', 'Main'], output: '' };
  }
  if (lang.id === 'python3' || lang.id === 'pypy3' || lang.id === 'node') {
    return { ok: true, cmd: runDef.cmd, args: runDef.args, output: '' };
  }
  return {
    ok: true,
    cmd: path.join(dir, lang.artifact ?? 'main'),
    args: [],
    output: '',
  };
}

interface CheckerResult {
  accepted: boolean;
  score?: number;
  message?: string;
  systemError?: string;
}

async function runChecker(
  checker: { cmd: string; args: string[] },
  cwd: string,
  inputFile: string,
  outputFile: string,
  answerFile: string,
  timeLimitMs: number,
): Promise<CheckerResult> {
  const stdoutFile = path.join(cwd, 'checker.out');
  const stderrFile = path.join(cwd, 'checker.err');
  const result = await runSandboxed(
    checker.cmd,
    [...checker.args, inputFile, outputFile, answerFile],
    {
      timeLimitMs: Math.max(2000, timeLimitMs * 3),
      memoryLimitMb: 512,
      outputLimitKb: 64,
      cwd,
      stdoutFile,
      stderrFile,
    },
  );
  const stdout = fs.existsSync(stdoutFile) ? fs.readFileSync(stdoutFile, 'utf8') : '';
  const stderr = fs.existsSync(stderrFile) ? fs.readFileSync(stderrFile, 'utf8') : '';
  if (result.timedOut) return { accepted: false, systemError: 'Special Judge 运行超时' };
  if (result.exitCode === 0) {
    const match = stdout.match(/score\s*[:=]\s*(\d+)/i);
    return { accepted: true, score: match ? Number(match[1]) : undefined, message: stdout.trim() };
  }
  // Exit code 7 is the conventional "presentation error" for checkers.
  if (result.exitCode === 7) return { accepted: false, message: '输出格式错误 (PE)' };
  return {
    accepted: false,
    message: (stdout.trim() || stderr.trim() || `Checker 退出码 ${result.exitCode}`).slice(0, 500),
  };
}

/* -------------------------------------------------------------------------- */
/* Interactive judge (communicates through FIFOs)                             */
/* -------------------------------------------------------------------------- */

async function runInteractiveCase(
  spec: RunSpec,
  cwd: string,
  checker: { cmd: string; args: string[] },
  inputFile: string,
  timeLimitMs: number,
): Promise<{ status: Verdict; timeMs: number; memoryKb: number; message?: string }> {
  const fifoToPlayer = path.join(cwd, 'fifo_to_player');
  const fifoFromPlayer = path.join(cwd, 'fifo_from_player');
  for (const fifo of [fifoToPlayer, fifoFromPlayer]) {
    try {
      fs.rmSync(fifo, { force: true });
    } catch {
      /* ignore */
    }
  }
  const mkfifo = (target: string) =>
    new Promise<boolean>((resolve) => {
      const proc = spawn('mkfifo', [target], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  if (!(await mkfifo(fifoToPlayer)) || !(await mkfifo(fifoFromPlayer))) {
    return { status: 'SE', timeMs: 0, memoryKb: 0, message: '无法创建交互管道 (mkfifo 不可用)' };
  }

  const started = Date.now();
  const interactor = spawn(checker.cmd, [...checker.args, inputFile, fifoToPlayer, fifoFromPlayer], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  let interactorOut = '';
  let interactorErr = '';
  interactor.stdout?.on('data', (c) => (interactorOut += c.toString()));
  interactor.stderr?.on('data', (c) => (interactorErr += c.toString()));

  const player = spawn(
    '/bin/sh',
    ['-c', `exec ${spec.cmd} ${spec.args.join(' ')} < ${JSON.stringify(fifoToPlayer)} > ${JSON.stringify(fifoFromPlayer)}`],
    {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, HOME: cwd },
    },
  );
  let playerErr = '';
  player.stderr?.on('data', (c) => (playerErr += c.toString()));

  const kill = () => {
    try {
      if (player.pid) process.kill(-player.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
    interactor.kill('SIGKILL');
  };

  const timeout = setTimeout(kill, timeLimitMs);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    interactor.on('close', (code, signal) => resolve({ code, signal }));
    interactor.on('error', () => resolve({ code: null, signal: null }));
  });
  clearTimeout(timeout);
  kill();
  const timeMs = Date.now() - started;

  fs.rmSync(fifoToPlayer, { force: true });
  fs.rmSync(fifoFromPlayer, { force: true });

  if (timeMs >= timeLimitMs) return { status: 'TLE', timeMs, memoryKb: 0 };
  if (result.signal) return { status: 'SE', timeMs, memoryKb: 0, message: 'Interactor 异常退出' };
  if (result.code === 0) return { status: 'AC', timeMs, memoryKb: 0 };
  if (result.code === 1) {
    return { status: 'WA', timeMs, memoryKb: 0, message: interactorOut.trim().slice(0, 300) || '答案错误' };
  }
  if (result.code === 2) return { status: 'PE', timeMs, memoryKb: 0, message: '输出格式错误' };
  return {
    status: 'WA',
    timeMs,
    memoryKb: 0,
    message: (interactorOut.trim() || interactorErr.trim() || playerErr.trim()).slice(0, 300),
  };
}

/* -------------------------------------------------------------------------- */
/* Main entry                                                                 */
/* -------------------------------------------------------------------------- */

export async function judgeSubmission(submissionId: number): Promise<JudgeOutcome | null> {
  const submission = get<{
    id: number;
    problem_id: number;
    user_id: number;
    contest_id: number | null;
    language: string;
    code: string;
  }>('SELECT id, problem_id, user_id, contest_id, language, code FROM submissions WHERE id = ?', [
    submissionId,
  ]);
  if (!submission) return null;

  const problem = get<ProblemRow>('SELECT * FROM problems WHERE id = ?', [submission.problem_id]);
  if (!problem) {
    finish(submissionId, {
      status: 'SE',
      score: 0,
      timeMs: 0,
      memoryKb: 0,
      detail: [],
      compileOutput: '题目不存在',
    });
    return null;
  }

  const language = getLanguage(submission.language);
  if (!language) {
    finish(submissionId, {
      status: 'CE',
      score: 0,
      timeMs: 0,
      memoryKb: 0,
      detail: [],
      compileOutput: `不支持的语言：${submission.language}`,
    });
    return null;
  }

  const testcases = loadTestcases(problem.id);
  const sandboxDir = ensureDir(
    path.join(config.paths.judge, `${submissionId}-${Date.now().toString(36)}`),
  );
  const showData = bool('show_testcase_data', false);
  const liveDetail: CaseResult[] = [];

  const publish = (status: Verdict, compileOutput: string, extra: Partial<JudgeOutcome> = {}) => {
    run(
      `UPDATE submissions SET status = ?, compile_output = ?, detail = ?, score = ?,
         time_ms = ?, memory_kb = ? WHERE id = ?`,
      [
        status,
        compileOutput.slice(0, 32 * 1024),
        JSON.stringify(liveDetail),
        extra.score ?? 0,
        extra.timeMs ?? 0,
        extra.memoryKb ?? 0,
        submissionId,
      ],
    );
  };

  try {
    if (testcases.length === 0) {
      const outcome: JudgeOutcome = {
        status: 'UKOE',
        score: 0,
        timeMs: 0,
        memoryKb: 0,
        detail: [],
        compileOutput: '该题目还没有测试数据，请联系管理员。',
      };
      finish(submissionId, outcome, submission);
      return outcome;
    }

    // ---------------------------------------------------------------- compile
    const sourcePath = path.join(sandboxDir, language.sourceFile);
    fs.writeFileSync(sourcePath, submission.code, 'utf8');
    let compileOutput = '';
    const compileStarted = Date.now();
    if (language.compile) {
      const { cmd, args } = language.compile({ memMb: problem.memory_limit });
      const result = await compileSource(cmd, args, sandboxDir, num('compile_timeout_ms', 15000));
      compileOutput = result.output;
      if (!result.ok) {
        const outcome: JudgeOutcome = {
          status: 'CE',
          score: 0,
          timeMs: Date.now() - compileStarted,
          memoryKb: 0,
          detail: [],
          compileOutput: compileOutput || '编译失败',
        };
        finish(submissionId, outcome, submission);
        return outcome;
      }
    }

    // ----------------------------------------------------------------- check
    let checker: { cmd: string; args: string[] } | null = null;
    let checkerSystemError: string | null = null;
    const judgeMode = problem.judge_mode || 'standard';
    if (judgeMode === 'spj' && problem.spj_code && bool('enable_spj', true)) {
      const compiled = await compileChecker(
        sandboxDir,
        problem.spj_language || 'cpp',
        problem.spj_code,
      );
      if (!compiled.ok) {
        checkerSystemError = `Special Judge 编译失败：\n${compiled.output}`;
      } else {
        checker = { cmd: compiled.cmd, args: compiled.args };
      }
    }
    if (judgeMode === 'interactive' && problem.inter_code && bool('enable_interactive', true)) {
      const compiled = await compileChecker(sandboxDir, problem.spj_language || 'cpp', problem.inter_code);
      if (!compiled.ok) {
        checkerSystemError = `交互库编译失败：\n${compiled.output}`;
      } else {
        checker = { cmd: compiled.cmd, args: compiled.args };
      }
    }
    if (checkerSystemError) {
      const outcome: JudgeOutcome = {
        status: 'SE',
        score: 0,
        timeMs: 0,
        memoryKb: 0,
        detail: [],
        compileOutput: compileOutput ? `${compileOutput}\n${checkerSystemError}` : checkerSystemError,
      };
      finish(submissionId, outcome, submission);
      return outcome;
    }

    // ------------------------------------------------------------------ run
    const compareMode = resolveCompareMode(problem);
    const spec = buildRunSpec(language.id, problem.time_limit, problem.memory_limit);
    let maxTime = 0;
    let maxMemory = 0;
    let firstFailure: Verdict | null = null;

    for (const testcase of testcases) {
      const inputFile = testcasePath(testcase.input_file);
      const answerFile = testcasePath(testcase.output_file);
      const outputFile = path.join(sandboxDir, `user-${testcase.idx}.out`);
      const errFile = path.join(sandboxDir, `user-${testcase.idx}.err`);

      if (judgeMode === 'interactive' && checker) {
        const result = await runInteractiveCase(spec, sandboxDir, checker, inputFile, spec.timeLimitMs);
        maxTime = Math.max(maxTime, result.timeMs);
        const caseResult: CaseResult = {
          idx: testcase.idx,
          subtask: testcase.subtask_id,
          status: result.status,
          timeMs: result.timeMs,
          memoryKb: 0,
          score: result.status === 'AC' ? testcase.score : 0,
          message: result.message,
        };
        if (showData && !testcase.is_sample) caseResult.input = preview(fs.readFileSync(inputFile, 'utf8'));
        liveDetail.push(caseResult);
        publish('Judging', compileOutput, { score: 0, timeMs: maxTime, memoryKb: maxMemory });
        if (result.status !== 'AC' && !firstFailure) firstFailure = result.status;
        continue;
      }

      const result = await runSandboxed(spec.cmd, spec.args, {
        timeLimitMs: spec.timeLimitMs,
        memoryLimitMb: spec.memoryLimitMb,
        outputLimitKb: num('output_limit_kb', 64),
        cwd: sandboxDir,
        stdinFile: inputFile,
        stdoutFile: outputFile,
        stderrFile: errFile,
      });

      maxTime = Math.max(maxTime, result.timeMs);
      maxMemory = Math.max(maxMemory, result.memoryKb);

      const answer = fs.readFileSync(answerFile, 'utf8');
      let status: Verdict = 'AC';
      let message = '';
      let earned = testcase.score;

      if (result.memoryExceeded) {
        status = 'MLE';
        message = `内存超限（峰值 ${Math.round(result.memoryKb / 1024)} MB）`;
      } else if (result.timedOut) {
        status = 'TLE';
        message = `运行超时（限时 ${problem.time_limit} ms）`;
      } else if (result.outputExceeded) {
        status = 'OLE';
        message = `输出超过限制 ${num('output_limit_kb', 64)} KB`;
      } else if (result.exitCode !== 0) {
        status = 'RE';
        const stderr = (fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : result.stderr).trim();
        message = stderr
          ? `运行时错误（退出码 ${result.exitCode}）：\n${preview(stderr)}`
          : `运行时错误（退出码 ${result.exitCode}）`;
      } else if (checker) {
        const verdict = await runChecker(checker, sandboxDir, inputFile, outputFile, answerFile, problem.time_limit);
        if (verdict.systemError) {
          status = 'SE';
          message = verdict.systemError;
        } else if (verdict.accepted) {
          status = 'AC';
          earned = verdict.score ?? testcase.score;
        } else {
          status = verdict.message === '输出格式错误 (PE)' ? 'PE' : 'WA';
          message = verdict.message ?? '答案错误';
        }
      } else {
        const verdict = compareOutput(result.output, answer, compareMode);
        if (!verdict.ok) {
          status = 'WA';
          message = verdict.reason ?? '答案错误';
          // Strict comparison failed but the whitespace-insensitive one passes.
          if (compareMode === 'strict' && compareOutput(result.output, answer, 'trim').ok) {
            status = 'PE';
            message = '格式错误：行末空格或末尾换行与答案不同';
          }
        }
      }

      if (status !== 'AC') earned = 0;

      const caseResult: CaseResult = {
        idx: testcase.idx,
        subtask: testcase.subtask_id,
        status,
        timeMs: Math.min(result.timeMs, 99999),
        memoryKb: result.memoryKb,
        score: earned,
        message: message || undefined,
      };
      if (showData || testcase.is_sample) {
        caseResult.input = preview(fs.readFileSync(inputFile, 'utf8'));
        caseResult.output = preview(result.output);
        if (status !== 'AC') caseResult.answer = preview(answer);
      }
      liveDetail.push(caseResult);

      if (status !== 'AC' && !firstFailure) firstFailure = status;
      publish(firstFailure ?? 'Judging', compileOutput, {
        score: 0,
        timeMs: maxTime,
        memoryKb: maxMemory,
      });
      fs.rmSync(outputFile, { force: true });
      fs.rmSync(errFile, { force: true });
    }

    // ------------------------------------------------------------- scoring
    const subtasks = parseSubtasks(problem.subtasks);
    // Declared score of every test case (independent of what the submission earned).
    const declaredScore = new Map<number, number>(
      testcases.map((testcase) => [testcase.idx, testcase.score || 0]),
    );
    const earnedOf = (result: CaseResult) =>
      result.status === 'AC' ? declaredScore.get(result.idx) ?? result.score ?? 0 : 0;
    let score = 0;
    let allAccepted = true;
    const subtaskScores = new Map<number, number>();

    if (subtasks.length > 0) {
      const byId = new Map<number, CaseResult[]>();
      for (const result of liveDetail) {
        const list = byId.get(result.subtask) ?? [];
        list.push(result);
        byId.set(result.subtask, list);
      }
      const fullById = new Map<number, boolean>();
      for (const subtask of subtasks) {
        const cases = subtask.cases?.length
          ? liveDetail.filter((r) => subtask.cases!.includes(r.idx))
          : byId.get(subtask.id) ?? [];
        if (cases.length === 0) {
          subtaskScores.set(subtask.id, 0);
          fullById.set(subtask.id, false);
          continue;
        }
        const allOk = cases.every((c) => c.status === 'AC');
        const depsOk = (subtask.deps ?? []).every((dep) => fullById.get(dep) === true);
        let earned = 0;
        if (depsOk) {
          if (subtask.method === 'sum') {
            const earnedPoints = cases.reduce((acc, c) => acc + earnedOf(c), 0);
            const possible = cases.reduce((acc, c) => acc + (declaredScore.get(c.idx) ?? 0), 0);
            earned =
              possible > 0
                ? Math.round((earnedPoints / possible) * subtask.score)
                : allOk
                  ? subtask.score
                  : 0;
          } else {
            earned = allOk ? subtask.score : 0;
          }
        }
        subtaskScores.set(subtask.id, earned);
        fullById.set(subtask.id, earned === subtask.score);
        if (!allOk) allAccepted = false;
        score += earned;
      }
    } else {
      const possible = testcases.reduce((acc, item) => acc + (item.score || 0), 0);
      const earnedPoints = liveDetail.reduce((acc, item) => acc + earnedOf(item), 0);
      const acceptedCases = liveDetail.filter((item) => item.status === 'AC').length;
      score =
        possible > 0
          ? Math.round((earnedPoints / possible) * 100)
          : Math.round((acceptedCases / Math.max(1, testcases.length)) * 100);
      allAccepted = liveDetail.every((item) => item.status === 'AC');
    }

    if (allAccepted) score = subtasks.length > 0 ? subtasks.reduce((a, s) => a + s.score, 0) : 100;
    const status: Verdict = allAccepted ? 'AC' : firstFailure ?? 'WA';

    const outcome: JudgeOutcome = {
      status,
      score: Math.max(0, Math.min(1000, score)),
      timeMs: maxTime,
      memoryKb: maxMemory,
      detail: liveDetail,
      compileOutput,
    };
    finish(submissionId, outcome, submission);
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome: JudgeOutcome = {
      status: 'SE',
      score: 0,
      timeMs: 0,
      memoryKb: 0,
      detail: liveDetail,
      compileOutput: `评测系统错误：${message}`,
    };
    finish(submissionId, outcome, submission);
    return outcome;
  } finally {
    removeDir(sandboxDir);
  }
}

/* -------------------------------------------------------------------------- */
/* Side effects of a finished judgement                                       */
/* -------------------------------------------------------------------------- */

interface SubmissionRef {
  id: number;
  problem_id: number;
  user_id: number;
  contest_id: number | null;
}

function finish(id: number, outcome: JudgeOutcome, submission?: SubmissionRef): void {
  const ref =
    submission ??
    get<SubmissionRef>('SELECT id, problem_id, user_id, contest_id FROM submissions WHERE id = ?', [id]);

  // Figure out what the submission looked like before this judgement so that
  // rejudges (and hacks) adjust the counters instead of inflating them.
  const previous = get<{ status: string; score: number; judged_at: string | null }>(
    'SELECT status, score, judged_at FROM submissions WHERE id = ?',
    [id],
  );
  const wasJudged = Boolean(previous?.judged_at);
  const wasAccepted = previous?.status === 'AC';
  const nowAccepted = outcome.status === 'AC';

  run(
    `UPDATE submissions SET status = ?, score = ?, time_ms = ?, memory_kb = ?,
       compile_output = ?, detail = ?, judged_at = datetime('now') WHERE id = ?`,
    [
      outcome.status,
      outcome.score,
      outcome.timeMs,
      outcome.memoryKb,
      (outcome.compileOutput ?? '').slice(0, 32 * 1024),
      JSON.stringify(outcome.detail ?? []),
      id,
    ],
  );
  if (!ref) return;

  tx(() => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const existing = get<{ attempts: number; accepted: number; first_ac_at: string | null }>(
      'SELECT attempts, accepted, first_ac_at FROM user_problem_stats WHERE user_id = ? AND problem_id = ?',
      [ref.user_id, ref.problem_id],
    );
    const acceptedNow = outcome.status === 'AC' ? 1 : 0;
    if (existing) {
      if (wasJudged) {
        // Rejudge: correct the accepted counter instead of adding to it.
        const delta = acceptedNow - (wasAccepted ? 1 : 0);
        run(
          `UPDATE user_problem_stats SET accepted = MAX(0, accepted + ?),
             first_ac_at = CASE WHEN accepted + ? > 0 THEN first_ac_at ELSE NULL END,
             last_submit_at = ?
           WHERE user_id = ? AND problem_id = ?`,
          [delta, delta, now, ref.user_id, ref.problem_id],
        );
      } else {
        run(
          `UPDATE user_problem_stats SET attempts = attempts + 1, accepted = accepted + ?,
             first_ac_at = COALESCE(first_ac_at, ?), last_submit_at = ?
           WHERE user_id = ? AND problem_id = ?`,
          [acceptedNow, acceptedNow ? now : null, now, ref.user_id, ref.problem_id],
        );
      }
    } else {
      run(
        `INSERT INTO user_problem_stats (user_id, problem_id, attempts, accepted, first_ac_at, last_submit_at)
         VALUES (?, ?, 1, ?, ?, ?)`,
        [ref.user_id, ref.problem_id, acceptedNow, acceptedNow ? now : null, now],
      );
    }

    if (nowAccepted !== wasAccepted) {
      const delta = nowAccepted ? 1 : -1;
      run('UPDATE problems SET accepted_count = MAX(0, accepted_count + ?) WHERE id = ?', [delta, ref.problem_id]);
      run('UPDATE users SET accepted_count = MAX(0, accepted_count + ?) WHERE id = ?', [delta, ref.user_id]);
    }
    if (!wasJudged) {
      run('UPDATE users SET submission_count = submission_count + 1 WHERE id = ?', [ref.user_id]);
    }

    const isFirstSolve = nowAccepted && !wasAccepted && (existing?.accepted ?? 0) === 0;
    const lostSolve = wasAccepted && !nowAccepted;
    if (isFirstSolve || lostSolve) {
      const delta = isFirstSolve ? 1 : -1;
      run('UPDATE users SET solved_count = MAX(0, solved_count + ?) WHERE id = ?', [delta, ref.user_id]);
    }
    if (isFirstSolve) {
      const perProblem = num('points_per_accepted', 1);
      if (perProblem > 0 && bool('enable_points', true)) {
        addPoints(ref.user_id, perProblem, `通过题目 ${ref.problem_id}`, {
          refType: 'problem',
          refId: ref.problem_id,
        });
        const firstBloodGlobal = get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM user_problem_stats WHERE problem_id = ? AND accepted > 0 AND user_id <> ?`,
          [ref.problem_id, ref.user_id],
        );
        const bonus = num('points_first_ac_bonus', 0);
        if (bonus > 0 && (firstBloodGlobal?.c ?? 0) === 0) {
          addPoints(ref.user_id, bonus, `全站首杀题目 ${ref.problem_id}`, {
            refType: 'problem',
            refId: ref.problem_id,
          });
        }
      }
    }
  });

  // The achievement engine sends its own notification for every new badge.
  if (nowAccepted) evaluateAchievements(ref.user_id);

  if (bool('notify_on_judge', false)) {
    const problem = get<{ pid: string; title: string }>(
      'SELECT pid, title FROM problems WHERE id = ?',
      [ref.problem_id],
    );
    sendMessage({
      to: ref.user_id,
      title: `评测完成 #${id}：${outcome.status}`,
      content: `题目 ${problem?.pid ?? ''} ${problem?.title ?? ''}\n结果：${outcome.status}（${outcome.score} 分）`,
      type: 'judge',
      refType: 'submission',
      refId: id,
    });
  }
}

/** Re-queue submissions for judging. */
export function rejudge(where: { problemId?: number; submissionIds?: number[]; contestId?: number }): number {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (where.problemId) {
    clauses.push('problem_id = ?');
    params.push(where.problemId);
  }
  if (where.contestId) {
    clauses.push('contest_id = ?');
    params.push(where.contestId);
  }
  if (where.submissionIds?.length) {
    clauses.push(`id IN (${where.submissionIds.map(() => '?').join(',')})`);
    params.push(...where.submissionIds);
  }
  if (!clauses.length) return 0;
  const info = run(
    `UPDATE submissions SET status = 'Waiting', score = 0, detail = '[]', compile_output = '',
       time_ms = NULL, memory_kb = NULL, claimed_at = NULL, judged_at = NULL
     WHERE ${clauses.join(' AND ')}`,
    params,
  );
  return info.changes;
}

export function judgeStats(): { waiting: number; judging: number; concurrency: number; available: string[] } {
  const available = settingJson<string[]>('enabled_languages', []);
  return {
    waiting: Number(get<{ c: number }>(`SELECT COUNT(*) AS c FROM submissions WHERE status = 'Waiting'`)?.c ?? 0),
    judging: Number(get<{ c: number }>(`SELECT COUNT(*) AS c FROM submissions WHERE status = 'Judging'`)?.c ?? 0),
    concurrency: config.judge.concurrency,
    available,
  };
}
