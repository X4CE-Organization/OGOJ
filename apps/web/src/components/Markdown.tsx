import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { classNames } from '../lib/format';

export default function Markdown({
  children,
  className,
}: {
  children?: string | null;
  className?: string;
}) {
  const html = useMemo(() => renderMarkdown(children ?? ''), [children]);
  return (
    <div
      className={classNames('markdown', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
