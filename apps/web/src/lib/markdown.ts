import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

const PLACEHOLDER = '@@OGOJ_MATH_';

interface Formula {
  tex: string;
  display: boolean;
}

function extractMath(text: string): { source: string; formulas: Formula[] } {
  const formulas: Formula[] = [];
  const push = (tex: string, display: boolean): string => {
    formulas.push({ tex: tex.trim(), display });
    return `${PLACEHOLDER}${formulas.length - 1}@@`;
  };
  let source = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => push(tex, true));
  source = source.replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => push(tex, true));
  source = source.replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => push(tex, false));
  source = source.replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => push(tex, false));
  return { source, formulas };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function restoreMath(html: string, formulas: Formula[]): string {
  let output = html;
  formulas.forEach((formula, index) => {
    let rendered: string;
    try {
      rendered = katex.renderToString(formula.tex, {
        displayMode: formula.display,
        throwOnError: false,
        strict: false,
        trust: false,
        output: 'html',
      });
    } catch {
      rendered = `<code>${escapeHtml(formula.tex)}</code>`;
    }
    const token = `${PLACEHOLDER}${index}@@`;
    output = output.replaceAll(`<p>${token}</p>`, rendered).replaceAll(token, rendered);
  });
  return output;
}

/** Render markdown with KaTeX support and sanitise the result. */
export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  const { source, formulas } = extractMath(text);
  const raw = marked.parse(source, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button'],
  });
  const withLinks = clean.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer nofollow" ');
  return restoreMath(withLinks, formulas);
}

export function stripMarkdown(text: string | null | undefined, length = 160): string {
  if (!text) return '';
  const plain = text
    .replace(/\$\$[\s\S]+?\$\$/g, ' [公式] ')
    .replace(/`[^`]*`/g, '')
    .replace(/[#>*_\-[\]()!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}
