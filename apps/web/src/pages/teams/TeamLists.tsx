import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { classNames, fromNow } from '../../lib/format';
import { DifficultyBadge, EmptyState, Field, Loading, Modal, StatusText } from '../../components/ui';
import { useToast } from '../../components/Toast';
import type { TeamContextValue } from './TeamLayout';

export default function TeamLists() {
  const ctx = useOutletContext<TeamContextValue>();
  const { id } = useParams();
  if (id) return <ListDetail teamSlug={ctx.team.slug} id={id} ctx={ctx} />;
  return <ListIndex ctx={ctx} />;
}

function ListIndex({ ctx }: { ctx: TeamContextValue }) {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', problemIds: '', isPublic: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<any>(`/api/teams/${ctx.team.slug}/lists`));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ctx.team.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      const problemIds = form.problemIds
        .split(/[\s,，]+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      const result = await api.post<{ id: number }>(`/api/teams/${ctx.team.slug}/lists`, {
        ...form,
        problemIds,
      });
      toast.success('题单已创建');
      setCreating(false);
      setForm({ title: '', description: '', problemIds: '', isPublic: false });
      window.location.href = `/team/${ctx.team.slug}/lists/${result.id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm text-slate-500">共 {data?.items?.length ?? 0} 个题单</span>
        {data?.canCreate && (
          <button type="button" className="btn-primary ml-auto !py-1.5 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> 新建题单
          </button>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : !data?.items?.length ? (
        <div className="card">
          <EmptyState title="还没有题单" description="把相关题目整理成题单，方便系统训练" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((list: any) => (
            <Link key={list.id} to={`/team/${ctx.team.slug}/lists/${list.id}`} className="card p-4 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{list.title}</h2>
                {list.is_public ? (
                  <span className="rounded bg-emerald-100 px-1.5 text-[11px] text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    公开
                  </span>
                ) : (
                  <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500 dark:bg-slate-800">
                    仅团队
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{list.description || '暂无简介'}</p>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                <span>{list.problem_count} 题</span>
                <span>{list.creator_name ?? '管理员'}</span>
                <span className="ml-auto">{fromNow(list.created_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        title="新建团队题单"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={create}>
              创建
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="题单名称" required>
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="简介">
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label="题目 ID" hint="空格或逗号分隔，可稍后编辑">
            <input
              className="input"
              value={form.problemIds}
              onChange={(event) => setForm({ ...form, problemIds: event.target.value })}
              placeholder="1 2 3"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            />
            对非成员公开
          </label>
        </div>
      </Modal>
    </div>
  );
}

function ListDetail({ teamSlug, id, ctx }: { teamSlug: string; id: string; ctx: TeamContextValue }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', problemIds: '', isPublic: false });

  const load = useCallback(async () => {
    try {
      const result = await api.get<any>(`/api/teams/${teamSlug}/lists/${id}`);
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
  }, [teamSlug, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    try {
      const problemIds = form.problemIds
        .split(/[\s,，]+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      await api.put(`/api/teams/${teamSlug}/lists/${id}`, { ...form, problemIds });
      toast.success('已保存');
      setEditing(false);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const remove = async () => {
    if (!window.confirm('确定删除这个题单吗？')) return;
    await api.del(`/api/teams/${teamSlug}/lists/${id}`);
    toast.success('已删除');
    navigate(`/team/${teamSlug}/lists`);
  };

  if (loading) return <Loading />;
  if (!data) return <EmptyState title="题单不存在或无权查看" />;

  const solved = data.problems.filter((problem: any) => problem.myAccepted).length;

  return (
    <div className="space-y-3">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{data.list.title}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {data.problems.length} 题 · 我已通过 {solved} 题
              {data.list.is_public ? ' · 对非成员公开' : ' · 仅团队可见'}
            </p>
          </div>
          {data.canManage && (
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setEditing(true)}>
                编辑
              </button>
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs text-rose-500" onClick={remove}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        {data.list.description && (
          <p className="mt-2 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            {data.list.description}
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        {!data.problems.length ? (
          <EmptyState title="题单里还没有题目" />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th className="w-24">编号</th>
                <th>题目</th>
                <th className="w-28">难度</th>
                <th className="w-28">我的状态</th>
              </tr>
            </thead>
            <tbody>
              {data.problems.map((problem: any, index: number) => (
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
                  <td>{problem.myAccepted ? <StatusText status="AC" /> : <span className="text-xs text-slate-400">未通过</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
              className="input min-h-[80px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label="题目 ID" hint="空格分隔，顺序即展示顺序">
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
            对非成员公开
          </label>
        </div>
      </Modal>
    </div>
  );
}
