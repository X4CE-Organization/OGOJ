/**
 * 记住最近浏览过的题库地址（含筛选、页码、搜索词），
 * 这样从题目详情点「返回题库」能回到原来那一屏，而不是被重置。
 */
const PROBLEMS_KEY = 'ogoj:last-problems-url';

export function rememberProblemsUrl(url: string): void {
  try {
    sessionStorage.setItem(PROBLEMS_KEY, url);
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，忽略即可 */
  }
}

export function lastProblemsUrl(): string | null {
  try {
    return sessionStorage.getItem(PROBLEMS_KEY);
  } catch {
    return null;
  }
}
