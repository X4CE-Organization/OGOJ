import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { classNames } from '../lib/format';
import { lastListUrl, type ListKey } from '../lib/nav';

/**
 * 详情页通用的返回按钮。
 * 传 listKey 时优先回到该列表页最近浏览的那一屏（保留筛选与页码），
 * 没有记录时回退到 fallback；useHistory 为真时直接按浏览器历史返回。
 */
export default function BackButton({
  label,
  fallback,
  listKey,
  useHistory = false,
  className,
}: {
  label: string;
  fallback: string;
  listKey?: ListKey;
  useHistory?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();

  const go = () => {
    if (useHistory) {
      if (window.history.length > 1) {
        navigate(-1);
        return;
      }
      navigate(fallback);
      return;
    }
    navigate((listKey ? lastListUrl(listKey) : null) ?? fallback);
  };

  return (
    <button
      type="button"
      title={label}
      onClick={go}
      className={classNames(
        'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 transition hover:border-primary/40 hover:text-primary dark:border-slate-700',
        className,
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
