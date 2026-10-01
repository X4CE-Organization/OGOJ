import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageCircle, Pin, PinOff, Send, Trash2, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, fromNow } from '../lib/format';
import { Avatar, EmptyState, Modal, UserLink } from './ui';
import Markdown from './Markdown';
import StickerPicker from './StickerPicker';
import { insertAtCursor } from '../lib/insert';
import { useToast } from './Toast';

export interface MomentItem {
  id: number;
  content: string;
  images: string[];
  isPinned: boolean;
  isDeleted?: boolean;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  createdAt: string;
  updatedAt?: string;
  edited?: boolean;
  author: {
    id: number;
    username: string;
    display_name: string | null;
    avatar: string | null;
    solved_count?: number;
    rating?: number;
  };
  mine?: boolean;
  canDelete?: boolean;
  canPin?: boolean;
  canEdit?: boolean;
}

interface MomentComment {
  id: number;
  content: string;
  parentId: number | null;
  createdAt: string;
  author: { id: number; username: string; display_name: string | null; avatar: string | null };
  mine?: boolean;
  canDelete?: boolean;
}

export default function MomentCard({
  moment,
  onUpdate,
  onDelete,
  commentsOpen = false,
  hideCommentsToggle = false,
  actions,
}: {
  moment: MomentItem;
  onUpdate?: (patch: Partial<MomentItem>) => void;
  onDelete?: () => void;
  commentsOpen?: boolean;
  hideCommentsToggle?: boolean;
  actions?: React.ReactNode;
}) {
  const { user, settings } = useAuth();
  const toast = useToast();
  const allowLike = settings.moment_allow_like !== false;
  const allowComment = settings.moment_allow_comment !== false;
  const [showComments, setShowComments] = useState(commentsOpen);
  const [comments, setComments] = useState<MomentComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [liking, setLiking] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(moment.content);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadComments = useCallback(async () => {
    try {
      const data = await api.get<{ items: MomentComment[] }>(`/api/moments/${moment.id}/comments`);
      setComments(data.items ?? []);
    } catch {
      setComments([]);
    }
  }, [moment.id]);

  useEffect(() => {
    if (showComments && comments === null) void loadComments();
  }, [showComments, comments, loadComments]);

  useEffect(() => {
    if (commentsOpen) void loadComments();
  }, [commentsOpen, loadComments]);

  const like = async () => {
    if (!user) {
      toast.push('登录后才能点赞');
      return;
    }
    if (liking) return;
    setLiking(true);
    try {
      const result = await api.post<{ liked: boolean }>(`/api/moments/${moment.id}/like`);
      onUpdate?.({
        liked: result.liked,
        likeCount: Math.max(0, moment.likeCount + (result.liked ? 1 : -1)),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLiking(false);
    }
  };

  const comment = async () => {
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      await api.post(`/api/moments/${moment.id}/comments`, { content });
      setDraft('');
      await loadComments();
      onUpdate?.({ commentCount: moment.commentCount + 1 });
      toast.success('评论成功');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '评论失败');
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (id: number) => {
    try {
      await api.del(`/api/moments/comments/${id}`);
      setComments((current) => (current ?? []).filter((item) => item.id !== id));
      onUpdate?.({ commentCount: Math.max(0, moment.commentCount - 1) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const remove = async () => {
    if (!window.confirm('确定删除这条动态吗？')) return;
    try {
      await api.del(`/api/moments/${moment.id}`);
      toast.success('已删除');
      onDelete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const togglePin = async () => {
    try {
      const result = await api.post<{ pinned: boolean }>(`/api/admin/moments/${moment.id}/pin`);
      onUpdate?.({ isPinned: result.pinned });
      toast.success(result.pinned ? '已置顶' : '已取消置顶');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const saveEdit = async () => {
    const content = editText.trim();
    if (!content && !moment.images.length) {
      toast.error('写点内容吧');
      return;
    }
    try {
      await api.put(`/api/moments/${moment.id}`, { content, images: moment.images });
      onUpdate?.({ content, edited: true });
      setEditing(false);
      toast.success('已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const canEdit = moment.canEdit ?? moment.mine;

  return (
    <article className="card p-4">
      <header className="flex items-center gap-2.5">
        <Link to={`/user/${moment.author.username}`} className="shrink-0">
          <Avatar user={moment.author} size={36} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm">
            <UserLink user={moment.author} showAvatar={false} className="font-medium hover:text-primary" />
            {moment.isPinned && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                置顶
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            <span title={moment.createdAt}>{fromNow(moment.createdAt)}</span>
            {moment.edited && <span>· 已编辑</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {moment.canPin && (
            <button
              type="button"
              onClick={togglePin}
              title={moment.isPinned ? '取消置顶' : '置顶'}
              className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-amber-600 dark:hover:bg-slate-800"
            >
              {moment.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => {
                setEditText(moment.content);
                setEditing(true);
              }}
              title="编辑"
              className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-primary dark:hover:bg-slate-800"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {moment.canDelete && (
            <button
              type="button"
              onClick={remove}
              title="删除"
              className="rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {editing ? (
        <div className="mt-3">
          <textarea
            className="input min-h-[80px] resize-y"
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={saveEdit}>
              保存
            </button>
          </div>
        </div>
      ) : (
        moment.content && <Markdown className="mt-3 text-sm leading-relaxed">{moment.content}</Markdown>
      )}

      {moment.images.length > 0 && (
        <div
          className={classNames(
            'mt-3 grid gap-1.5',
            moment.images.length === 1 ? 'grid-cols-1' : moment.images.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
          )}
        >
          {moment.images.map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => setPreview(url)}
              className={classNames(
                'overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
                moment.images.length === 1 ? 'max-h-[420px]' : 'aspect-square',
              )}
            >
              <img
                src={url}
                alt="动态图片"
                loading="lazy"
                className={classNames('h-full w-full', moment.images.length === 1 ? 'object-contain' : 'object-cover')}
              />
            </button>
          ))}
        </div>
      )}

      <footer className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-2.5 text-xs text-slate-500 dark:border-slate-800">
        {allowLike && (
          <button
            type="button"
            onClick={like}
            className={classNames(
              'inline-flex items-center gap-1 transition',
              moment.liked ? 'text-rose-500' : 'hover:text-rose-500',
            )}
          >
            <Heart className={classNames('h-4 w-4', moment.liked && 'fill-current')} />
            {moment.likeCount > 0 ? moment.likeCount : '赞'}
          </button>
        )}
        {allowComment && (
          <button
            type="button"
            onClick={() => setShowComments((value) => !value)}
            className="inline-flex items-center gap-1 transition hover:text-primary"
          >
            <MessageCircle className="h-4 w-4" />
            {moment.commentCount > 0 ? moment.commentCount : '评论'}
          </button>
        )}
        {!hideCommentsToggle && (
          <Link to={`/moment/${moment.id}`} className="ml-auto text-slate-400 transition hover:text-primary">
            查看详情
          </Link>
        )}
      </footer>

      {showComments && allowComment && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {comments === null ? (
            <p className="text-xs text-slate-400">加载评论中…</p>
          ) : comments.length === 0 ? (
            <EmptyState title="还没有评论，来说两句" />
          ) : (
            <ul className="space-y-2">
              {comments.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <Link to={`/user/${item.author.username}`} className="shrink-0">
                    <Avatar user={item.author} size={26} />
                  </Link>
                  <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                    <div className="flex items-center gap-2 text-xs">
                      <UserLink user={item.author} showAvatar={false} className="font-medium hover:text-primary" />
                      <span className="text-slate-400">{fromNow(item.createdAt)}</span>
                      {item.canDelete && (
                        <button
                          type="button"
                          onClick={() => removeComment(item.id)}
                          className="ml-auto text-slate-400 hover:text-rose-500"
                        >
                          删除
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
                      {item.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {user ? (
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                className="input min-h-[38px] flex-1 resize-y"
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void comment();
                  }
                }}
                placeholder="友善评论，Ctrl / ⌘ + Enter 发送"
              />
              <StickerPicker
                onPick={(markdown) => insertAtCursor(inputRef.current, markdown, setDraft)}
              />
              <button
                type="button"
                className="btn-primary !px-2.5"
                disabled={sending || !draft.trim()}
                onClick={comment}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              登录后可以评论 · <Link to="/login" className="text-primary">去登录</Link>
            </p>
          )}
        </div>
      )}

      {preview && (
        <Modal open onClose={() => setPreview(null)} title="查看图片" width="max-w-3xl">
          <img src={preview} alt="动态图片" className="max-h-[70vh] w-full object-contain" />
        </Modal>
      )}
    </article>
  );
}
