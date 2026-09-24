/**
 * 每道题的代码草稿（尚未提交的代码）保存在浏览器本地，
 * 这样离开题目页再回来、甚至关掉浏览器再打开，编辑器里还是你写的内容。
 *
 * 草稿按「用户 + 题目」隔离；提交成功后由调用方清除。
 */
const PREFIX = 'ogoj-draft';
const MAX_DRAFTS = 40;
const MAX_CODE_BYTES = 256 * 1024;

export interface CodeDraft {
  code: string;
  language: string;
  updatedAt: number;
}

function key(userId: number | string | null | undefined, problemId: number | string): string {
  return `${PREFIX}:${userId ?? 'guest'}:${problemId}`;
}

function readStore(): Record<string, CodeDraft> {
  try {
    const raw = localStorage.getItem(PREFIX);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? (parsed as Record<string, CodeDraft>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, CodeDraft>): void {
  try {
    // 只保留最近的若干份草稿，避免把 localStorage 撑满
    const entries = Object.entries(store).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const trimmed = Object.fromEntries(entries.slice(0, MAX_DRAFTS));
    localStorage.setItem(PREFIX, JSON.stringify(trimmed));
  } catch {
    /* 隐私模式或空间不足时忽略 */
  }
}

export function loadDraft(userId: number | null | undefined, problemId: number): CodeDraft | null {
  const store = readStore();
  const draft = store[key(userId, problemId)];
  return draft && typeof draft.code === 'string' ? draft : null;
}

export function saveDraft(
  userId: number | null | undefined,
  problemId: number,
  draft: { code: string; language: string },
): void {
  if (!draft.code.trim()) {
    clearDraft(userId, problemId);
    return;
  }
  if (new Blob([draft.code]).size > MAX_CODE_BYTES) return;
  const store = readStore();
  store[key(userId, problemId)] = { code: draft.code, language: draft.language, updatedAt: Date.now() };
  writeStore(store);
}

export function clearDraft(userId: number | null | undefined, problemId: number): void {
  const store = readStore();
  delete store[key(userId, problemId)];
  writeStore(store);
}
