/**
 * 记住各个列表页最近一次浏览的地址（含筛选、排序、页码、搜索词），
 * 详情页的「返回」按钮就能回到原来那一屏，而不是被重置。
 */
export type ListKey =
  | 'problems'
  | 'records'
  | 'contests'
  | 'training'
  | 'discussions'
  | 'articles'
  | 'tickets'
  | 'teams';

const keyOf = (key: ListKey) => `ogoj:list-url:${key}`;

export function rememberListUrl(key: ListKey, url: string): void {
  try {
    sessionStorage.setItem(keyOf(key), url);
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，忽略即可 */
  }
}

export function lastListUrl(key: ListKey): string | null {
  try {
    return sessionStorage.getItem(keyOf(key));
  } catch {
    return null;
  }
}
