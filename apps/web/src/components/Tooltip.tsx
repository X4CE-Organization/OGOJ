import { useRef, useState, type ReactNode } from 'react';
import { classNames } from '../lib/format';

type Side = 'top' | 'bottom' | 'left' | 'right';

const SIDE_STYLES: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
};

/**
 * Lightweight CSS tooltip: wraps any element and shows a label on hover/focus.
 * Native `title` tooltips are slow and easy to miss, so every icon-only button
 * in the header uses this instead.
 */
export default function Tooltip({
  label,
  description,
  side = 'bottom',
  children,
  className,
}: {
  label: string;
  description?: string;
  side?: Side;
  children: ReactNode;
  className?: string;
}) {
  const wrapper = useRef<HTMLSpanElement>(null);
  // After a click the pointer usually still rests on the icon, so the label
  // would stay visible even though the user already navigated. Suppress it
  // until the pointer leaves the icon again.
  const [dismissed, setDismissed] = useState(false);

  return (
    <span
      ref={wrapper}
      className={classNames('group/tip relative inline-flex', className)}
      onMouseLeave={() => setDismissed(false)}
      onClick={() => {
        setDismissed(true);
        // Links keep focus after being clicked, which used to keep the tooltip
        // open forever because the header stays mounted between routes.
        const active = document.activeElement as HTMLElement | null;
        if (active && wrapper.current?.contains(active)) active.blur();
      }}
    >
      {children}
      <span
        role="tooltip"
        className={classNames(
          'pointer-events-none absolute z-50 hidden w-max max-w-[16rem] flex-col gap-0.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-left text-xs leading-snug text-white shadow-lg dark:bg-slate-700',
          // Keyboard users still get the hint: Tab focuses the icon, which is a
          // `:focus-visible` focus, unlike the focus left behind by a click.
          !dismissed && 'group-hover/tip:flex group-has-[:focus-visible]/tip:flex',
          SIDE_STYLES[side],
        )}
      >
        <span className="font-medium">{label}</span>
        {description && <span className="text-[11px] font-normal text-slate-300">{description}</span>}
      </span>
    </span>
  );
}
