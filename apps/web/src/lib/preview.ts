/** 列表里的纯文本预览：把表情/图片 markdown 换成人能看的短标记 */
export function plainPreview(text?: string | null, limit = 80): string {
  const source = String(text ?? '')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '[表情]')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return source.length > limit ? `${source.slice(0, limit)}…` : source;
}
