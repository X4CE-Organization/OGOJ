import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailOpen } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, formatTime, fromNow } from '../lib/format';
import { EmptyState, Loading, Pagination } from '../components/ui';
import { useToast } from '../components/Toast';

export default function Messages() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(`/api/messages${query({ page, size: 20, unread: unreadOnly ? 'true' : '' })}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (message: any) => {
    try {
      const result = await api.get<any>(`/api/messages/${message.id}`);
      setSelected(result.message);
      void load();
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开失败');
    }
  };

  const readAll = async () => {
    await api.post('/api/messages/read-all');
    toast.success('全部标记为已读');
    void load();
    void refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          站内信 {data ? <span className="text-sm text-slate-400">（{data.unread} 封未读）</span> : null}
        </h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
            只看未读
          </label>
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={readAll}>
            <MailOpen className="h-3.5 w-3.5" /> 全部已读
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有消息" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.items.map((message: any) => (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => open(message)}
                  className={classNames(
                    'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40',
                    !message.is_read && 'bg-primary/[0.04]',
                  )}
                >
                  <span
                    className={classNames(
                      'mt-1 h-2 w-2 shrink-0 rounded-full',
                      message.is_read ? 'bg-transparent' : 'bg-primary',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={classNames('truncate', !message.is_read && 'font-semibold')}>
                        {message.title}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-slate-400">{fromNow(message.created_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{message.content}</p>
                    <div className="mt-1 text-[11px] text-slate-400">
                      来自 {message.from_username ?? '系统'}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} size={20} total={data?.total ?? 0} onChange={setPage} />
      </div>

      {selected && (
        <div className="card p-5">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold">{selected.title}</h2>
            <button type="button" className="text-slate-400" onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">{formatTime(selected.created_at)}</p>
          <div className="mt-3 whitespace-pre-wrap text-sm">{selected.content}</div>
          {selected.ref_type === 'discussion' && selected.ref_id && (
            <Link to={`/discussion/${selected.ref_id}`} className="btn-ghost mt-4 !py-1.5 text-xs">
              查看原帖
            </Link>
          )}
          {selected.ref_type === 'submission' && selected.ref_id && (
            <Link to={`/record/${selected.ref_id}`} className="btn-ghost mt-4 !py-1.5 text-xs">
              查看评测记录
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
