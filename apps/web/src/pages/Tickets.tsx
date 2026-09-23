import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LifeBuoy, Plus, Star } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, fromNow } from '../lib/format';
import { EmptyState, Loading, Pagination, Section } from '../components/ui';

export const TICKET_STATUS: Record<string, { label: string; className: string }> = {
  open: { label: '待处理', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  processing: { label: '处理中', className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  replied: { label: '已回复', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300' },
  resolved: { label: '已解决', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  closed: { label: '已关闭', className: 'bg-slate-100 text-slate-500 dark:bg-slate-800' },
};

export const TICKET_PRIORITY: Record<string, { label: string; className: string }> = {
  low: { label: '低', className: 'text-slate-400' },
  normal: { label: '普通', className: 'text-slate-500' },
  high: { label: '高', className: 'text-orange-500' },
  urgent: { label: '紧急', className: 'text-rose-500 font-medium' },
};

export default function Tickets() {
  const { user, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? 'unfinished';
  const category = params.get('category') ?? '';
  const size = Number(settings.ticket_list_page_size ?? 20);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, metaInfo] = await Promise.all([
        api.get<any>(`/api/tickets${query({ page, size, status, category })}`),
        api.get<any>('/api/tickets/meta'),
      ]);
      setData(list);
      setMeta(metaInfo);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, size, status, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <LifeBuoy className="h-5 w-5 text-primary" /> 我的工单
        </h1>
        <Link to="/tickets/new" className="btn-primary !py-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> 提交工单
        </Link>
      </div>

      {meta?.notice && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {meta.notice}
        </div>
      )}

      {meta && Number(meta.maxOpen) > 0 && (
        <p className="text-xs text-slate-500">
          同时最多开启 {meta.maxOpen} 个未完成工单，当前 {meta.openCount} 个。
        </p>
      )}

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {[
          { value: 'unfinished', label: '未完成' },
          { value: 'all', label: '全部' },
          { value: 'resolved', label: '已解决' },
          { value: 'closed', label: '已关闭' },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => update({ status: item.value })}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              status === item.value
                ? 'bg-primary text-white'
                : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.label}
          </button>
        ))}
        <select
          className="input !w-44"
          value={category}
          onChange={(event) => update({ category: event.target.value })}
        >
          <option value="">全部分类</option>
          {(meta?.categories ?? []).map((item: any) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {data?.counts && (
          <span className="ml-auto text-xs text-slate-400">
            历史工单 {data.counts.mine} 个 · 待处理 {data.counts.open} · 处理中 {data.counts.processing}
          </span>
        )}
      </div>

      <Section title="工单列表">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState
            title="还没有工单"
            description="遇到题目数据错误、账号问题或想提建议？提交一个工单吧"
            action={
              <Link to="/tickets/new" className="btn-primary mt-2">
                提交工单
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.items.map((ticket: any) => (
              <li key={ticket.id}>
                <Link
                  to={`/tickets/${ticket.id}`}
                  className={classNames(
                    'flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40',
                    ticket.unreadForUser && 'bg-primary/[0.04]',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{ticket.ticketNo}</span>
                      <span className={classNames('rounded px-1.5 py-0.5 text-xs', TICKET_STATUS[ticket.status]?.className)}>
                        {TICKET_STATUS[ticket.status]?.label ?? ticket.status}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                        {ticket.categoryLabel}
                      </span>
                      <span className={classNames('text-xs', TICKET_PRIORITY[ticket.priority]?.className)}>
                        {TICKET_PRIORITY[ticket.priority]?.label ?? ticket.priority}
                      </span>
                      {ticket.isEscalated && (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
                          已升级
                        </span>
                      )}
                      {ticket.unreadForUser && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                    <div className="mt-1 truncate font-medium">{ticket.title}</div>
                    {ticket.relatedLabel && (
                      <div className="mt-0.5 text-[11px] text-slate-400">关联：{ticket.relatedLabel}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                      <span>提交于 {fromNow(ticket.createdAt)}</span>
                      <span>{ticket.replyCount} 条回复</span>
                      {ticket.assignee && <span>处理人：{ticket.assignee.display_name || ticket.assignee.username}</span>}
                      {ticket.rating ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-500">
                          {Array.from({ length: ticket.rating }).map((_, index) => (
                            <Star key={index} className="h-3 w-3 fill-amber-400" />
                          ))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} size={size} total={data?.total ?? 0} onChange={(next) => update({ page: next })} />
      </Section>

      <p className="text-center text-xs text-slate-400">
        提交工单需要登录（当前：{user?.username ?? '未登录'}）。也可以在帮助中心找到常见问题答案。
      </p>
    </div>
  );
}
