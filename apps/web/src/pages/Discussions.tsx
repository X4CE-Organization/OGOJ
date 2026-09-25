import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageSquarePlus, Pin, Lock, Eye } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, fromNow } from '../lib/format';
import { rememberListUrl } from '../lib/nav';
import { EmptyState, Field, Loading, Modal, Pagination, UserLink } from '../components/ui';
import { useToast } from '../components/Toast';

export default function Discussions() {
  const { user, meta } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [boards, setBoards] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', board: 'general' });
  const toast = useToast();

  const page = Number(params.get('page') ?? 1);
  const board = params.get('board') ?? '';
  const sort = params.get('sort') ?? 'new';
  const keyword = params.get('q') ?? '';
  const size = 30;

  // 记住列表位置，帖子详情页的「返回讨论区」会回到这一屏
  useEffect(() => {
    const search = params.toString();
    rememberListUrl('discussions', search ? `/discussions?${search}` : '/discussions');
  }, [params]);

  useEffect(() => {
    api.get<{ boards: any[] }>('/api/boards').then((data) => setBoards(data.boards)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/discussions${query({ page, size, board, sort, q: keyword })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page, size, board, sort, keyword]);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const create = async () => {
    try {
      const result = await api.post<{ id: number }>('/api/discussions', form);
      toast.success('发布成功');
      setCreating(false);
      setForm({ title: '', content: '', board: form.board });
      window.location.href = `/discussion/${result.id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">讨论区</h1>
        <button
          type="button"
          className="btn-primary !px-3 !py-1.5 text-sm"
          onClick={() => (user ? setCreating(true) : (window.location.href = '/login'))}
        >
          <MessageSquarePlus className="h-4 w-4" /> 发布新帖
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => update({ board: undefined })}
          className={classNames(
            'rounded-lg px-3 py-1.5 text-sm',
            !board ? 'bg-primary text-white' : 'border border-slate-200 text-slate-500 dark:border-slate-700',
          )}
        >
          全部板块
        </button>
        {(boards.length ? boards : meta?.boards ?? []).map((item: any) => (
          <button
            key={item.slug}
            type="button"
            onClick={() => update({ board: item.slug })}
            title={item.description}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              board === item.slug
                ? 'bg-primary text-white'
                : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.name}
          </button>
        ))}
        <select className="input ml-auto !w-32" value={sort} onChange={(event) => update({ sort: event.target.value })}>
          <option value="new">最新发布</option>
          <option value="new_reply">最新回复</option>
          <option value="hot">最热</option>
        </select>
        <input
          className="input !w-48"
          placeholder="搜索帖子"
          defaultValue={keyword}
          onKeyDown={(event) => {
            if (event.key === 'Enter') update({ q: (event.target as HTMLInputElement).value });
          }}
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="暂无帖子" description="来发第一帖吧" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((discussion) => (
              <li key={discussion.id} className="flex items-start gap-3 px-4 py-3">
                <UserLink user={discussion.author} size={32} showAvatar />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {discussion.isPinned && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 text-xs text-rose-600 dark:bg-rose-500/20">
                        <Pin className="h-3 w-3" /> 置顶
                      </span>
                    )}
                    {discussion.isLocked && <Lock className="h-3 w-3 text-slate-400" />}
                    <Link to={`/discussion/${discussion.id}`} className="font-medium hover:text-primary">
                      {discussion.title}
                    </Link>
                    {discussion.problem && (
                      <Link
                        to={`/problem/${discussion.problem.pid}`}
                        className="rounded bg-slate-100 px-1.5 text-xs text-slate-500 dark:bg-slate-800"
                      >
                        {discussion.problem.pid}
                      </Link>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>{discussion.board?.name ?? '综合讨论'}</span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {discussion.views}
                    </span>
                    <span>{discussion.replyCount} 回复</span>
                    <span>最后回复 {fromNow(discussion.lastReplyAt ?? discussion.createdAt)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} size={size} total={total} onChange={(next) => update({ page: next })} />
      </div>

      <Modal
        open={creating}
        title="发布新帖"
        onClose={() => setCreating(false)}
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
        width="max-w-2xl"
      >
        <div className="space-y-3">
          <Field label="板块">
            <select
              className="input"
              value={form.board}
              onChange={(event) => setForm({ ...form, board: event.target.value })}
            >
              {(boards.length ? boards : meta?.boards ?? []).map((item: any) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="标题" required>
            <input
              className="input"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </Field>
          <Field label="内容（支持 Markdown 与 LaTeX）" required>
            <textarea
              className="input min-h-[240px]"
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
