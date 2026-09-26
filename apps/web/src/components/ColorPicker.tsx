import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { classNames } from '../lib/format';

/** 常用配色，够用又不刺眼 */
export const COLOR_PRESETS = [
  '#ef4444', '#f87171', '#fb923c', '#f97316',
  '#f59e0b', '#facc15', '#eab308', '#a3e635',
  '#84cc16', '#4ade80', '#22c55e', '#10b981',
  '#34d399', '#14b8a6', '#2dd4bf', '#06b6d4',
  '#22d3ee', '#38bdf8', '#0ea5e9', '#3b82f6',
  '#60a5fa', '#6366f1', '#818cf8', '#8b5cf6',
  '#a855f7', '#c084fc', '#d946ef', '#e879f9',
  '#ec4899', '#f472b6', '#f43f5e', '#94a3b8',
  '#64748b', '#475569', '#7c3aed', '#0e1d69',
  '#166534', '#7f1d1d', '#a16207', '#0f172a',
];

/**
 * 颜色面板：预设色块 + 取色器 + 应用 / 清除。
 * 点击触发按钮弹出，选好即回调 onChange(颜色或空字符串表示清除)。
 */
export default function ColorPicker({
  value,
  onChange,
  title = '选择颜色',
  clearable = false,
  children,
  className,
}: {
  value?: string;
  onChange: (color: string) => void;
  title?: string;
  clearable?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const current = (value || '').toLowerCase();

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const pick = (color: string) => {
    onChange(color);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className={classNames('relative inline-block', className)}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen((value) => !value)}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 dark:border-slate-600"
        style={current ? { backgroundColor: current } : undefined}
      >
        {children ?? (current ? null : <Palette className="h-3.5 w-3.5 text-slate-400" />)}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-300">{title}</div>
          <div className="grid grid-cols-8 gap-1">
            {COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => pick(color)}
                className="flex h-5 w-5 items-center justify-center rounded border border-black/5"
                style={{ backgroundColor: color }}
              >
                {current === color.toLowerCase() && <Check className="h-3 w-3 text-white" />}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="input !py-1 text-xs"
              value={value ?? ''}
              placeholder="自定义色值，如 #60a5fa"
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
          {clearable && (
            <button
              type="button"
              className="mt-2 text-xs text-slate-400 hover:text-rose-500"
              onClick={() => pick('')}
            >
              清除颜色
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 平铺的颜色板：给编辑弹窗用（预设色块 + 取色器 + 手填色值） */
export function ColorBoard({
  value,
  onChange,
  label,
  allowEmpty = false,
}: {
  value?: string;
  onChange: (color: string) => void;
  label?: string;
  allowEmpty?: boolean;
}) {
  const current = (value || '').toLowerCase();
  return (
    <div>
      {label && <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-300">{label}</div>}
      <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
        <div className="grid grid-cols-8 gap-1.5">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onClick={() => onChange(color)}
              className={classNames(
                'flex h-6 w-6 items-center justify-center rounded-md border transition',
                current === color.toLowerCase()
                  ? 'border-slate-500 ring-2 ring-slate-300 dark:border-slate-200 dark:ring-slate-600'
                  : 'border-black/5 hover:scale-110',
              )}
              style={{ backgroundColor: color }}
            >
              {current === color.toLowerCase() && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <input
            className="input !py-1.5 text-xs"
            value={value ?? ''}
            placeholder="也可以直接填色值，例如 #60a5fa"
            onChange={(event) => onChange(event.target.value)}
          />
          {allowEmpty && (
            <button
              type="button"
              className="shrink-0 text-xs text-slate-400 hover:text-rose-500"
              onClick={() => onChange('')}
            >
              跟随浅色
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
