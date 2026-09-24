import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  classNames,
  difficultyColor,
  difficultyDarkColor,
  difficultyName,
  formatMemory,
  formatMs,
  initials,
  statusStyle,
} from '../lib/format';
import type { SiteUser } from '../lib/auth';
import { useAuth } from '../lib/auth';

export function Avatar({
  user,
  size = 32,
  className,
}: {
  user?: Partial<SiteUser> | null;
  size?: number;
  className?: string;
}) {
  const name = user?.display_name || user?.username || '';
  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt={name}
        style={{ width: size, height: size }}
        className={classNames('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.45) }}
      className={classNames(
        'flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function UserLink({
  user,
  showAvatar = true,
  size = 24,
  className,
}: {
  user?: Partial<SiteUser> | null;
  showAvatar?: boolean;
  size?: number;
  className?: string;
}) {
  if (!user?.username) return <span className="text-slate-400">未知用户</span>;
  // Staff highlighting is only shown to administrators: ordinary visitors must
  // not be able to tell which accounts are administrators.
  const { isAdmin } = useAuth();
  const roleColor =
    isAdmin && user.role === 'superadmin'
      ? 'text-rose-600 dark:text-rose-400 font-semibold'
      : isAdmin && user.role === 'admin'
        ? 'text-amber-600 dark:text-amber-400 font-semibold'
        : 'text-slate-700 dark:text-slate-200';
  return (
    <Link
      to={`/user/${encodeURIComponent(user.username)}`}
      className={classNames('inline-flex items-center gap-1.5 hover:underline', roleColor, className)}
    >
      {showAvatar && <Avatar user={user} size={size} />}
      <span>{user.display_name || user.username}</span>
    </Link>
  );
}

export function TagBadge({ tag }: { tag: { name: string; color?: string } }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs"
      style={{
        backgroundColor: `${tag.color ?? '#60a5fa'}22`,
        color: tag.color ?? '#60a5fa',
      }}
    >
      {tag.name}
    </span>
  );
}

export function DifficultyBadge({ value, compact = false }: { value: number; compact?: boolean }) {
  const color = difficultyColor(value);
  const darkColor = difficultyDarkColor(value);
  return (
    <span
      // 浅色模式下把文字色调深一点，保证小字号也有足够对比度；
      // 深色模式保持原色（深底浅字本来就清晰）。
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [background-color:color-mix(in_srgb,var(--difficulty)_14%,transparent)] [color:color-mix(in_srgb,var(--difficulty)_72%,black)] dark:[background-color:color-mix(in_srgb,var(--difficulty-dark)_18%,transparent)] dark:[color:var(--difficulty-dark)]"
      style={{ ['--difficulty' as string]: color, ['--difficulty-dark' as string]: darkColor }}
      title={difficultyName(value)}
    >
      {compact ? difficultyName(value) : `${value}. ${difficultyName(value)}`}
    </span>
  );
}

export function StatusText({ status, score }: { status: string; score?: number }) {
  const style = statusStyle(status);
  return (
    <span className={classNames('inline-flex items-center gap-1.5 text-sm', style.className)}>
      {style.label}
      {score !== undefined && score > 0 && status !== 'AC' ? (
        <span className="rounded bg-slate-100 px-1 text-xs text-slate-500 dark:bg-slate-800">{score}</span>
      ) : null}
    </span>
  );
}

export function SubmissionMeta({
  timeMs,
  memoryKb,
  className,
}: {
  timeMs?: number | null;
  memoryKb?: number | null;
  className?: string;
}) {
  return (
    <span className={classNames('text-xs text-slate-500', className)}>
      {formatMs(timeMs)} / {formatMemory(memoryKb)}
    </span>
  );
}

export function Loading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
      {label}
    </div>
  );
}

export function EmptyState({
  title = '暂无数据',
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames('flex flex-col items-center justify-center gap-2 py-14 text-center', className)}>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {description && <p className="max-w-md text-xs text-slate-400">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-sm text-rose-500">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, size)));
  if (pages <= 1) return null;
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const numbers: number[] = [];
  for (let i = start; i <= end; i += 1) numbers.push(i);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm">
      <span className="text-xs text-slate-500">
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost !px-2 !py-1"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </button>
        {start > 1 && <span className="px-1 text-slate-400">…</span>}
        {numbers.map((number) => (
          <button
            key={number}
            type="button"
            className={classNames(
              'btn !px-2.5 !py-1',
              number === page
                ? 'bg-primary text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
            )}
            onClick={() => onChange(number)}
          >
            {number}
          </button>
        ))}
        {end < pages && <span className="px-1 text-slate-400">…</span>}
        <button
          type="button"
          className="btn-ghost !px-2 !py-1"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-20">
      <div className={classNames('w-full rounded-xl bg-white shadow-xl dark:bg-slate-900', width)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 text-sm">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={classNames('card overflow-hidden', className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
          {action}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: ReactNode; badge?: ReactNode }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={classNames(
            '-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors',
            active === tab.key
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
          )}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge !== null && (
            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
