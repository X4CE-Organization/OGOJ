import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, query } from '../lib/api';
import { fromNow } from '../lib/format';
import { Avatar, EmptyState, Loading, Pagination } from '../components/ui';

export default function Users() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(params.get('q') ?? '');

  const page = Number(params.get('page') ?? 1);
  const role = params.get('role') ?? '';
  const sort = params.get('sort') ?? 'solved';
  const size = 50;

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/users${query({ page, size, role, sort, q: params.get('q') ?? '' })}`)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [page, size, role, sort, params]);

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">用户</h1>
        <div className="flex items-center gap-2">
          <select className="input !w-32" value={role} onChange={(event) => update({ role: event.target.value })}>
            <option value="">全部角色</option>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            <option value="superadmin">超级管理员</option>
          </select>
          <select className="input !w-32" value={sort} onChange={(event) => update({ sort: event.target.value })}>
            <option value="solved">按通过题数</option>
            <option value="points">按积分</option>
            <option value="newest">按注册时间</option>
          </select>
          <input
            className="input !w-44"
            placeholder="搜索用户名"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') update({ q: keyword });
            }}
          />
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState title="没有找到用户" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <Link key={item.id} to={`/user/${item.username}`} className="card flex items-center gap-3 p-3 hover:shadow-md">
              <Avatar user={item} size={44} />
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {item.display_name || item.username}
                  {item.role === 'superadmin' && <span className="ml-1 text-xs text-rose-500">超管</span>}
                  {item.role === 'admin' && <span className="ml-1 text-xs text-amber-500">管理员</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-400">
                  {item.level?.name} · {item.solved_count} 题 · {item.points} 积分
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  {item.last_login_at ? `最后登录 ${fromNow(item.last_login_at)}` : '从未登录'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card">
        <Pagination page={page} size={size} total={total} onChange={(next) => update({ page: next })} />
      </div>
    </div>
  );
}
