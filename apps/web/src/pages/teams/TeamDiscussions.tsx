import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Lock, MessageSquarePlus, Pin, Trash2 } from 'lucide-react';
import { api, query } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classNames, formatTime, fromNow } from '../../lib/format';
import { Avatar, EmptyState, Field, Loading, Modal, Pagination, UserLink } from '../../components/ui';
import Markdown from '../../components/Markdown';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'general', label: '综合讨论' },
  { value: 'solution', label: '题解分享' },
  { value: 'help', label: '求助问答' },
  { value: 'announcement', label: '团队公告' },
];

export default function TeamDiscussions() {
  const ctx = useOutletContext<TeamContextValue>();
  const { id } = useParams();
  if (id) return <DiscussionDetail teamSlug={ctx.team.slug} id={id} ctx={ctx} />;
  return <DiscussionList ctx={ctx} />;
}

function DiscussionList({ ctx }: { ctx: TeamContextValue }) {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', category: 'general' });

  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<any>(
        `/api/teams/${ctx.team.slug}/discussions${query({ page, size: 20, category })}`,
      );
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ctx.team.slug, page, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      const result = await api.post<{ id: number }>(`/api/teams/${ctx.team.slug}/discussions`, form);
      toast.success('发布成功');
      setCreating(false);
      setForm({ title: '', content: '', category: 'general' });
      window.location.href = `/team/${ctx.team.slug}/discussions/${result.id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    }
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        {[{ value: '', label: '全部' }, ...CATEGORIES].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(params);
              if (item.value) next.set('category', item.value);
              else next.delete('category');
              next.delete('page');
              setParams(next);
            }}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              category === item.value
                ? 'bg-primary text-white'
                : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.label}
          </button>
        ))}
        {data?.canPost ? (
          <button type="button" className="btn-primary ml-auto !py-1.5 text-xs" onClick={() => setCreating(true)}>
            <MessageSquarePlus className="h-3.5 w-3.5" /> 发表新帖
          </button>
        ) : (
          <span className="ml-auto text-xs text-slate-400">加入团队后可以发帖</span>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.items?.length ? (
          <EmptyState title="讨论区还没有帖子" description="发一个帖子，和队友交流题解与思路" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.items.map((discussion: any) => (
              <li key={discussion.id} className="flex items-start gap-3 px-4 py-3">
                <Avatar user={{ username: discussion.username, display_name: discussion.display_name, avatar: discussion.avatar }} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {discussion.is_pinned ? <Pin className="h-3.5 w-3.5 text-rose-500" /> : null}
                    {discussion.is_locked ? <Lock className="h-3.5 w-3.5 text-slate-400" /> : null}
                    <Link
                      to={`/team/${ctx.team.slug}/discussions/${discussion.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {discussion.title}
                    </Link>
                    <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500 dark:bg-slate-800">
                      {CATEGORIES.find((item) => item.value === discussion.category)?.label ?? discussion.category}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <UserLink user={{ username: discussion.username, display_name: discussion.display_name }} showAvatar={false} />
                    <span>{discussion.reply_count} 回复</span>
                    <span>{discussion.views} 浏览</span>
                    <span>最后更新 {fromNow(discussion.last_reply_at ?? discussion.created_at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={page}
          size={20}
          total={data?.total ?? 0}
          onChange={(next) => {
            const search = new URLSearchParams(params);
            search.set('page', String(next));
            setParams(search);
          }}
        />
      </div>

      <Modal
        open={creating}
        title="发表新帖"
        onClose={() => setCreating(false)}
        width="max-w-2xl"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={create}>
              发布
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="帖子类型">
            <select
              className="input"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              {CATEGORIES.filter((item) => item.value !== 'announcement' || ctx.permissions.discussions).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="标题" required>
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="内容（支持 Markdown 与公式）" required>
            <textarea
              className="input min-h-[220px]"
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function DiscussionDetail({ teamSlug, id, ctx }: { teamSlug: string; id: string; ctx: TeamContextValue }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<any>(`/api/teams/${teamSlug}/discussions/${id}`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [teamSlug, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/teams/${teamSlug}/discussions/${id}/replies`, { content: reply });
      setReply('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回复失败');
    } finally {
      setSending(false);
    }
  };

  const moderate = async (patch: Record<string, unknown>) => {
    try {
      await api.put(`/api/teams/${teamSlug}/discussions/${id}`, patch);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const remove = async () => {
    if (!window.confirm('确定删除这个帖子吗？')) return;
    try {
      await api.del(`/api/teams/${teamSlug}/discussions/${id}`);
      navigate(`/team/${teamSlug}/discussions`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="帖子不存在或无权查看" />;

  const discussion = data.discussion;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{discussion.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <UserLink user={{ username: discussion.username, display_name: discussion.display_name, avatar: discussion.avatar }} size={20} />
              <span>{formatTime(discussion.created_at)}</span>
              <span>{discussion.views} 浏览</span>
              <span>{discussion.reply_count} 回复</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {discussion.canManage && (
              <>
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => moderate({ isPinned: !discussion.is_pinned })}>
                  <Pin className="h-3.5 w-3.5" /> {discussion.is_pinned ? '取消置顶' : '置顶'}
                </button>
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => moderate({ isLocked: !discussion.is_locked })}>
                  <Lock className="h-3.5 w-3.5" /> {discussion.is_locked ? '解锁' : '锁定'}
                </button>
              </>
            )}
            {(discussion.canManage || discussion.author_id === user?.id) && (
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs text-rose-500" onClick={remove}>
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Markdown>{discussion.content}</Markdown>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold dark:border-slate-800">
          {data.replies.length} 条回复
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.replies.map((item: any) => (
            <li key={item.id} className="flex gap-3 px-4 py-4">
              <Avatar user={{ username: item.username, display_name: item.display_name, avatar: item.avatar }} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-medium text-slate-600 dark:text-slate-300">{item.display_name || item.username}</span>
                  <span>#{item.floor}</span>
                  <span>{formatTime(item.created_at)}</span>
                </div>
                <div className={classNames('mt-1.5', item.is_deleted && 'opacity-60')}>
                  <Markdown>{item.content}</Markdown>
                </div>
              </div>
            </li>
          ))}
          {!data.replies.length && <EmptyState title="还没有回复" />}
        </ul>
      </div>

      {data.canReply ? (
        <div className="card p-4">
          <textarea
            className="input min-h-[120px]"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="写下你的回复…"
          />
          <div className="mt-2 flex justify-end">
            <button type="button" className="btn-primary" disabled={sending} onClick={send}>
              {sending ? '发送中…' : '发表回复'}
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-4 text-sm text-slate-500">
          {discussion.is_locked ? '该帖子已被锁定。' : '加入团队后可以参与讨论。'}
        </div>
      )}
    </div>
  );
}
