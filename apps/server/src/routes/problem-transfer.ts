/**
 * 题目批量导出与导入（仅管理员）。
 *
 * 导出 ZIP 的结构：
 *   manifest.json                     导出信息与题目索引
 *   problems/<题目目录>/problem.json    题面、限制、子任务、样例、标签等元数据
 *   problems/<题目目录>/testcases/     测试点，按 idx 命名成 <idx>.in / <idx>.out
 *
 * 导入支持两种格式：
 *   - zip：上面这种题目包
 *   - fps：FreeProblemSet 1.x 的 XML（<fps> 下的若干 <item>）
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { all, get, run } from '../db/index.js';
import { requireAdmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { num } from '../settings/index.js';
import { publicUploadPath, saveTestcase, uploadDir } from '../lib/storage.js';
import { nextProblemPid } from './helpers.js';
import { autoTagColor } from '../lib/tags.js';

const PACK_FORMAT = 'ogoj-problem-pack';
/** 单次导出的题目上限，避免把内存撑爆 */
const MAX_EXPORT_PROBLEMS = 200;
/** 单次导入的题目上限 */
const MAX_IMPORT_ITEMS = 500;

interface ImportedProblem {
  pid: string;
  title: string;
  testcases: number;
  samples: number;
  images: number;
}

interface ImportFailure {
  name: string;
  reason: string;
}

interface TestcaseInput {
  idx: number;
  subtask: number;
  score: number;
  isSample: boolean;
  input: string;
  output: string;
}

interface ProblemInput {
  pid?: string;
  title: string;
  background?: string;
  statement?: string;
  inputFormat?: string;
  outputFormat?: string;
  hint?: string;
  provider?: string;
  difficulty?: number;
  timeLimit?: number;
  memoryLimit?: number;
  judgeMode?: string;
  compareMode?: string;
  spjLanguage?: string;
  spjCode?: string;
  interCode?: string;
  subtasks?: unknown;
  samples?: unknown;
  allowLanguages?: unknown;
  isPublic?: boolean;
  tags?: unknown;
}

/* ------------------------------------------------------------------ 工具 */

function safeSegment(value: string): string {
  const cleaned = String(value)
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned.slice(0, 60) || 'problem';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** 取 XML 节点的文本：兼容纯文本、CDATA 与「带属性的文本」 */
function nodeText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return nodeText(value[0]);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['#text'] === 'string') return record['#text'];
    return '';
  }
  return '';
}

function nodeAttr(value: unknown, name: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const attr = (value as Record<string, unknown>)[`@_${name}`];
    if (typeof attr === 'string') return attr;
    if (typeof attr === 'number') return String(attr);
  }
  return '';
}

function normalizeSubtasks(raw: unknown): unknown[] {
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

function normalizeSamples(raw: unknown): { input: string; output: string; explanation: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item: any) => ({
      input: String(item.input ?? ''),
      output: String(item.output ?? ''),
      explanation: String(item.explanation ?? ''),
    }));
}

function applyTags(problemId: number, tags: unknown): void {
  if (!Array.isArray(tags)) return;
  const ids: number[] = [];
  for (const tag of tags) {
    if (typeof tag === 'number') {
      ids.push(tag);
      continue;
    }
    const name = String(tag ?? '').trim().slice(0, 32);
    if (!name) continue;
    const existing = get<{ id: number }>('SELECT id FROM tags WHERE name = ?', [name]);
    if (existing) ids.push(existing.id);
      // 自动创建的标签统一进「默认」分组，管理员可以在后台调整分组
      else {
        ids.push(
          Number(
            run(`INSERT INTO tags (name, color, category) VALUES (?, ?, ?)`, [
              name,
              autoTagColor(name),
              '默认',
            ]).lastInsertRowid,
          ),
        );
      }
  }
  run('DELETE FROM problem_tags WHERE problem_id = ?', [problemId]);
  for (const id of ids) run('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)', [problemId, id]);
}

/** 建题：题目编号优先沿用文件里的，被占用时自动分配一个 */
function createProblem(request: FastifyRequest, input: ProblemInput): number {
  const title = String(input.title ?? '').trim().slice(0, 120) || '未命名题目';
  let pid = String(input.pid ?? '').trim().slice(0, 32);
  if (!pid || get('SELECT id FROM problems WHERE pid = ?', [pid])) pid = nextProblemPid();
  const judgeMode = ['standard', 'spj', 'interactive'].includes(String(input.judgeMode))
    ? String(input.judgeMode)
    : 'standard';
  const userId = request.user?.id ?? null;
  const info = run(
    `INSERT INTO problems
      (pid, title, background, statement, input_format, output_format, hint, difficulty, author_id, owner_id,
       provider, time_limit, memory_limit, judge_mode, compare_mode, spj_language, spj_code, inter_code,
       subtasks, samples, allow_languages, source_type, review_status, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pid,
      title,
      String(input.background ?? ''),
      String(input.statement ?? ''),
      String(input.inputFormat ?? ''),
      String(input.outputFormat ?? ''),
      String(input.hint ?? ''),
      clampInt(input.difficulty, 1, 6, 1),
      userId,
      userId,
      String(input.provider ?? ''),
      clampInt(input.timeLimit, 100, num('max_time_limit', 10000), num('default_time_limit', 1000)),
      clampInt(input.memoryLimit, 16, num('max_memory_limit', 1024), num('default_memory_limit', 256)),
      judgeMode,
      String(input.compareMode ?? ''),
      judgeMode === 'standard' ? '' : String(input.spjLanguage ?? 'cpp'),
      judgeMode === 'standard' ? '' : String(input.spjCode ?? ''),
      judgeMode === 'interactive' ? String(input.interCode ?? '') : '',
      JSON.stringify(normalizeSubtasks(input.subtasks)),
      JSON.stringify(normalizeSamples(input.samples)),
      JSON.stringify(Array.isArray(input.allowLanguages) ? input.allowLanguages : []),
      'official',
      'approved',
      input.isPublic === false ? 0 : 1,
    ],
  );
  const problemId = Number(info.lastInsertRowid);
  applyTags(problemId, input.tags);
  return problemId;
}

/** 写入测试点：文件落到 data/testdata/<id>/，同时写 testcases 表 */
function attachTestcases(problemId: number, cases: TestcaseInput[]): number {
  let saved = 0;
  for (const item of cases) {
    const idx = item.idx > 0 ? item.idx : saved + 1;
    if (get('SELECT id FROM testcases WHERE problem_id = ? AND idx = ?', [problemId, idx])) continue;
    const files = saveTestcase(problemId, idx, item.input, item.output);
    run(
      `INSERT INTO testcases (problem_id, idx, subtask_id, score, input_file, output_file, is_sample)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [problemId, idx, item.subtask, Math.max(0, item.score), files.inputFile, files.outputFile, item.isSample ? 1 : 0],
    );
    saved += 1;
  }
  return saved;
}

/* ------------------------------------------------------------------ ZIP */

function buildProblemMeta(problem: any): Record<string, unknown> {
  const tags = all<{ name: string }>(
    `SELECT t.name FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.problem_id = ? ORDER BY t.name`,
    [problem.id],
  ).map((row) => row.name);
  return {
    format: PACK_FORMAT,
    version: 1,
    pid: problem.pid,
    title: problem.title,
    difficulty: problem.difficulty,
    background: problem.background ?? '',
    statement: problem.statement ?? '',
    inputFormat: problem.input_format ?? '',
    outputFormat: problem.output_format ?? '',
    hint: problem.hint ?? '',
    provider: problem.provider ?? '',
    timeLimit: problem.time_limit,
    memoryLimit: problem.memory_limit,
    judgeMode: problem.judge_mode,
    compareMode: problem.compare_mode ?? '',
    spjLanguage: problem.spj_language ?? '',
    spjCode: problem.spj_code ?? '',
    interCode: problem.inter_code ?? '',
    subtasks: JSON.parse(problem.subtasks || '[]'),
    samples: JSON.parse(problem.samples || '[]'),
    allowLanguages: JSON.parse(problem.allow_languages || '[]'),
    tags,
  };
}

/* ------------------------------------------------------------------ FPS */

const FPS_ARRAY_TAGS = [
  'item',
  'solution',
  'test_input',
  'test_output',
  'sample_input',
  'sample_output',
  'img',
];

function parseFpsItems(xml: string): any[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name: string) => FPS_ARRAY_TAGS.includes(name),
  });
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw badRequest('无法解析 FPS 文件，请确认它是 FPS 格式的 XML');
  }
  const items = doc?.fps?.item;
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('FPS 文件里没有找到题目（<item>）');
  }
  return items;
}

function fpsTimeLimit(item: any): number {
  const raw = item.time_limit;
  const value = Number(nodeText(raw));
  const unit = nodeAttr(raw, 'unit').toLowerCase() || 's';
  const numeric = Number.isFinite(value) && value > 0 ? value : 1;
  const ms = unit.startsWith('ms') ? numeric : numeric * 1000;
  return clampInt(ms, 100, num('max_time_limit', 10000), num('default_time_limit', 1000));
}

function fpsMemoryLimit(item: any): number {
  const raw = item.memory_limit;
  const value = Number(nodeText(raw));
  const unit = nodeAttr(raw, 'unit').toLowerCase() || 'mb';
  const numeric = Number.isFinite(value) && value > 0 ? value : 256;
  const mb = unit.startsWith('kb') ? numeric / 1024 : unit.startsWith('gb') ? numeric * 1024 : numeric;
  return clampInt(mb, 16, num('max_memory_limit', 1024), num('default_memory_limit', 256));
}

function imageExtension(src: string, buffer: Buffer): string {
  const fromName = path.extname(src.split('?')[0] ?? '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(fromName)) return fromName;
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg';
  if (buffer.length > 8 && buffer.toString('hex', 0, 4) === '89504e47') return '.png';
  if (buffer.length > 3 && buffer.toString('ascii', 0, 3) === 'GIF') return '.gif';
  if (buffer.length > 12 && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return '.png';
}

/** FPS 的内嵌图片：<img><src>地址</src><base64>数据</base64></img> */
function saveFpsImage(problemId: number, src: string, base64: string, index: number): string | null {
  const marker = base64.indexOf('base64,');
  const payload = (marker >= 0 ? base64.slice(marker + 7) : base64).replace(/\s+/g, '');
  if (!payload) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
  if (!buffer.length) return null;
  const relative = path.join('problem', String(problemId));
  const name = `${index + 1}-${randomBytes(4).toString('hex')}${imageExtension(src, buffer)}`;
  fs.writeFileSync(path.join(uploadDir(relative), name), buffer);
  return publicUploadPath(path.join(relative, name));
}

function replaceAll(source: string, search: string, replacement: string): string {
  if (!search) return source;
  return source.split(search).join(replacement);
}

/**
 * FPS 文件的 <source> 往往把多个标签挤在一起，例如
 * 「[数组 查找 数组 二分查找 线性查找]」，这里拆成一个个标签并去重。
 */
function splitFpsTags(source: string): string[] {
  const cleaned = String(source ?? '').replace(/[\[\]【】（）(){}<>《》「」]/g, ' ');
  const parts = cleaned.split(/[\s,，、;；|/]+/);
  const tags: string[] = [];
  for (const part of parts) {
    const name = part.replace(/^[-–—_*·]+|[-–—_*·]+$/g, '').trim().slice(0, 32);
    if (!name) continue;
    if (!tags.includes(name)) tags.push(name);
  }
  return tags;
}

/* ------------------------------------------------------------------ 路由 */

export async function registerProblemTransferRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------- 批量导出 */
  app.get('/api/admin/problems/export', async (request, reply) => {
    requireAdmin(request);
    const raw = String((request.query as any)?.ids ?? '');
    const ids = [...new Set(raw.split(',').map((value) => Number(value.trim())))]
      .filter((value) => Number.isInteger(value) && value > 0);
    if (!ids.length) throw badRequest('请先勾选要导出的题目');
    if (ids.length > MAX_EXPORT_PROBLEMS) throw badRequest(`一次最多导出 ${MAX_EXPORT_PROBLEMS} 道题目`);

    const placeholders = ids.map(() => '?').join(',');
    const problems = all<any>(
      `SELECT * FROM problems WHERE id IN (${placeholders}) AND deleted_at IS NULL ORDER BY pid`,
      ids,
    );
    if (!problems.length) throw badRequest('没有找到可导出的题目');

    const zip = new AdmZip();
    const manifest: Record<string, unknown> = {
      format: PACK_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      count: problems.length,
      problems: [] as unknown[],
    };

    for (const problem of problems) {
      const dir = `problems/${safeSegment(problem.pid)}`;
      const cases = all<any>('SELECT * FROM testcases WHERE problem_id = ? ORDER BY idx', [problem.id]);
      const testcases: Record<string, unknown>[] = [];
      for (const item of cases) {
        const inputPath = `testcases/${item.idx}.in`;
        const outputPath = `testcases/${item.idx}.out`;
        const inputAbs = path.join(config.paths.testdata, item.input_file);
        const outputAbs = path.join(config.paths.testdata, item.output_file);
        if (fs.existsSync(inputAbs)) zip.addFile(`${dir}/${inputPath}`, fs.readFileSync(inputAbs));
        if (fs.existsSync(outputAbs)) zip.addFile(`${dir}/${outputPath}`, fs.readFileSync(outputAbs));
        testcases.push({
          idx: item.idx,
          subtask: item.subtask_id,
          score: item.score,
          isSample: Boolean(item.is_sample),
          input: inputPath,
          output: outputPath,
        });
      }
      zip.addFile(
        `${dir}/problem.json`,
        Buffer.from(JSON.stringify({ ...buildProblemMeta(problem), testcases }, null, 2), 'utf8'),
      );
      (manifest.problems as unknown[]).push({
        pid: problem.pid,
        title: problem.title,
        dir,
        testcases: testcases.length,
      });
    }

    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    audit(request, 'problem.export', { detail: { count: problems.length, ids } });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="ogoj-problems-${stamp}.zip"`);
    return reply.send(zip.toBuffer());
  });

  /* ------------------------------------------------------------ 导入 */
  app.post('/api/admin/problems/import', async (request) => {
    requireAdmin(request);
    const query = (request.query ?? {}) as Record<string, string>;
    const format = String(query.format ?? 'zip').toLowerCase() === 'fps' ? 'fps' : 'zip';
    const difficulty = clampInt(query.difficulty, 1, 6, 1);
    const isPublic = !['0', 'false', 'off'].includes(String(query.public ?? '1').toLowerCase());

    const file = await (request as any).file({
      limits: { fileSize: num('max_upload_size_mb', 64) * 1024 * 1024 },
    });
    if (!file) throw badRequest('请选择要导入的文件');
    const buffer = await file.toBuffer();
    const filename = String(file.filename ?? '');
    if (!buffer.length) throw badRequest('文件内容为空');

    const created: ImportedProblem[] = [];
    const failed: ImportFailure[] = [];

    if (format === 'fps') {
      const items = parseFpsItems(buffer.toString('utf8'));
      if (items.length > MAX_IMPORT_ITEMS) throw badRequest(`一次最多导入 ${MAX_IMPORT_ITEMS} 道题目`);
      items.forEach((item, index) => {
        const title = nodeText(item.title).trim() || `未命名题目 ${index + 1}`;
        try {
          const testcases: TestcaseInput[] = [];
          const inputs = asArray(item.test_input);
          const outputs = asArray(item.test_output);
          const total = Math.max(inputs.length, outputs.length);
          for (let i = 0; i < total; i += 1) {
            const input = nodeText(inputs[i]);
            const output = nodeText(outputs[i]);
            if (!input && !output) continue;
            testcases.push({ idx: testcases.length + 1, subtask: 0, score: 10, isSample: false, input, output });
          }

          const samples: { input: string; output: string; explanation: string }[] = [];
          const sampleInputs = asArray(item.sample_input);
          const sampleOutputs = asArray(item.sample_output);
          const sampleTotal = Math.max(sampleInputs.length, sampleOutputs.length);
          for (let i = 0; i < sampleTotal; i += 1) {
            const input = nodeText(sampleInputs[i]);
            const output = nodeText(sampleOutputs[i]);
            if (!input && !output) continue;
            samples.push({ input, output, explanation: '' });
          }

          const problemId = createProblem(request, {
            title,
            statement: nodeText(item.description),
            inputFormat: nodeText(item.input),
            outputFormat: nodeText(item.output),
            hint: nodeText(item.hint),
            provider: nodeText(item.source),
            difficulty,
            timeLimit: fpsTimeLimit(item),
            memoryLimit: fpsMemoryLimit(item),
            samples,
            isPublic,
            // FPS 没有标签字段，把来源拆成标签（归到「默认」分组）
            tags: splitFpsTags(nodeText(item.source)),
          });

          // FPS 里没有测试数据时，用样例数据兜底，否则这道题没法评测
          if (!testcases.length && samples.length) {
            for (const sample of samples) {
              testcases.push({
                idx: testcases.length + 1,
                subtask: 0,
                score: 10,
                isSample: true,
                input: sample.input,
                output: sample.output,
              });
            }
          }

          const images = asArray(item.img)
            .map((entry) => ({ src: nodeText(entry?.src), base64: nodeText(entry?.base64) }))
            .filter((entry) => entry.src && entry.base64);
          let savedImages = 0;
          if (images.length) {
            const problem = get<any>('SELECT * FROM problems WHERE id = ?', [problemId]);
            const fields: Record<string, string> = {
              background: String(problem?.background ?? ''),
              statement: String(problem?.statement ?? ''),
              input_format: String(problem?.input_format ?? ''),
              output_format: String(problem?.output_format ?? ''),
              hint: String(problem?.hint ?? ''),
            };
            images.forEach((image, imageIndex) => {
              const url = saveFpsImage(problemId, image.src, image.base64, imageIndex);
              if (!url) return;
              savedImages += 1;
              for (const key of Object.keys(fields)) {
                fields[key] = replaceAll(fields[key]!, image.src, url);
              }
            });
            run(
              `UPDATE problems SET background = ?, statement = ?, input_format = ?, output_format = ?, hint = ?
                WHERE id = ?`,
              [fields.background, fields.statement, fields.input_format, fields.output_format, fields.hint, problemId],
            );
          }

          const saved = attachTestcases(problemId, testcases);
          const problem = get<{ pid: string }>('SELECT pid FROM problems WHERE id = ?', [problemId]);
          created.push({
            pid: String(problem?.pid ?? ''),
            title,
            testcases: saved,
            samples: samples.length,
            images: savedImages,
          });
        } catch (error) {
          failed.push({ name: title, reason: error instanceof Error ? error.message : '导入失败' });
        }
      });
    } else {
      let zip: AdmZip;
      try {
        zip = new AdmZip(buffer);
      } catch {
        throw badRequest('无法解析 ZIP 文件');
      }
      const files = new Map<string, Buffer>();
      for (const entry of zip.getEntries() as any[]) {
        if (entry.isDirectory) continue;
        files.set(String(entry.entryName).replace(/\\/g, '/'), entry.getData());
      }
      const metaPaths = [...files.keys()].filter((name) => name === 'problem.json' || name.endsWith('/problem.json'));
      if (!metaPaths.length) throw badRequest('ZIP 里没有找到题目数据（problem.json）');
      if (metaPaths.length > MAX_IMPORT_ITEMS) throw badRequest(`一次最多导入 ${MAX_IMPORT_ITEMS} 道题目`);

      for (const metaPath of metaPaths.sort()) {
        const dir = metaPath.slice(0, metaPath.length - 'problem.json'.length);
        let meta: any = null;
        try {
          meta = JSON.parse(files.get(metaPath)!.toString('utf8'));
        } catch {
          failed.push({ name: metaPath, reason: 'problem.json 不是合法的 JSON' });
          continue;
        }
        const title = String(meta?.title ?? '').trim() || dir || '未命名题目';
        try {
          const recorded = Array.isArray(meta?.testcases) ? meta.testcases : [];
          const discovered = [...files.keys()]
            .filter((name) => name.startsWith(`${dir}testcases/`) && name.endsWith('.in'))
            .map((name) => Number(path.basename(name, '.in')))
            .filter((value) => Number.isInteger(value) && value > 0)
            .sort((a, b) => a - b);
          const indexes: number[] = recorded.length
            ? recorded.map((item: any) => Number(item?.idx)).filter((value: number) => Number.isInteger(value) && value > 0)
            : discovered;
          const metaByIdx = new Map<number, any>();
          for (const item of recorded) metaByIdx.set(Number(item?.idx), item);

          const testcases: TestcaseInput[] = [];
          for (const idx of [...new Set(indexes)].sort((a, b) => a - b)) {
            const item = metaByIdx.get(idx);
            const inputKey = `${dir}${String(item?.input ?? `testcases/${idx}.in`)}`;
            const outputKey = `${dir}${String(item?.output ?? `testcases/${idx}.out`)}`;
            const input = files.get(inputKey) ?? files.get(`${dir}testcases/${idx}.in`);
            const output = files.get(outputKey) ?? files.get(`${dir}testcases/${idx}.out`);
            if (!input && !output) continue;
            testcases.push({
              idx,
              subtask: Number(item?.subtask ?? 0) || 0,
              score: Number(item?.score ?? 10) || 10,
              isSample: Boolean(item?.isSample),
              input: input ? input.toString('utf8') : '',
              output: output ? output.toString('utf8') : '',
            });
          }

          const problemId = createProblem(request, {
            pid: String(meta?.pid ?? ''),
            title,
            background: meta?.background,
            statement: meta?.statement,
            inputFormat: meta?.inputFormat,
            outputFormat: meta?.outputFormat,
            hint: meta?.hint,
            provider: meta?.provider,
            difficulty: meta?.difficulty,
            timeLimit: meta?.timeLimit,
            memoryLimit: meta?.memoryLimit,
            judgeMode: meta?.judgeMode,
            compareMode: meta?.compareMode,
            spjLanguage: meta?.spjLanguage,
            spjCode: meta?.spjCode,
            interCode: meta?.interCode,
            subtasks: meta?.subtasks,
            samples: meta?.samples,
            allowLanguages: meta?.allowLanguages,
            isPublic: meta?.isPublic === undefined ? isPublic : isPublic && meta.isPublic !== false,
            tags: meta?.tags,
          });
          const saved = attachTestcases(problemId, testcases);
          const problem = get<{ pid: string }>('SELECT pid FROM problems WHERE id = ?', [problemId]);
          created.push({
            pid: String(problem?.pid ?? ''),
            title,
            testcases: saved,
            samples: Array.isArray(meta?.samples) ? meta.samples.length : 0,
            images: 0,
          });
        } catch (error) {
          failed.push({ name: title, reason: error instanceof Error ? error.message : '导入失败' });
        }
      }
    }

    if (created.length) {
      audit(request, 'problem.import', {
        detail: { format, count: created.length, failed: failed.length, source: filename },
      });
    }
    return { ok: true, format, created, failed, total: created.length };
  });
}
