export const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  AC: { label: 'Accepted', className: 'text-emerald-600 dark:text-emerald-400 font-semibold' },
  WA: { label: 'Wrong Answer', className: 'text-rose-600 dark:text-rose-400' },
  TLE: { label: 'Time Limit Exceeded', className: 'text-orange-600 dark:text-orange-400' },
  MLE: { label: 'Memory Limit Exceeded', className: 'text-purple-600 dark:text-purple-400' },
  RE: { label: 'Runtime Error', className: 'text-yellow-700 dark:text-yellow-400' },
  CE: { label: 'Compile Error', className: 'text-amber-600 dark:text-amber-400' },
  OLE: { label: 'Output Limit Exceeded', className: 'text-teal-600 dark:text-teal-400' },
  PE: { label: 'Presentation Error', className: 'text-pink-600 dark:text-pink-400' },
  SE: { label: 'System Error', className: 'text-slate-500' },
  UKOE: { label: 'Unknown Error', className: 'text-slate-500' },
  Waiting: { label: 'Waiting', className: 'text-slate-500' },
  Judging: { label: 'Judging', className: 'text-sky-600 dark:text-sky-400 animate-pulse' },
};

export const LANGUAGE_NAMES: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  cpp14: 'C++14',
  cpp17: 'C++17',
  cpp20: 'C++20',
  python3: 'Python 3',
  pypy3: 'PyPy 3',
  java: 'Java',
  node: 'JavaScript',
  go: 'Go',
  rust: 'Rust',
};

export const DIFFICULTY_NAMES = [
  '入门',
  '普及−',
  '普及/提高−',
  '普及+/提高',
  '提高+/省选−',
  '省选/NOI−',
  'NOI/NOI+/CTSC',
];

export const DIFFICULTY_COLORS = [
  '#fe4c61',
  '#f39c11',
  '#ffc116',
  '#52c41a',
  '#3498db',
  '#9d3dcf',
  '#0e1d69',
];

export function statusStyle(status: string) {
  return STATUS_STYLES[status] ?? { label: status, className: 'text-slate-500' };
}

export function formatTime(value?: string | null, withSeconds = true): string {
  if (!value) return '-';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}${withSeconds ? `:${pad(date.getSeconds())}` : ''}`
  );
}

export function fromNow(value?: string | null): string {
  if (!value) return '-';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const target = new Date(normalized).getTime();
  if (Number.isNaN(target)) return '-';
  const diff = Date.now() - target;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? '前' : '后';
  if (abs < 60_000) return `${Math.max(1, Math.round(abs / 1000))} 秒${suffix}`;
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)} 分钟${suffix}`;
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)} 小时${suffix}`;
  if (abs < 2_592_000_000) return `${Math.floor(abs / 86_400_000)} 天${suffix}`;
  return `${Math.floor(abs / 2_592_000_000)} 个月${suffix}`;
}

function parseDate(value: string): number {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).getTime();
}

export function formatDuration(start: string, end: string): string {
  const minutes = Math.round((parseDate(end) - parseDate(start)) / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return rest ? `${days} 天 ${hours % 24} 小时` : `${days} 天`;
}

export function countdown(target: string): string {
  let diff = parseDate(target) - Date.now();
  if (diff <= 0) return '已结束';
  const days = Math.floor(diff / 86_400_000);
  diff %= 86_400_000;
  const hours = Math.floor(diff / 3_600_000);
  diff %= 3_600_000;
  const minutes = Math.floor(diff / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days > 0 ? `${days} 天 ` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatMemory(kb?: number | null): string {
  if (kb === null || kb === undefined) return '-';
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function formatMs(ms?: number | null): string {
  if (ms === null || ms === undefined) return '-';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function difficultyName(value: number): string {
  return DIFFICULTY_NAMES[Math.max(0, Math.min(6, (value || 1) - 1))]!;
}

export function difficultyColor(value: number): string {
  return DIFFICULTY_COLORS[Math.max(0, Math.min(6, (value || 1) - 1))]!;
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  return name.slice(0, 1).toUpperCase();
}

export function classNames(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
