import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface RunLimits {
  /** Wall-clock limit in milliseconds (already includes language multipliers). */
  timeLimitMs: number;
  /** Memory limit in megabytes. */
  memoryLimitMb: number;
  /** stdout cap in kilobytes. */
  outputLimitKb: number;
  /** Working directory. */
  cwd: string;
  /** Optional stdin file. When omitted stdin is /dev/null. */
  stdinFile?: string;
  /** Where to write stdout. */
  stdoutFile?: string;
  /** Where to write stderr. */
  stderrFile?: string;
  env?: Record<string, string>;
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timeMs: number;
  memoryKb: number;
  timedOut: boolean;
  memoryExceeded: boolean;
  outputExceeded: boolean;
  output: string;
  stderr: string;
}

const SAMPLE_INTERVAL_MS = 10;
const IS_MAC = process.platform === 'darwin';
/** `/usr/bin/time` gives an accurate peak RSS, which sampling can miss. */
const TIME_BIN = fs.existsSync('/usr/bin/time') ? '/usr/bin/time' : null;

function parseTimeOutput(file: string): number {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (IS_MAC) {
      const match = text.match(/(\d+)\s+maximum resident set size/);
      // BSD `time -l` reports bytes.
      return match ? Math.round(Number(match[1]) / 1024) : 0;
    }
    const match = text.match(/Maximum resident set size[^:]*:\s*(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readFileCapped(file: string | undefined, capKb: number): string {
  if (!file) return '';
  try {
    const stat = fs.statSync(file);
    const max = capKb * 1024;
    const size = Math.min(stat.size, max);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function rssOf(pid: number): number {
  try {
    const out = execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const value = Number(out.trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Run an untrusted command under time / memory / output limits.
 *
 * The limits are enforced with:
 *  - a POSIX `ulimit` wrapper (CPU time, stack, output file size),
 *  - a wall-clock watchdog that kills the whole process group,
 *  - RSS sampling to detect memory limit violations.
 *
 * For stronger isolation on Linux, point `JUDGE_SANDBOX=isolate` at a real
 * `isolate` binary (see README) and wrap the command externally.
 */
export async function runSandboxed(
  cmd: string,
  args: string[],
  limits: RunLimits,
): Promise<RunResult> {
  const outputLimitBlocks = Math.max(1, Math.ceil((limits.outputLimitKb * 1024) / 512));
  const cpuSeconds = Math.max(1, Math.ceil(limits.timeLimitMs / 1000) + 1);

  const wrapper = [
    `ulimit -t ${cpuSeconds}`,
    `ulimit -f ${outputLimitBlocks}`,
    'exec "$@"',
  ].join('; ');

  const stdoutFd = limits.stdoutFile
    ? fs.openSync(limits.stdoutFile, 'w')
    : 'pipe' as const;
  const stderrFd = limits.stderrFile
    ? fs.openSync(limits.stderrFile, 'w')
    : 'pipe' as const;
  const stdinFd = limits.stdinFile ? fs.openSync(limits.stdinFile, 'r') : 'ignore' as const;

  const timeFile = TIME_BIN ? path.join(limits.cwd, `.ogoj-time-${Date.now().toString(36)}`) : null;
  const started = process.hrtime.bigint();
  const child: ChildProcess = spawn(
    TIME_BIN ?? '/bin/sh',
    TIME_BIN
      ? [IS_MAC ? '-l' : '-v', '-o', timeFile!, '/bin/sh', '-c', wrapper, 'sh', cmd, ...args]
      : ['-c', wrapper, 'sh', cmd, ...args],
    {
      cwd: limits.cwd,
      detached: true,
      stdio: [stdinFd, stdoutFd as any, stderrFd as any],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin',
        HOME: limits.cwd,
        LANG: 'C.UTF-8',
        ...(limits.env ?? {}),
      },
    },
  );

  let peakRssKb = 0;
  let timedOut = false;
  let memoryExceeded = false;
  let outputExceeded = false;
  const memoryLimitKb = limits.memoryLimitMb * 1024;

  const killer = setTimeout(() => {
    timedOut = true;
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }, limits.timeLimitMs);

  const sampler = setInterval(() => {
    if (!child.pid) return;
    if (timeFile) return; // accurate peak RSS comes from /usr/bin/time
    const rss = rssOf(child.pid);
    if (rss > peakRssKb) peakRssKb = rss;
    if (rss > memoryLimitKb) {
      memoryExceeded = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
    if (limits.stdoutFile) {
      try {
        if (fs.statSync(limits.stdoutFile).size > limits.outputLimitKb * 1024) {
          outputExceeded = true;
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      } catch {
        /* file may not exist yet */
      }
    }
  }, SAMPLE_INTERVAL_MS);

  let capturedStdout = '';
  let capturedStderr = '';
  if (child.stdout) child.stdout.on('data', (chunk) => (capturedStdout += chunk.toString()));
  if (child.stderr) child.stderr.on('data', (chunk) => (capturedStderr += chunk.toString()));

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on('close', (code, signal) => resolve({ code, signal }));
      child.on('error', () => resolve({ code: null, signal: null }));
    },
  );

  clearTimeout(killer);
  clearInterval(sampler);

  const timeMs = Number((process.hrtime.bigint() - started) / 1000000n);
  const measuredMemoryKb = timeFile ? parseTimeOutput(timeFile) : 0;
  const memoryKb = Math.max(peakRssKb, measuredMemoryKb);
  if (!memoryExceeded && memoryKb > memoryLimitKb) memoryExceeded = true;
  if (timeFile) {
    try {
      fs.rmSync(timeFile, { force: true });
    } catch {
      /* ignore */
    }
  }

  for (const fd of [stdoutFd, stderrFd, stdinFd]) {
    if (typeof fd === 'number') {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }

  const output = limits.stdoutFile
    ? readFileCapped(limits.stdoutFile, limits.outputLimitKb)
    : capturedStdout.slice(0, limits.outputLimitKb * 1024);
  const stderr = limits.stderrFile
    ? readFileCapped(limits.stderrFile, 64)
    : capturedStderr.slice(0, 64 * 1024);

  if (exit.signal === 'SIGXFSZ' || exit.signal === 'SIGXCPU') {
    if (exit.signal === 'SIGXCPU') timedOut = true;
    else outputExceeded = true;
  }

  return {
    exitCode: exit.code,
    signal: exit.signal,
    timeMs,
    memoryKb: Math.round(memoryKb),
    timedOut,
    memoryExceeded,
    outputExceeded,
    output,
    stderr,
  };
}

export interface CompileResult {
  ok: boolean;
  output: string;
  timeMs: number;
}

export async function compileSource(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CompileResult> {
  const started = Date.now();
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, LANG: 'C.UTF-8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (c) => (output += c.toString()));
  child.stderr?.on('data', (c) => (output += c.toString()));

  const result = await new Promise<{ code: number | null; killed: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, killed: true });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, killed: false });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      output += `\n${err.message}`;
      resolve({ code: null, killed: false });
    });
  });

  return {
    ok: result.code === 0,
    output: output.slice(0, 32 * 1024) + (result.killed ? '\n[编译超时]' : ''),
    timeMs: Date.now() - started,
  };
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return path.resolve(dir);
}

export function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export { shellQuote };
