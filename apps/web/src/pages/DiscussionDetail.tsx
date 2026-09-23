import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock, Pin, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, formatTime, fromNow } from '../lib/format';
import { Avatar, EmptyState, Loading, UserLink } from '../components/ui';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';

export default function DiscussionDetail() {
  const { id = '' } = useParams();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/discussions/${id}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reply = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    if (!content.trim()) {
      toast.error('回复内容不能为空');
      return;
    }
    setSending(true);
    try {
      await api.post(`/api/discussions/${id}/replies`, { content, replyToId: replyTo });
      setContent('');
      setReplyTo(null);
      await load();
      toast.success('回复成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回复失败');
    } finally {
      setSending(false);
    }
  };

  const removeDiscussion = async () => {
    if (!window.confirm('确定要删除这个帖子吗？')) return;
    try {
      await api.del(`/api/discussions/${id}`);
      toast.success('帖子已删除');
      navigate('/discussions');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const removeReply = async (replyId: number) => {
    if (!window.confirm('确定要删除这条回复吗？')) return;
    try {
      await api.del(`/api/discussion-replies/${replyId}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const moderate = async (patch: Record<string, unknown>) => {
    try {
      await api.put(`/api/discussions/${id}`, patch);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="帖子不存在或已被删除" />;

  const discussion = data.discussion;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">
            {discussion.isPinned && <Pin className="mr-1 inline h-4 w-4 text-rose-500" />}
            {discussion.title}
          </h1>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-xs"
                onClick={() => moderate({ isPinned: !discussion.isPinned })}
              >
                <Pin className="h-3.5 w-3.5" /> {discussion.isPinned ? '取消置顶' : '置顶'}
              </button>
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-xs"
                onClick={() => moderate({ isLocked: !discussion.isLocked })}
              >
                <Lock className="h-3.5 w-3.5" /> {discussion.isLocked ? '解锁' : '锁定'}
              </button>
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <UserLink user={discussion.author} size={22} />
          <span>{formatTime(discussion.createdAt)}</span>
          <span>{discussion.views} 次浏览</span>
          <span>{discussion.board?.name}</span>
          {discussion.problem && (
            <Link to={`/problem/${discussion.problem.pid}`} className="link">
              题目 {discussion.problem.pid}
            </Link>
          )}
          {discussion.canEdit && (
            <button type="button" className="inline-flex items-center gap-1 text-rose-500" onClick={removeDiscussion}>
              <Trash2 className="h-3 w-3" /> 删除
            </button>
          )}
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
          {data.replies.map((reply: any) => (
            <li key={reply.id} className="flex gap-3 px-4 py-4">
              <div className="flex w-32 shrink-0 flex-col items-center gap-1 text-center">
                <Avatar user={reply.author} size={44} />
                <UserLink user={reply.author} showAvatar={false} className="text-xs" />
                <span className="text-[11px] text-slate-400">#{reply.floor}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {formatTime(reply.createdAt)}
                    {reply.replyTo && <span className="ml-2 text-primary">回复 @{reply.replyTo.username}</span>}
                  </span>
                  <div className="flex items-center gap-3">
                    {user && !discussion.isLocked && (
                      <button
                        type="button"
                        className="hover:text-primary"
                        onClick={() => {
                          setReplyTo(reply.id);
                          setContent(`@${reply.author.username} `);
                        }}
                      >
                        回复
                      </button>
                    )}
                    {(reply.canEdit || isAdmin) && (
                      <button type="button" className="text-rose-500" onClick={() => removeReply(reply.id)}>
                        删除
                      </button>
                    )}
                  </div>
                </div>
                <div className={classNames('mt-2', reply.isDeleted && 'opacity-60')}>
                  <Markdown>{reply.content}</Markdown>
                </div>
              </div>
            </li>
          ))}
          {data.replies.length === 0 && <EmptyState title="还没有回复" />}
        </ul>
      </div>

      <div className="card p-4">
        {discussion.isLocked && !isAdmin ? (
          <p className="text-sm text-slate-500">该帖子已被锁定，无法回复。</p>
        ) : user ? (
          <>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>{replyTo ? '正在回复某条评论' : '发表回复'}</span>
              {replyTo && (
                <button type="button" className="text-primary" onClick={() => setReplyTo(null)}>
                  取消引用
                </button>
              )}
            </div>
            <textarea
              className="input min-h-[140px]"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="支持 Markdown 与 LaTeX 公式"
            />
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn-primary" disabled={sending} onClick={reply}>
                {sending ? '发送中…' : '发表回复'}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            <Link to="/login" className="link">
              登录
            </Link>{' '}
            后参与讨论。
          </p>
        )}
      </div>
    </div>
  );
}
