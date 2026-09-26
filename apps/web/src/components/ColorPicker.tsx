import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { classNames } from '../lib/format';

/* -------------------------------------------------------------- 颜色换算 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): [number, number, number] {
  let value = String(hex || '').trim().replace(/^#/, '');
  if (value.length === 3) value = value.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return [96, 165, 250];
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** [h 0-360, s 0-100, l 0-100] */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, Math.round(l * 100)];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  if (sn === 0) {
    const v = ln * 255;
    return [v, v, v];
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const channel = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return [channel(hn + 1 / 3) * 255, channel(hn) * 255, channel(hn - 1 / 3) * 255];
}

const HUE_GRADIENT =
  'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';

/** 自绘滑块：支持点击定位与按住拖动（用指针事件，比原生 range 更可控） */
function TrackSlider({
  value,
  min,
  max,
  background,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  background: string;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const percent = clamp(((value - min) / Math.max(1, max - min)) * 100, 0, 100);

  const valueFromX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    onChange(Math.round(min + ratio * (max - min)));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className="relative h-4 cursor-pointer select-none rounded-full border border-slate-200 dark:border-slate-600"
      style={{ background }}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        valueFromX(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) valueFromX(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <span
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white bg-white shadow"
        style={{ left: `calc(${percent}% - 7px)` }}
      />
    </div>
  );
}

/** 取色器：预设色 + 色相 / 饱和度 / 亮度滑块 + 色值输入 */
function ColorControls({
  value,
  onChange,
}: {
  value?: string;
  onChange: (color: string) => void;
}) {
  const hex = String(value || '#60a5fa').trim();
  const [hsl, setHsl] = useState<[number, number, number]>(() => rgbToHsl(...hexToRgb(hex)));

  // 外部换了颜色（点预设色块 / 输入色值）时同步滑块位置
  const normalized = useMemo(() => rgbToHex(...hexToRgb(hex)), [hex]);
  useEffect(() => {
    const [r, g, b] = hexToRgb(normalized);
    setHsl(rgbToHsl(r, g, b));
  }, [normalized]);

  const emit = (next: [number, number, number]) => {
    setHsl(next);
    onChange(rgbToHex(...hslToRgb(next[0], next[1], next[2])));
  };

  const [h, s, l] = hsl;
  const pureHex = rgbToHex(...hslToRgb(h, 100, 50));
  const midHex = rgbToHex(...hslToRgb(h, s, 50));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-8 gap-1">
        {COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            onClick={() => onChange(color)}
            className={classNames(
              'flex h-5 w-5 items-center justify-center rounded border',
              normalized.toLowerCase() === color.toLowerCase()
                ? 'border-slate-500 ring-2 ring-slate-300 dark:border-slate-200 dark:ring-slate-600'
                : 'border-black/5 hover:scale-110',
            )}
            style={{ backgroundColor: color }}
          >
            {normalized.toLowerCase() === color.toLowerCase() && <Check className="h-3 w-3 text-white drop-shadow" />}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>色相</span>
          <span>{h}°</span>
        </div>
        <TrackSlider value={h} min={0} max={360} background={HUE_GRADIENT} onChange={(value) => emit([value, s, l])} />
      </div>

      <div>
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>饱和度</span>
          <span>{s}%</span>
        </div>
        <TrackSlider
          value={s}
          min={0}
          max={100}
          background={`linear-gradient(to right, #d1d5db, ${pureHex})`}
          onChange={(value) => emit([h, value, l])}
        />
      </div>

      <div>
        <div className="mb-0.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>明暗</span>
          <span>{l}%</span>
        </div>
        <TrackSlider
          value={l}
          min={0}
          max={100}
          background={`linear-gradient(to right, #000000, ${midHex}, #ffffff)`}
          onChange={(value) => emit([h, s, value])}
        />
      </div>

      <div className="flex items-center gap-2">
        <span
          className="h-6 w-6 shrink-0 rounded border border-slate-200 dark:border-slate-600"
          style={{ backgroundColor: normalized }}
        />
        <input
          className="input !py-1 text-xs"
          value={value ?? ''}
          placeholder="#60a5fa"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>

      {/* 想要系统取色器（吸管、渐变、最近使用）就用这个 */}
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400 hover:text-primary">
        <input
          type="color"
          value={normalized}
          className="h-5 w-10 cursor-pointer rounded border border-slate-200 bg-transparent p-0 dark:border-slate-600"
          onChange={(event) => onChange(event.target.value)}
        />
        系统取色器
      </label>
    </div>
  );
}

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** 浮层用 fixed 定位，避免被侧边栏、卡片 overflow 等盖住或裁掉 */
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const current = (value || '').toLowerCase();

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 272;
    const height = 420;
    const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8));
    const top = rect.bottom + 6 + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6;
    setPosition({ top, left });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onReflow = () => place();
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  const pick = (color: string) => {
    onChange(color);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className={classNames('relative inline-block', className)}>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          place();
          setOpen(true);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 dark:border-slate-600"
        style={current ? { backgroundColor: current } : undefined}
      >
        {children ?? (current ? null : <Palette className="h-3.5 w-3.5 text-slate-400" />)}
      </button>

      {open && (
        <div
          className="fixed z-[999] w-[272px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800"
          style={position ? { top: position.top, left: position.left } : undefined}
        >
          <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-300">{title}</div>
          <ColorControls value={value} onChange={onChange} />
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
        <ColorControls value={value} onChange={onChange} />
        {allowEmpty && (
          <button
            type="button"
            className="mt-2 text-xs text-slate-400 hover:text-rose-500"
            onClick={() => onChange('')}
          >
            跟随浅色
          </button>
        )}
      </div>
    </div>
  );
}
