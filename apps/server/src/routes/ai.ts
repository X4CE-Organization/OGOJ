/**
 * 控制面板 → 题目页的 AI 助手（DeepSeek）。
 *
 * 超管在「系统设置 → AI 助手」里填 API Key；普通管理员在题目编辑页就能
 * 一键生成参考代码 / 测试数据。只调用 DeepSeek 官方的 chat/completions 接口，
 * Key 只存在数据库里，永远不会下发给浏览器。
 */
import type { FastifyInstance } from 'fastify';
import { get } from '../db/index.js';
import { requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parseId } from '../lib/util.js';
import { str } from '../settings/index.js';

const DEFAULT_BASE = 'https://api.deepseek.com';
const MAX_STATEMENT = 12000;
const MAX_TEST_BYTES = 200_000;

type ChatMessage = { role: 'system' | 'user'; content: string };

async function callDeepSeek(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const key = str('deepseek_api_key', '').trim();
  if (!key) throw badRequest('还没有配置 DeepSeek API Key，请先到 系统设置 → AI 助手 填写并保存');
  const base = (str('deepseek_base_url', DEFAULT_BASE) || DEFAULT_BASE).replace(/\/+$/, '');
  const model = str('deepseek_model', 'deepseek-chat') || 'deepseek-chat';
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    throw badRequest(`连接 DeepSeek 失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw badRequest(`DeepSeek 返回 ${res.status}：${text.slice(0, 300) || res.statusText}`);
  }
  const data = (await res.json().catch(() => null)) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw badRequest('DeepSeek 没有返回内容');
  return String(content);
}

/** 从回复里取出 ```cpp 代码块，没有代码块就当作纯代码 */
function extractCode(reply: string): string {
  const fenced = reply.match(/```(?:cpp|c\+\+|cxx|c)?\s*\n([\s\S]*?)```/i);
  return (fenced ? fenced[1] : reply).trim();
}

/** 从回复里解析 JSON 数组；模型偶尔会包代码块或写解释，这里尽量容错 */
function parseTests(reply: string): { input: string; output: string }[] {
  const fenced = reply.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : reply).trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw badRequest('DeepSeek 返回的不是 JSON 数组，请重试');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw badRequest('DeepSeek 返回的 JSON 无法解析，请重试');
  }
  if (!Array.isArray(raw)) throw badRequest('DeepSeek 返回的不是数组');
  const tests = raw
    .map((item: any) => ({
      input: String(item?.input ?? ''),
      output: String(item?.output ?? ''),
    }))
    .filter((item) => item.input.length <= MAX_TEST_BYTES && item.output.length <= MAX_TEST_BYTES);
  if (!tests.length) throw badRequest('DeepSeek 没有返回可用的测试数据');
  return tests;
}

async function loadProblem(id: number) {
  const problem = await get<any>('SELECT * FROM problems WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!problem) throw notFound('题目不存在');
  return problem;
}

function statementOf(problem: any): string {
  return [
    problem.statement,
    problem.input_format ? `输入格式：${problem.input_format}` : '',
    problem.output_format ? `输出格式：${problem.output_format}` : '',
    problem.hint ? `提示：${problem.hint}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_STATEMENT);
}

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/ai/status', async (request) => {
    await requireAdmin(request);
    return {
      configured: Boolean(str('deepseek_api_key', '').trim()),
      model: str('deepseek_model', 'deepseek-chat') || 'deepseek-chat',
    };
  });

  app.post('/api/admin/ai/code', async (request) => {
    await requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const id = parseId(body.problemId);
    const problem = await loadProblem(id);
    const reply = await callDeepSeek(
      [
        {
          role: 'system',
          content:
            '你是信息学竞赛教练。只输出一份完整、可编译的 C++17 标准程序：从标准输入读取数据，向标准输出写答案。'
            + '不要输出解释、测试用例或多余文字，用 ```cpp 代码块包住代码。',
        },
        { role: 'user', content: `题目：${problem.title}\n\n${statementOf(problem)}\n\n请给出正确解法。` },
      ],
      4096,
    );
    const code = extractCode(reply);
    await audit(request, 'admin.ai_code', { targetType: 'problem', targetId: id, detail: { model: str('deepseek_model', 'deepseek-chat') } });
    return { code, model: str('deepseek_model', 'deepseek-chat') || 'deepseek-chat' };
  });

  app.post('/api/admin/ai/tests', async (request) => {
    await requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const id = parseId(body.problemId);
    const count = Math.min(20, Math.max(1, Number(body.count) || 5));
    const problem = await loadProblem(id);
    const reply = await callDeepSeek(
      [
        {
          role: 'system',
          content:
            '你是信息学竞赛出题人。请根据题目生成测试数据，严格只输出一个 JSON 数组，不要解释、不要代码块以外的文字。'
            + '数组每一项是 {"input": "...", "output": "..."}，input/output 都是程序从标准输入读取/向标准输出写的完整文本，'
            + '必须满足题面给出的数据范围和输入格式，答案必须正确。',
        },
        {
          role: 'user',
          content: `题目：${problem.title}\n\n${statementOf(problem)}\n\n请生成 ${count} 组测试数据，包含样例、边界情况和随机数据。`,
        },
      ],
      8192,
    );
    const tests = parseTests(reply);
    await audit(request, 'admin.ai_tests', { targetType: 'problem', targetId: id, detail: { count: tests.length } });
    return { tests };
  });
}
