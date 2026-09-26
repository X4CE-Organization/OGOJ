/** 自动创建的标签按名称散列取色，避免一屏标签全是一个蓝色 */
export const TAG_PALETTE = [
  '#60a5fa',
  '#38bdf8',
  '#22d3ee',
  '#2dd4bf',
  '#34d399',
  '#a3e635',
  '#facc15',
  '#fb923c',
  '#f472b6',
  '#e879f9',
  '#a78bfa',
  '#818cf8',
  '#f87171',
  '#94a3b8',
  '#4ade80',
  '#0ea5e9',
];

export function autoTagColor(name: string): string {
  let hash = 0;
  for (const ch of String(name ?? '')) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length]!;
}
