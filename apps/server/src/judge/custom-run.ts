/**
 * 自测：把用户代码编译后，用自定义输入跑一遍，只返回运行结果。
 * 和正式评测共用同一套沙箱与限制，但不会写入 submissions 表。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { num } from '../settings/index.js';
import { getLanguage, javaRunArgs } from './languages.js';
import { compileSource, ensureDir, removeDir, runSandboxed } from './sandbox.js';

export type CustomRunStatus = 'OK' | 'CE' | 'TLE' | 'MLE' | 'RE' | 'OLE' | 'SE';

export interface CustomRunResult {
  status: CustomRunStatus;
  stdout: string;
  stderr: string;
  compileOutput: string;
  timeMs: number;
  memoryKb: number;
  exitCode: number | null;
  message: string;
}

export interface CustomRunOptions {
  language: string;
  code: string;
  input: string;
  timeLimitMs?: number;
  memoryLimitMb?: number;
}

/** 同时进行的自测上限，避免把机器打满 */
const MAX_CONCURRENT_RUNS = 2;
let running = 0;

export function customRunBusy(): boolean {
  return running >= MAX_CONCURRENT_RUNS;
}

function runSpec(languageId: string, timeLimitMs: number, memoryLimitMb: number) {
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

export async function runCustomTest(options: CustomRunOptions): Promise<CustomRunResult> {
  const language = getLanguage(options.language);
  if (!language) {
    return {
      status: 'SE',
      stdout: '',
      stderr: '',
      compileOutput: '',
      timeMs: 0,
      memoryKb: 0,
      exitCode: null,
      message: `不支持的语言：${options.language}`,
    };
  }

  const timeLimitMs = Math.min(
    num('max_time_limit', 10000),
    Math.max(100, Number(options.timeLimitMs ?? num('default_time_limit', 1000)) || 1000),
  );
  const memoryLimitMb = Math.min(
    num('max_memory_limit', 1024),
    Math.max(16, Number(options.memoryLimitMb ?? num('default_memory_limit', 256)) || 256),
  );

  const sandboxDir = ensureDir(path.join(config.paths.judge, `run-${Date.now().toString(36)}-${process.pid}`));
  running += 1;
  try {
    fs.writeFileSync(path.join(sandboxDir, language.sourceFile), options.code, 'utf8');
    if (language.compile) {
      const { cmd, args } = language.compile({ memMb: memoryLimitMb });
      const compiled = await compileSource(cmd, args, sandboxDir, num('compile_timeout_ms', 15000));
      if (!compiled.ok) {
        return {
          status: 'CE',
          stdout: '',
          stderr: '',
          compileOutput: compiled.output || '编译失败',
          timeMs: 0,
          memoryKb: 0,
          exitCode: null,
          message: '编译失败',
        };
      }
    }

    const inputFile = path.join(sandboxDir, 'custom.in');
    const stdoutFile = path.join(sandboxDir, 'custom.out');
    const stderrFile = path.join(sandboxDir, 'custom.err');
    fs.writeFileSync(inputFile, options.input, 'utf8');

    const spec = runSpec(language.id, timeLimitMs, memoryLimitMb);
    const result = await runSandboxed(spec.cmd, spec.args, {
      timeLimitMs: spec.timeLimitMs,
      memoryLimitMb: spec.memoryLimitMb,
      outputLimitKb: num('output_limit_kb', 64),
      cwd: sandboxDir,
      stdinFile: inputFile,
      stdoutFile,
      stderrFile,
    });

    const status: CustomRunStatus = result.timedOut
      ? 'TLE'
      : result.memoryExceeded
        ? 'MLE'
        : result.outputExceeded
          ? 'OLE'
          : result.exitCode === 0
            ? 'OK'
            : 'RE';
    const message =
      status === 'OK'
        ? '运行完成'
        : status === 'TLE'
          ? `超出时间限制（${spec.timeLimitMs} ms）`
          : status === 'MLE'
            ? `超出内存限制（${spec.memoryLimitMb} MB）`
            : status === 'OLE'
              ? '输出超过限制'
              : `运行出错（退出码 ${result.exitCode ?? '被信号终止'}）`;

    return {
      status,
      stdout: result.output,
      stderr: result.stderr,
      compileOutput: '',
      timeMs: result.timeMs,
      memoryKb: result.memoryKb,
      exitCode: result.exitCode,
      message,
    };
  } catch (error) {
    return {
      status: 'SE',
      stdout: '',
      stderr: '',
      compileOutput: '',
      timeMs: 0,
      memoryKb: 0,
      exitCode: null,
      message: error instanceof Error ? error.message : '自测运行失败',
    };
  } finally {
    running -= 1;
    removeDir(sandboxDir);
  }
}
