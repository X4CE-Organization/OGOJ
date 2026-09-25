import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ListChecks, Plus } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { classNames, fromNow } from '../lib/format';
import { rememberListUrl } from '../lib/nav';
import { EmptyState, Field, Loading, Modal, Pagination, Section } from '../components/ui';
import { useToast } from '../components/Toast';

const TYPE_LABEL: Record<string, string> = { official: '官方题单', user: '用户题单', training: '训练计划' };

export default function Training() {
  const { user, isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', isPublic: true, problemIds: '' });
  const toast = useToast();

  const page = Number(params.get('page') ?? 1);
  const type = params.get('type') ?? '';
  const mine = params.get('mine') ?? '';
  const size = 20;

  // 记住列表位置，题单详情页的「返回题单」会回到这一屏
  useEffect(() => {
    const search = params.toString();
    rememberListUrl('training', search ? `/training?${search}` : '/training');
  }, [params]);

  const load = () => {
    setLoading(true);
    api
      .get<any>(`/api/lists${query({ page, size, type, mine })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, [params.toString(), page, size, type, mine]);

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
      const problemIds = form.problemIds
        .split(/[\s,，]+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
      const result = await api.post<{ id: number }>('/api/lists', {
        title: form.title,
        description: form.description,
        isPublic: form.isPublic,
        type: isAdmin ? 'official' : 'user',
        problemIds,
      });
      toast.success('题单创建成功');
      setCreating(false);
      setForm({ title: '', description: '', isPublic: true, problemIds: '' });
      window.location.href = `/list/${result.id}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="h-4 w-4 text-primary" /> 训练 / 题单
        </h1>
        {user && (
          <button type="button" className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> 新建题单
          </button>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {[
          { value: '', label: '全部' },
          { value: 'official', label: '官方' },
          { value: 'user', label: '用户' },
          { value: 'training', label: '训练' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => update({ type: item.value })}
            className={classNames(
              'rounded-lg px-3 py-1.5 text-sm',
              type === item.value
                ? 'bg-primary text-white'
                : 'border border-slate-200 text-slate-500 dark:border-slate-700',
            )}
          >
            {item.label}
          </button>
        ))}
        {user && (
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={mine === 'true'}
              onChange={(event) => update({ mine: event.target.checked ? 'true' : undefined })}
            />
            我创建的
          </label>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title="还没有题单" description="创建一个题单，把同类型的题目整理在一起" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((list) => (
            <Link key={list.id} to={`/list/${list.id}`} className="card block p-4 transition hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  {TYPE_LABEL[list.type] ?? '题单'}
                </span>
                <span className="text-xs text-slate-400">{list.problem_count} 题</span>
              </div>
              <h2 className="mt-2 font-semibold">{list.title}</h2>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{list.description || '暂无简介'}</p>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>{list.display_name || list.username}</span>
                <span>{fromNow(list.created_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <Pagination page={page} size={size} total={total} onChange={(next) => update({ page: next })} />
      </div>

      <Modal
        open={creating}
        title="新建题单"
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
            <input
              className="input"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </Field>
          <Field label="简介">
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label="题目 ID" hint="用空格或逗号分隔的题目 ID，可稍后编辑">
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
            公开题单
          </label>
        </div>
      </Modal>
    </div>
  );
}
