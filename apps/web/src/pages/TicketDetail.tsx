import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Info, Lock, Star, Trash2, UserCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, formatTime, fromNow } from '../lib/format';
import { Avatar, EmptyState, Loading, Section } from '../components/ui';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';
import { TICKET_PRIORITY, TICKET_STATUS } from './Tickets';

export default function TicketDetail() {
  const { id = '' } = useParams();
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [rating, setRating] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/tickets/${id}`);
      setData(result);
      setRating(result.ticket.rating ?? 5);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReply = async () => {
    if (!reply.trim()) {
      toast.error('回复内容不能为空');
      return;
    }
    setSending(true);
    try {
      await api.post(`/api/tickets/${id}/replies`, { content: reply, isInternal: internal });
      setReply('');
      setInternal(false);
      await load();
      toast.success('回复已发送');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status: string, note?: string) => {
    try {
      await api.post(`/api/tickets/${id}/status`, { status, note });
      await load();
      toast.success('状态已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const assignMe = async () => {
    try {
      await api.post(`/api/admin/tickets/${id}/assign-me`);
      await load();
      toast.success('已受理，工单转入处理中');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const setPriority = async (priority: string) => {
    try {
      await api.put(`/api/admin/tickets/${id}`, { priority });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const toggleEscalate = async () => {
    try {
      await api.put(`/api/admin/tickets/${id}`, { isEscalated: !data.ticket.isEscalated });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const submitRating = async () => {
    try {
      await api.post(`/api/tickets/${id}/rating`, { rating, comment: ratingComment });
      toast.success('感谢你的评价！');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '评价失败');
    }
  };

  const remove = async () => {
    if (!window.confirm('确定删除该工单吗？此操作不可恢复。')) return;
    try {
      await api.del(`/api/admin/tickets/${id}`);
      toast.success('工单已删除');
      navigate('/admin/tickets');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="工单不存在或你无权查看" />;

  const ticket = data.ticket;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <Link to={isAdmin && ticket.canManage ? '/admin/tickets' : '/tickets'} className="text-xs text-primary hover:underline">
          <ArrowLeft className="mr-0.5 inline h-3.5 w-3.5" />
          {isAdmin && ticket.canManage ? '返回工单管理' : '返回我的工单'}
        </Link>
        {isSuperAdmin && <button type="button" className="text-xs text-rose-500 hover:underline" onClick={remove}>
          <Trash2 className="mr-0.5 inline h-3.5 w-3.5" />
          删除工单
        </button>}
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-slate-400">{ticket.ticketNo}</span>
              <span className={classNames('rounded px-1.5 py-0.5', TICKET_STATUS[ticket.status]?.className)}>
                {TICKET_STATUS[ticket.status]?.label ?? ticket.status}
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-slate-800">
                {ticket.categoryLabel}
              </span>
              <span className={classNames(TICKET_PRIORITY[ticket.priority]?.className)}>
                优先级：{TICKET_PRIORITY[ticket.priority]?.label ?? ticket.priority}
              </span>
              {ticket.isEscalated && (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
                  已升级
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-bold">{ticket.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Avatar user={ticket.user} size={20} />
                {ticket.user.display_name || ticket.user.username}
              </span>
              <span>提交于 {formatTime(ticket.createdAt)}</span>
              {ticket.assignee && (
                <span className="inline-flex items-center gap-1 text-primary">
                  <UserCheck className="h-3 w-3" />
                  {isAdmin ? `处理人 ${ticket.assignee.display_name || ticket.assignee.username}` : '已由管理员受理'}
                </span>
              )}
              {ticket.relatedLabel && <span>关联：{ticket.relatedLabel}</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {ticket.canManage && (
              <>
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={assignMe}>
                  <UserCheck className="h-3.5 w-3.5" /> 我来处理
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1 text-xs"
                  onClick={toggleEscalate}
                >
                  {ticket.isEscalated ? '取消升级' : '升级工单'}
                </button>
                <select
                  className="input !w-28 !py-1 text-xs"
                  value={ticket.status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  {Object.entries(TICKET_STATUS).map(([value, info]) => (
                    <option key={value} value={value}>
                      {info.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input !w-24 !py-1 text-xs"
                  value={ticket.priority}
                  onChange={(event) => setPriority(event.target.value)}
                >
                  {Object.entries(TICKET_PRIORITY).map(([value, info]) => (
                    <option key={value} value={value}>
                      {info.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            {!ticket.canManage && ticket.user.id === user?.id && ticket.status !== 'closed' && (
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setStatus('closed')}>
                <Lock className="h-3.5 w-3.5" /> 关闭工单
              </button>
            )}
            {!ticket.canManage && ticket.user.id === user?.id && ticket.status === 'closed' && (
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setStatus('open')}>
                重新打开
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Markdown>{ticket.content}</Markdown>
        </div>
      </div>

      <Section title={`处理记录（${data.replies.filter((item: any) => !item.isInternal).length}）`}>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.replies.map((item: any) => {
            const isStaff = item.author.role === 'admin' || item.author.role === 'superadmin';
            return (
              <li
                key={item.id}
                className={classNames(
                  'flex gap-3 px-4 py-4',
                  item.isInternal && 'bg-amber-50/60 dark:bg-amber-500/[0.06]',
                )}
              >
                <Avatar user={item.author} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {item.author.display_name || item.author.username}
                    </span>
                    {isStaff && isAdmin && (
                      <span className="rounded bg-primary/10 px-1.5 text-primary">
                        管理员
                      </span>
                    )}
                    <span className="text-slate-400">{formatTime(item.createdAt)}</span>
                    {item.isInternal && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        <Info className="h-3 w-3" /> 内部备注（用户不可见）
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-slate-400">{fromNow(item.createdAt)}</span>
                  </div>
                  <div className="mt-1.5">
                    <Markdown>{item.content}</Markdown>
                  </div>
                </div>
              </li>
            );
          })}
          {!data.replies.length && <EmptyState title="还没有回复" description="等待管理员处理中…" />}
        </ul>
      </Section>

      {ticket.canRate && (
        <Section title="评价本次处理">
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setRating(value)}>
                  <Star
                    className={classNames(
                      'h-6 w-6',
                      value <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600',
                    )}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm text-slate-500">{rating} 分</span>
            </div>
            <textarea
              className="input min-h-[80px]"
              value={ratingComment}
              onChange={(event) => setRatingComment(event.target.value)}
              placeholder="可以补充评价（可选）"
            />
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={submitRating}>
                提交评价
              </button>
            </div>
          </div>
        </Section>
      )}

      {ticket.rating && (
        <div className="card flex items-center gap-3 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <span>
            你对本次处理给出了{' '}
            <span className="inline-flex items-center gap-0.5 text-amber-500">
              {Array.from({ length: ticket.rating }).map((_, index) => (
                <Star key={index} className="h-3.5 w-3.5 fill-amber-400" />
              ))}
            </span>{' '}
            的评价
          </span>
          {ticket.ratingComment && <span className="text-slate-500">「{ticket.ratingComment}」</span>}
        </div>
      )}

      {ticket.canReply ? (
        <Section title={isAdmin ? '回复工单' : '补充说明'}>
          <div className="space-y-3 p-4">
            <textarea
              className="input min-h-[140px]"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder={isAdmin ? '回复用户，或添加内部备注…' : '补充你没有说清楚的信息…'}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {isAdmin ? (
                <label className="flex items-center gap-2 text-sm text-slate-500">
                  <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                  作为内部备注（用户看不到，也不会改变工单状态）
                </label>
              ) : (
                <span className="text-xs text-slate-400">回复后工单会重新进入待处理状态。</span>
              )}
              <button type="button" className="btn-primary" disabled={sending} onClick={sendReply}>
                {sending ? '发送中…' : internal ? '保存备注' : '发送回复'}
              </button>
            </div>
          </div>
        </Section>
      ) : (
        <div className="card p-4 text-sm text-slate-500">
          该工单已关闭。如问题仍未解决，请
          <Link to="/tickets/new" className="link mx-1">
            重新提交一个工单
          </Link>
          。
        </div>
      )}
    </div>
  );
}
