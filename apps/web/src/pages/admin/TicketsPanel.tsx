import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Star, UserCheck } from 'lucide-react';
import { api, query } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, fromNow } from '../../lib/format';
import { EmptyState, Loading, Pagination, Section, UserLink } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { TICKET_PRIORITY, TICKET_STATUS } from '../Tickets';

export default function TicketsPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: 'unfinished', category: '', priority: '', assignee: '', q: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, metaInfo] = await Promise.all([
        api.get<any>(`/api/admin/tickets${query({ page, size: 20, ...filters })}`),
        api.get<any>('/api/tickets/meta'),
      ]);
      setData(list);
      setMeta(metaInfo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const setFilter = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const assignMe = async (ticket: any) => {
    try {
      await api.post(`/api/admin/tickets/${ticket.id}/assign-me`);
      toast.success('已受理该工单');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const quickStatus = async (ticket: any, status: string) => {
    try {
      await api.put(`/api/admin/tickets/${ticket.id}`, { status });
      toast.success('状态已更新');
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const escalate = async (ticket: any) => {
    try {
      await api.put(`/api/admin/tickets/${ticket.id}`, { isEscalated: !ticket.isEscalated });
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">工单管理</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">按未读优先排序，点击工单进入处理页面</span>
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </button>
        </div>
      </div>

      {data?.stats && (
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: '待处理', value: data.stats.open, tone: 'text-amber-500' },
            { label: '处理中', value: data.stats.processing, tone: 'text-sky-500' },
            { label: '已回复', value: data.stats.replied, tone: 'text-cyan-500' },
            { label: '未读', value: data.stats.unread, tone: 'text-rose-500' },
            { label: '今日新增', value: data.stats.today, tone: 'text-primary' },
            {
              label: '平均评分',
              value: data.stats.avgRating ? `${data.stats.avgRating} / 5` : '暂无',
              tone: 'text-amber-500',
            },
          ].map((item) => (
            <div key={item.label} className="card p-4">
              <div className="text-xs text-slate-400">{item.label}</div>
              <div className={classNames('mt-1 text-xl font-semibold', item.tone)}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <select className="input !w-32" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
          <option value="unfinished">未完成</option>
          <option value="all">全部</option>
          <option value="open">待处理</option>
          <option value="processing">处理中</option>
          <option value="replied">已回复</option>
          <option value="resolved">已解决</option>
          <option value="closed">已关闭</option>
        </select>
        <select className="input !w-40" value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
          <option value="">全部分类</option>
          {(meta?.categories ?? []).map((item: any) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select className="input !w-28" value={filters.priority} onChange={(e) => setFilter({ priority: e.target.value })}>
          <option value="">全部优先级</option>
          <option value="urgent">紧急</option>
          <option value="high">高</option>
          <option value="normal">普通</option>
          <option value="low">低</option>
        </select>
        <select className="input !w-32" value={filters.assignee} onChange={(e) => setFilter({ assignee: e.target.value })}>
          <option value="">全部处理人</option>
          <option value="me">我处理的</option>
          <option value="none">未分配</option>
        </select>
        <input
          className="input !w-56"
          placeholder="搜索编号 / 标题 / 用户"
          value={filters.q}
          onChange={(e) => setFilter({ q: e.target.value })}
        />
        {data?.stats?.byCategory?.length ? (
          <span className="ml-auto flex flex-wrap gap-1.5 text-[11px] text-slate-400">
            {data.stats.byCategory.map((item: any) => (
              <span key={item.category} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                {item.label} {item.c}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <Section title="工单列表">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="没有符合条件的工单" description="所有工单都处理完了，辛苦啦！" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-36">编号</th>
                  <th>工单</th>
                  <th className="w-36">提交者</th>
                  <th className="w-24">分类</th>
                  <th className="w-24">优先级</th>
                  <th className="w-28">状态</th>
                  <th className="w-32">处理人</th>
                  <th className="w-28">最近活动</th>
                  <th className="w-56">快捷操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((ticket: any) => (
                  <tr key={ticket.id} className={classNames(ticket.unreadForAdmin && 'bg-primary/[0.04]')}>
                    <td>
                      <Link to={`/tickets/${ticket.id}`} className="link font-mono text-xs">
                        {ticket.ticketNo}
                      </Link>
                      {ticket.unreadForAdmin && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-rose-500" />}
                    </td>
                    <td>
                      <Link to={`/tickets/${ticket.id}`} className="hover:text-primary">
                        {ticket.isEscalated && (
                          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-rose-500" />
                        )}
                        {ticket.title}
                      </Link>
                      <div className="text-[11px] text-slate-400">
                        {ticket.replyCount} 条回复
                        {ticket.relatedLabel ? ` · 关联 ${ticket.relatedLabel}` : ''}
                        {ticket.rating ? ` · 评价 ${ticket.rating} 星` : ''}
                      </div>
                    </td>
                    <td>
                      <UserLink user={ticket.user} size={20} />
                    </td>
                    <td className="text-xs">{ticket.categoryLabel}</td>
                    <td className={classNames('text-xs', TICKET_PRIORITY[ticket.priority]?.className)}>
                      {TICKET_PRIORITY[ticket.priority]?.label ?? ticket.priority}
                    </td>
                    <td>
                      <span className={classNames('rounded px-1.5 py-0.5 text-xs', TICKET_STATUS[ticket.status]?.className)}>
                        {TICKET_STATUS[ticket.status]?.label ?? ticket.status}
                      </span>
                    </td>
                    <td className="text-xs">
                      {ticket.assignee ? ticket.assignee.display_name || ticket.assignee.username : '未分配'}
                    </td>
                    <td className="text-xs text-slate-400">{fromNow(ticket.lastReplyAt ?? ticket.createdAt)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {(!ticket.assignee || ticket.assignee.id !== user?.id) && (
                          <button type="button" className="text-primary hover:underline" onClick={() => assignMe(ticket)}>
                            <UserCheck className="mr-0.5 inline h-3.5 w-3.5" />
                            受理
                          </button>
                        )}
                        {ticket.status !== 'resolved' && (
                          <button
                            type="button"
                            className="text-emerald-600 hover:underline"
                            onClick={() => quickStatus(ticket, 'resolved')}
                          >
                            标记解决
                          </button>
                        )}
                        {ticket.status !== 'closed' && (
                          <button
                            type="button"
                            className="text-slate-500 hover:underline"
                            onClick={() => quickStatus(ticket, 'closed')}
                          >
                            关闭
                          </button>
                        )}
                        <button
                          type="button"
                          className={classNames('hover:underline', ticket.isEscalated ? 'text-slate-500' : 'text-rose-500')}
                          onClick={() => escalate(ticket)}
                        >
                          {ticket.isEscalated ? '取消升级' : '升级'}
                        </button>
                        <Link to={`/tickets/${ticket.id}`} className="text-primary hover:underline">
                          处理
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} size={20} total={data?.total ?? 0} onChange={setPage} />
      </Section>

      <Section title="处理说明">
        <ul className="list-disc space-y-1 p-4 pl-8 text-xs text-slate-500">
          <li>用户提交或回复工单后，工单会自动回到「待处理」并标记未读，顶部工单图标会出现红点。</li>
          <li>在工单详情页可以回复用户、写内部备注（用户不可见）、修改状态与优先级、指派给自己。</li>
          <li>标记为「已解决」后用户会收到站内信并可以评价处理结果；超管可以在系统设置中配置自动关闭天数。</li>
          <li>删除工单仅超级管理员可用，删除后不可恢复。</li>
        </ul>
      </Section>
    </div>
  );
}
