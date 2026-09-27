/** 在文本框光标处插入内容（表情包、代码片段等），并把光标移到插入内容之后 */
export function insertAtCursor(
  element: HTMLTextAreaElement | HTMLInputElement | null,
  text: string,
  setValue: (value: string) => void,
): void {
  if (!element) {
    setValue(text);
    return;
  }
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  const next = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
  setValue(next);
  requestAnimationFrame(() => {
    element.focus();
    const position = start + text.length;
    try {
      element.setSelectionRange(position, position);
    } catch {
      /* 某些输入类型不支持选区，忽略 */
    }
  });
}

/** 取表情在正文里的 markdown（正文渲染时按表情尺寸显示） */
export function stickerMarkdown(sticker: { name?: string; url: string }): string {
  const name = (sticker.name || '表情').replace(/[[\]]/g, '');
  return `![${name}](${sticker.url})`;
}
