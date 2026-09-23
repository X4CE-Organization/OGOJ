import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Heart, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, fromNow } from '../lib/format';
import {
  DifficultyBadge,
  EmptyState,
  Field,
  Loading,
  Modal,
  Section,
  StatusText,
  TagBadge,
} from '../components/ui';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';

export default function ListDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', problemIds: '', isPublic: true });

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/lists/${id}`);
      setData(result);
      setForm({
        title: result.list.title,
        description: result.list.description,
        problemIds: result.problems.map((problem: any) => problem.id).join(' '),
        isPublic: Boolean(result.list.is_public),
      });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    try {
      const problemIds = form.problemIds
        .split(/[\s,，]+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      await api.put(`/api/lists/${id}`, { ...form, problemIds });
      toast.success('题单已保存');
      setEditing(false);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const toggleFavorite = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    try {
      const result = await api.post<{ favorited: boolean }>(`/api/lists/${id}/favorite`);
      setData({ ...data, favorited: result.favorited });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const setProgress = async (problemId: number, status: string) => {
    if (!user) return;
    try {
      await api.post(`/api/lists/${id}/progress`, { problemId, status });
      void load();
    } catch {
      /* ignore */
    }
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="题单不存在或未公开" />;

  const { list, problems, progress, favorited, canEdit } = data;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">{list.title}</h1>
              <p className="mt-1 text-xs text-slate-500">
                由 {list.display_name || list.username} 创建 · {fromNow(list.created_at)} · {list.views} 次浏览
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleFavorite}
                className={classNames('btn-ghost !px-2.5 !py-1 text-xs', favorited && '!text-rose-500')}
              >
                <Heart className={classNames('h-3.5 w-3.5', favorited && 'fill-rose-500')} />
                {list.favorites}
              </button>
              {canEdit && (
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" /> 编辑
                </button>
              )}
            </div>
          </div>
          {list.description && (
            <div className="mt-3">
              <Markdown>{list.description}</Markdown>
            </div>
          )}
        </div>

        <Section title={`题目列表（${problems.length}）`}>
          {problems.length === 0 ? (
            <EmptyState title="题单中还没有题目" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-12">#</th>
                    <th className="w-24">编号</th>
                    <th>题目</th>
                    <th className="w-32">难度</th>
                    <th className="hidden w-56 md:table-cell">标签</th>
                    <th className="w-28">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((problem: any, index: number) => (
                    <tr key={problem.id}>
                      <td className="text-xs text-slate-400">{index + 1}</td>
                      <td className="font-mono text-xs text-slate-400">{problem.pid}</td>
                      <td>
                        <Link to={`/problem/${problem.pid}`} className="hover:text-primary">
                          {problem.title}
                        </Link>
                      </td>
                      <td>
                        <DifficultyBadge value={problem.difficulty} compact />
                      </td>
                      <td className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {problem.tags.slice(0, 3).map((tag: any) => (
                            <TagBadge key={tag.id} tag={tag} />
                          ))}
                        </div>
                      </td>
                      <td>
                        {problem.myAccepted ? (
                          <StatusText status="AC" />
                        ) : user ? (
                          <select
                            className="input !w-24 !py-1 text-xs"
                            value={problem.myStatus}
                            onChange={(event) => setProgress(problem.id, event.target.value)}
                          >
                            <option value="todo">未开始</option>
                            <option value="doing">进行中</option>
                            <option value="done">已完成</option>
                          </select>
                        ) : (
                          <span className="text-xs text-slate-400">未登录</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="card p-4">
          <h2 className="text-sm font-semibold">我的进度</h2>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>已完成</span>
              <span>
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
          {!user && (
            <Link to="/login" className="btn-primary mt-3 w-full">
              登录后记录进度
            </Link>
          )}
        </div>

        <Section title="统计">
          <dl className="space-y-2 p-4 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">题目数量</dt>
              <dd>{problems.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">收藏人数</dt>
              <dd>{list.favorites}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">浏览</dt>
              <dd>{list.views}</dd>
            </div>
          </dl>
        </Section>
      </aside>

      <Modal
        open={editing}
        title="编辑题单"
        onClose={() => setEditing(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              保存
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="名称">
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="简介">
            <textarea
              className="input min-h-[100px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label="题目 ID" hint="用空格分隔，顺序即展示顺序">
            <input
              className="input"
              value={form.problemIds}
              onChange={(event) => setForm({ ...form, problemIds: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            />
            公开
          </label>
        </div>
      </Modal>
    </div>
  );
}
