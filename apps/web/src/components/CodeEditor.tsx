import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';

function languageExtension(editor: string): Extension {
  switch (editor) {
    case 'cpp':
    case 'c':
      return cpp();
    case 'python':
      return python();
    case 'java':
      return java();
    case 'javascript':
      return javascript();
    case 'go':
      return go();
    case 'rust':
      return rust();
    default:
      return [];
  }
}

export default function CodeEditor({
  value,
  onChange,
  language = 'cpp',
  readOnly = false,
  height = '320px',
}: {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  height?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!container.current) return undefined;
    const dark = document.documentElement.classList.contains('dark');
    const state = EditorState.create({
      doc: value,
      extensions: [
        // 代码缩进统一为 4 个空格（Tab 与回车自动缩进都用它），
        // 必须放在 basicSetup 前面，因为 indentUnit / tabSize 取第一个值。
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        basicSetup,
        keymap.of([indentWithTab]),
        languageExtension(language),
        EditorView.lineWrapping,
        dark ? oneDark : [],
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    const editor = new EditorView({ state, parent: container.current });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Intentionally re-create when the language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={container}
      className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
      style={{ height }}
    />
  );
}
