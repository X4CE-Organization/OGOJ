import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Users2 } from 'lucide-react';
import { api, query } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fromNow } from '../lib/format';
import { EmptyState, Field, Loading, Modal, Pagination } from '../components/ui';
import { useToast } from '../components/Toast';

export default function Teams() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', isPublic: true });

  const page = Number(params.get('page') ?? 1);
  const mine = params.get('mine') ?? '';
  const size = 24;

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/teams${query({ page, size, mine })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page, size, mine]);

  const create = async () => {
    try {
      const result = await api.post<{ slug: string }>('/api/teams', form);
      toast.success('团队创建成功');
      setCreating(false);
      window.location.href = `/team/${result.slug}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Users2 className="h-5 w-5 text-primary" /> 团队
        </h1>
        {user && (
          <button type="button" className="btn-primary !px-3 !py-1.5 text-sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> 创建团队
          </button>
        )}
      </div>

      {user && (
        <div className="card p-3">
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={mine === 'true'}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                if (event.target.checked) next.set('mine', 'true');
                else next.delete('mine');
                next.delete('page');
                setParams(next);
              }}
            />
            只看我加入的团队
          </label>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title="还没有团队" description="创建一个团队，和朋友一起刷题" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((team) => (
            <Link key={team.id} to={`/team/${team.slug}`} className="card flex items-center gap-3 p-4 hover:shadow-md">
              {team.avatar ? (
                <img src={team.avatar} alt={team.name} className="h-12 w-12 rounded-lg object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-lg font-bold text-primary">
                  {team.name.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{team.name}</h2>
                <p className="truncate text-xs text-slate-500">{team.description || '暂无简介'}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {team.member_count} 名成员 · 团长 {team.owner_name} · {fromNow(team.created_at)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <Pagination
          page={page}
          size={size}
          total={total}
          onChange={(next) => {
            const params2 = new URLSearchParams(params);
            params2.set('page', String(next));
            setParams(params2);
          }}
        />
      </div>

      <Modal
        open={creating}
        title="创建团队"
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
          <Field label="团队名称" required>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="团队简介">
            <textarea
              className="input min-h-[100px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) => setForm({ ...form, isPublic: event.target.checked })}
            />
            公开团队
          </label>
        </div>
      </Modal>
    </div>
  );
}
